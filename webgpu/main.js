import {
  loadPrecomputedTextures,
  createFullscreenQuadBuffer,
  createGlobalUniformBuffer,
  writeGlobalUniforms,
} from './utils.js';
import skyShaderWGSL from './shader.wgsl?raw';

const statusLabel = document.getElementById('status');
const canvas = document.getElementById('webgpu-canvas');

function setStatus(message) {
  if (statusLabel) {
    statusLabel.textContent = message;
  } else {
    console.info('[WebGPU status]', message);
  }
}

const LENGTH_UNIT_IN_METERS = 1000.0;
const SUN_ANGULAR_RADIUS = 0.00935 / 2.0;
const DEFAULT_STATE = {
  viewDistanceMeters: 9000,
  viewZenithAngleRadians: 1.47,
  viewAzimuthAngleRadians: -0.1,
  sunZenithAngleRadians: 1.3,
  sunAzimuthAngleRadians: 2.9,
  exposure: 10,
};

const PRESETS = {
  '1': { viewDistanceMeters: 9000, viewZenithAngleRadians: 1.47, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.3, sunAzimuthAngleRadians: 3.0, exposure: 10 },
  '2': { viewDistanceMeters: 9000, viewZenithAngleRadians: 1.47, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.564, sunAzimuthAngleRadians: -3.0, exposure: 10 },
  '3': { viewDistanceMeters: 7000, viewZenithAngleRadians: 1.57, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.54, sunAzimuthAngleRadians: -2.96, exposure: 10 },
  '4': { viewDistanceMeters: 7000, viewZenithAngleRadians: 1.57, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.328, sunAzimuthAngleRadians: -3.044, exposure: 10 },
  '5': { viewDistanceMeters: 9000, viewZenithAngleRadians: 1.39, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.2, sunAzimuthAngleRadians: 0.7, exposure: 10 },
  '6': { viewDistanceMeters: 9000, viewZenithAngleRadians: 1.5, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.628, sunAzimuthAngleRadians: 1.05, exposure: 200 },
  '7': { viewDistanceMeters: 7000, viewZenithAngleRadians: 1.43, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.57, sunAzimuthAngleRadians: 1.34, exposure: 40 },
  '8': { viewDistanceMeters: 2.7e6, viewZenithAngleRadians: 0.81, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.57, sunAzimuthAngleRadians: 2.0, exposure: 10 },
  '9': { viewDistanceMeters: 1.2e7, viewZenithAngleRadians: 0.0, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 0.93, sunAzimuthAngleRadians: -2.0, exposure: 10 },
};

const viewFromClip = new Float32Array(16);
const modelFromView = new Float32Array(16);
const uniformScratch = new Float32Array(64);

function copyRowMajorToColumnMajor(target, offset, source) {
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      target[offset + column * 4 + row] = source[row * 4 + column];
    }
  }
}
async function initWebGPU(targetCanvas) {
  const isLocalhost = ['localhost', '127.0.0.1', '', '::1']
      .includes(window.location.hostname);
  if (!window.isSecureContext && !isLocalhost) {
    throw new Error(
        'WebGPU requires a secure context. Run `npm run dev` and open http://localhost:5173/webgpu/.');
  }

  if (!navigator.gpu) {
    throw new Error(
        'WebGPU is not available. Use Chrome 113+/Edge 113+ with the WebGPU flag enabled.');
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    throw new Error('Failed to acquire GPU adapter.');
  }

  // Request float32-filterable feature to enable linear filtering on rgba32float textures
  const device = await adapter.requestDevice({
    requiredFeatures: ['float32-filterable'],
  });
  const context = targetCanvas.getContext('webgpu');
  if (!context) {
    throw new Error('Failed to acquire WebGPU context.');
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  configureContext(targetCanvas, context, device, format);

  return { device, context, format };
}

function configureContext(targetCanvas, context, device, format) {
  const devicePixelRatio = window.devicePixelRatio || 1;
  targetCanvas.width = Math.max(1, Math.floor(targetCanvas.clientWidth * devicePixelRatio));
  targetCanvas.height = Math.max(1, Math.floor(targetCanvas.clientHeight * devicePixelRatio));
  context.configure({ device, format, alphaMode: 'opaque' });
}

async function initPipeline(device, format) {
  const shaderModule = device.createShaderModule({ code: skyShaderWGSL });
  const descriptor = {
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: 8,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-strip' },
  };
  return device.createRenderPipeline(descriptor);
}

function draw(device, context, pipeline, bindGroup, vertexBuffer) {
  const commandEncoder = device.createCommandEncoder();
  const view = context.getCurrentTexture().createView();
  const renderPassDescriptor = {
    colorAttachments: [
      {
        view,
        clearValue: { r: 0.02, g: 0.02, b: 0.04, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  };

  const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.setVertexBuffer(0, vertexBuffer);
  passEncoder.draw(4);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
}

function updateGlobalUniforms(canvas, state) {
  const kFovY = (50 / 180) * Math.PI;
  const kTanFovY = Math.tan(kFovY / 2);
  const aspect = canvas.width / canvas.height;
  viewFromClip.set([
    kTanFovY * aspect, 0, 0, 0,
    0, kTanFovY, 0, 0,
    0, 0, 0, -1,
    0, 0, 1, 1,
  ]);

  const cosZ = Math.cos(state.viewZenithAngleRadians);
  const sinZ = Math.sin(state.viewZenithAngleRadians);
  const cosA = Math.cos(state.viewAzimuthAngleRadians);
  const sinA = Math.sin(state.viewAzimuthAngleRadians);
  const viewDistance = state.viewDistanceMeters / LENGTH_UNIT_IN_METERS;
  modelFromView.set([
    -sinA, -cosZ * cosA, sinZ * cosA, sinZ * cosA * viewDistance,
    cosA, -cosZ * sinA, sinZ * sinA, sinZ * sinA * viewDistance,
    0, sinZ, cosZ, cosZ * viewDistance,
    0, 0, 0, 1,
  ]);

  const camera = [
    modelFromView[3],
    modelFromView[7],
    modelFromView[11],
  ];

  const sunDir = [
    Math.cos(state.sunAzimuthAngleRadians) * Math.sin(state.sunZenithAngleRadians),
    Math.sin(state.sunAzimuthAngleRadians) * Math.sin(state.sunZenithAngleRadians),
    Math.cos(state.sunZenithAngleRadians),
  ];

  const sunSize = [Math.tan(SUN_ANGULAR_RADIUS), Math.cos(SUN_ANGULAR_RADIUS)];
  const whitePoint = [1, 1, 1];
  const earthCenter = [0, 0, -6360000 / LENGTH_UNIT_IN_METERS];

  copyRowMajorToColumnMajor(uniformScratch, 0, viewFromClip);
  copyRowMajorToColumnMajor(uniformScratch, 16, modelFromView);
  uniformScratch.set([camera[0], camera[1], camera[2], state.exposure], 32);
  uniformScratch.set([sunDir[0], sunDir[1], sunDir[2], sunSize[0]], 36);
  uniformScratch.set([whitePoint[0], whitePoint[1], whitePoint[2], sunSize[1]], 40);
  uniformScratch.set([earthCenter[0], earthCenter[1], earthCenter[2], 0], 44);

  return uniformScratch;
}

function applyPreset(controls, presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) {
    return false;
  }
  Object.assign(controls, preset);
  setStatus(`WebGPU ready — Sub-task 6.5: Preset ${presetKey}`);
  return true;
}

async function main() {
  try {
    const gpuState = await initWebGPU(canvas);
    const pipeline = await initPipeline(gpuState.device, gpuState.format);
    const precomputedTextures = await loadPrecomputedTextures(gpuState.device);
    console.info('Loaded LUT textures:', precomputedTextures);

    // Create sampler for LUT textures (linear filtering, clamp to edge)
    const lutSampler = gpuState.device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    });

    const quadBuffer = createFullscreenQuadBuffer(gpuState.device);
    const uniformBuffer = createGlobalUniformBuffer(gpuState.device);
    const bindGroup = gpuState.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: precomputedTextures.transmittance.createView() },
        { binding: 2, resource: precomputedTextures.scattering.createView() },
        { binding: 3, resource: precomputedTextures.irradiance.createView() },
        { binding: 4, resource: lutSampler },
      ],
    });

    const controls = { ...DEFAULT_STATE };

    const render = () => {
      const data = updateGlobalUniforms(canvas, controls);
      writeGlobalUniforms(gpuState.device, uniformBuffer, data);
      draw(gpuState.device, gpuState.context, pipeline, bindGroup, quadBuffer);
      requestAnimationFrame(render);
    };
    render();

    setStatus('WebGPU ready — Sub-task 6.5: Preset parity sweep');

    window.addEventListener('keydown', (event) => {
      if (applyPreset(controls, event.key)) {
        event.preventDefault();
      }
    });

    window.addEventListener('resize', () => {
      configureContext(canvas, gpuState.context, gpuState.device, gpuState.format);
    });
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'WebGPU initialization failed');
  }
}

main();

import {
  loadPrecomputedTextures,
  createFullscreenQuadBuffer,
  createGlobalUniformBuffer,
  writeGlobalUniforms,
} from './utils.js';

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

const viewFromClip = new Float32Array(16);
const modelFromView = new Float32Array(16);
const uniformScratch = new Float32Array(64);

const skyShaderWGSL = `
struct Globals {
  view_from_clip : mat4x4f,
  model_from_view : mat4x4f,
  camera_exposure : vec4f,
  sun_direction_size : vec4f,
  white_point_size : vec4f,
  earth_center : vec4f,
}

@group(0) @binding(0) var<uniform> globals : Globals;
@group(0) @binding(1) var transmittance_texture : texture_2d<f32>;
@group(0) @binding(2) var transmittance_sampler : sampler;

struct VertexInput {
  @location(0) position : vec2f,
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) view_ray : vec3f,
}

@vertex
fn vs_main(input : VertexInput) -> VertexOutput {
  var clip = vec4f(input.position, 0.0, 1.0);
  var output : VertexOutput;
  output.position = clip;
  let view_clip = globals.view_from_clip * clip;
  output.view_ray =
      (globals.model_from_view * vec4f(view_clip.xyz, 0.0)).xyz;
  return output;
}

@fragment
fn fs_main(input : VertexOutput) -> @location(0) vec4f {
  let view_dir = normalize(input.view_ray);
  let sun_dir = normalize(globals.sun_direction_size.xyz);
  let cosine = max(dot(view_dir, sun_dir), 0.0);

  // Sample texture at corner to prevent binding from being optimized out
  // TODO: Use proper transmittance lookup for realistic sky colors
  let dummy = textureSample(transmittance_texture, transmittance_sampler, vec2f(0.5, 0.5));

  let dark_blue = vec3f(0.1, 0.2, 0.4);
  let bright_orange = vec3f(1.0, 0.6, 0.2);
  let sky_color = mix(dark_blue, bright_orange, cosine * cosine) + dummy.rgb * 0.0001;

  return vec4f(sky_color, 1.0);
}
`;

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

  const device = await adapter.requestDevice();
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

  uniformScratch.set(viewFromClip, 0);
  uniformScratch.set(modelFromView, 16);
  uniformScratch.set([camera[0], camera[1], camera[2], state.exposure], 32);
  uniformScratch.set([sunDir[0], sunDir[1], sunDir[2], sunSize[0]], 36);
  uniformScratch.set([whitePoint[0], whitePoint[1], whitePoint[2], sunSize[1]], 40);
  uniformScratch.set([earthCenter[0], earthCenter[1], earthCenter[2], 0], 44);

  return uniformScratch;
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
    });

    const quadBuffer = createFullscreenQuadBuffer(gpuState.device);
    const uniformBuffer = createGlobalUniformBuffer(gpuState.device);
    const bindGroup = gpuState.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: precomputedTextures.transmittance.createView() },
        { binding: 2, resource: lutSampler },
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

    setStatus('WebGPU ready — drawing sky gradient');

    window.addEventListener('resize', () => {
      configureContext(canvas, gpuState.context, gpuState.device, gpuState.format);
    });
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'WebGPU initialization failed');
  }
}

main();

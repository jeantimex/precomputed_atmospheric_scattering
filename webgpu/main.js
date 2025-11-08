const statusLabel = document.getElementById('status');
const canvas = document.getElementById('webgpu-canvas');

function setStatus(message) {
  if (statusLabel) {
    statusLabel.textContent = message;
  } else {
    console.info('[WebGPU status]', message);
  }
}

const triangleShaderWGSL = `
struct VertexOutput {
  @builtin(position) position : vec4f,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(0.0, 0.5),
    vec2f(-0.5, -0.5),
    vec2f(0.5, -0.5)
  );
  var output : VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return vec4f(0.2, 0.6, 0.95, 1.0);
}
`;

async function initWebGPU(targetCanvas) {
  const isLocalhost =
      ['localhost', '127.0.0.1', '', '::1'].includes(window.location.hostname);
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
  const shaderModule = device.createShaderModule({ code: triangleShaderWGSL });
  const descriptor = {
    layout: 'auto',
    vertex: { module: shaderModule, entryPoint: 'vs_main' },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{ format }]
    },
    primitive: { topology: 'triangle-list' }
  };
  return device.createRenderPipeline(descriptor);
}

function draw(device, context, pipeline) {
  const commandEncoder = device.createCommandEncoder();
  const view = context.getCurrentTexture().createView();
  const renderPassDescriptor = {
    colorAttachments: [
      {
        view,
        clearValue: { r: 0.02, g: 0.02, b: 0.04, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store'
      }
    ]
  };

  const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
  passEncoder.setPipeline(pipeline);
  passEncoder.draw(3);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
}

async function main() {
  try {
    const gpuState = await initWebGPU(canvas);
    const pipeline = await initPipeline(gpuState.device, gpuState.format);

    const render = () => {
      draw(gpuState.device, gpuState.context, pipeline);
      requestAnimationFrame(render);
    };
    render();

    setStatus('WebGPU ready — drawing debug triangle');

    window.addEventListener('resize', () => {
      configureContext(canvas, gpuState.context, gpuState.device, gpuState.format);
    });
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'WebGPU initialization failed');
  }
}

main();

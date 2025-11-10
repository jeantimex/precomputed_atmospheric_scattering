/**
 * WebGPU Precomputed Atmospheric Scattering Demo
 *
 * This application renders a physically-based sky and atmosphere using Eric Bruneton's
 * precomputed atmospheric scattering model. The implementation uses WebGPU for rendering
 * and relies on precomputed lookup tables (LUTs) for transmittance, scattering, and irradiance.
 *
 * Key Features:
 * - Interactive camera and sun positioning
 * - Real-time atmospheric scattering with accurate Rayleigh and Mie effects
 * - Exposure control for different viewing conditions
 * - Multiple preset views showcasing various atmospheric conditions
 */

// Import utility functions for texture loading and buffer management
import {
  loadPrecomputedTextures,     // Loads transmittance, scattering, and irradiance LUTs
  createFullscreenQuadBuffer,  // Creates vertex buffer for fullscreen quad rendering
  createGlobalUniformBuffer,   // Creates uniform buffer for shader parameters
  writeGlobalUniforms,         // Writes uniform data to GPU buffer
} from './utils.js';

// Import WGSL shader code as raw string (Vite handles this via ?raw suffix)
import skyShaderWGSL from './shader.wgsl?raw';

// Get references to DOM elements
const canvas = document.getElementById('webgpu-canvas');
const helpElement = document.getElementById('help');
const statusElement = document.getElementById('status-message');

/**
 * Shows a centered status message and hides the instruction overlay
 *
 * @param {string} message - Message to display to the user
 */
function showStatusMessage(message) {
  if (statusElement) {
    statusElement.textContent = message;
    statusElement.classList.remove('hidden');
  }
  if (helpElement) {
    helpElement.classList.add('hidden');
  }
}

/**
 * Physical Constants
 *
 * LENGTH_UNIT_IN_METERS: The model uses kilometers as the base unit (1000 meters)
 * This matches the scale of Earth's atmosphere (tens to hundreds of km)
 */
const LENGTH_UNIT_IN_METERS = 1000.0;

/**
 * SUN_ANGULAR_RADIUS: The sun's angular radius as seen from Earth (in radians)
 * The sun subtends approximately 0.00935 radians (0.536 degrees) in the sky
 * We use half of this for the radius calculation
 */
const SUN_ANGULAR_RADIUS = 0.00935 / 2.0;

/**
 * DEFAULT_STATE: Initial camera and rendering parameters
 *
 * - viewDistanceMeters: Camera distance from Earth's center (9km = near ground level)
 * - viewZenithAngleRadians: Camera's zenith angle (0 = looking up, π/2 = horizon, π = looking down)
 * - viewAzimuthAngleRadians: Camera's azimuth angle (horizontal rotation)
 * - sunZenithAngleRadians: Sun's zenith angle (controls time of day)
 * - sunAzimuthAngleRadians: Sun's azimuth angle (controls sun position on horizon)
 * - exposure: Tone mapping exposure value (higher = brighter image)
 */
const DEFAULT_STATE = {
  viewDistanceMeters: 9000,
  viewZenithAngleRadians: 1.47,
  viewAzimuthAngleRadians: -0.1,
  sunZenithAngleRadians: 1.3,
  sunAzimuthAngleRadians: 2.9,
  exposure: 10,
};

/**
 * PRESETS: Predefined camera and sun configurations (accessible via number keys 1-9)
 *
 * Each preset showcases different atmospheric conditions:
 * - Ground-level views with various sun angles (presets 1-7)
 * - High-altitude view showing Earth's curvature (preset 8: 2700km altitude)
 * - Space view showing full atmospheric shell (preset 9: 12000km altitude)
 */
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

/**
 * Reusable matrices and uniform buffer storage
 *
 * These are allocated once and reused each frame to avoid garbage collection:
 * - viewFromClip: Inverse projection matrix (transforms clip space to view space)
 * - modelFromView: Inverse view matrix (transforms view space to world/model space)
 * - uniformScratch: Scratch buffer for packing all uniform data before GPU upload
 */
const viewFromClip = new Float32Array(16);
const modelFromView = new Float32Array(16);
const uniformScratch = new Float32Array(64);

/**
 * Converts a 4x4 matrix from row-major to column-major layout
 *
 * JavaScript arrays are naturally row-major, but WGSL matrices are column-major.
 * This function performs the transpose during the copy operation.
 *
 * @param {Float32Array} target - Destination array
 * @param {number} offset - Starting index in target array (in float32 elements)
 * @param {Float32Array} source - Source matrix in row-major order
 */
function copyRowMajorToColumnMajor(target, offset, source) {
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      target[offset + column * 4 + row] = source[row * 4 + column];
    }
  }
}

/**
 * Initializes WebGPU device, adapter, and canvas context
 *
 * This function:
 * 1. Checks for secure context (HTTPS or localhost) - required for WebGPU
 * 2. Requests a GPU adapter with high-performance preference
 * 3. Requests a device with float32-filterable feature (for linear filtering on float textures)
 * 4. Configures the canvas context with proper DPI scaling
 *
 * @param {HTMLCanvasElement} targetCanvas - The canvas element to render to
 * @returns {Promise<{device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat}>}
 */
async function initWebGPU(targetCanvas) {
  // Check if WebGPU is available in the browser
  if (!navigator.gpu) {
    const message =
        'WebGPU is not available in this browser. Please use a WebGPU-enabled browser/version.';
    showStatusMessage(message);
    throw new Error(message);
  }

  // Request a GPU adapter (represents a physical GPU)
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    throw new Error('Failed to acquire GPU adapter.');
  }

  // Request a device with float32-filterable feature
  // This feature enables linear filtering on rgba32float textures (used for our LUTs)
  const device = await adapter.requestDevice({
    requiredFeatures: ['float32-filterable'],
  });

  // Get WebGPU context from canvas
  const context = targetCanvas.getContext('webgpu');
  if (!context) {
    throw new Error('Failed to acquire WebGPU context.');
  }

  // Get the preferred canvas format for this system (usually 'bgra8unorm')
  const format = navigator.gpu.getPreferredCanvasFormat();
  configureContext(targetCanvas, context, device, format);

  return { device, context, format };
}

/**
 * Configures the WebGPU canvas context with proper resolution and format
 *
 * This function handles high-DPI displays by scaling the canvas resolution
 * based on devicePixelRatio. On retina displays (devicePixelRatio = 2), this
 * doubles the resolution for crisp rendering.
 *
 * @param {HTMLCanvasElement} targetCanvas - The canvas to configure
 * @param {GPUCanvasContext} context - WebGPU canvas context
 * @param {GPUDevice} device - WebGPU device
 * @param {GPUTextureFormat} format - Texture format for the canvas
 */
function configureContext(targetCanvas, context, device, format) {
  const devicePixelRatio = window.devicePixelRatio || 1;
  targetCanvas.width = Math.max(1, Math.floor(targetCanvas.clientWidth * devicePixelRatio));
  targetCanvas.height = Math.max(1, Math.floor(targetCanvas.clientHeight * devicePixelRatio));
  context.configure({ device, format, alphaMode: 'opaque' });
}

/**
 * Creates the WebGPU render pipeline
 *
 * The pipeline defines how vertices are processed and how fragments are shaded:
 * - Vertex shader (vs_main): Transforms fullscreen quad vertices
 * - Fragment shader (fs_main): Computes atmospheric scattering for each pixel
 * - Topology: triangle-strip (4 vertices form 2 triangles = fullscreen quad)
 *
 * @param {GPUDevice} device - WebGPU device
 * @param {GPUTextureFormat} format - Output texture format
 * @returns {Promise<GPURenderPipeline>}
 */
async function initPipeline(device, format) {
  // Create shader module from WGSL code
  const shaderModule = device.createShaderModule({ code: skyShaderWGSL });

  const descriptor = {
    layout: 'auto', // Automatically infer bind group layout from shader

    // Vertex stage configuration
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: 8, // 2 floats × 4 bytes = 8 bytes per vertex
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' }, // 2D position
          ],
        },
      ],
    },

    // Fragment stage configuration
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{ format }], // Output to canvas format
    },

    // Primitive assembly: triangle-strip lets us draw a quad with 4 vertices
    primitive: { topology: 'triangle-strip' },
  };

  return device.createRenderPipeline(descriptor);
}

/**
 * Renders a single frame to the canvas
 *
 * This function:
 * 1. Creates a command encoder to record GPU commands
 * 2. Begins a render pass with the canvas as the target
 * 3. Sets the pipeline, bind group (uniforms + textures), and vertex buffer
 * 4. Draws 4 vertices as a triangle-strip (forming a fullscreen quad)
 * 5. Submits the commands to the GPU queue
 *
 * @param {GPUDevice} device - WebGPU device
 * @param {GPUCanvasContext} context - Canvas context
 * @param {GPURenderPipeline} pipeline - Render pipeline
 * @param {GPUBindGroup} bindGroup - Bind group containing uniforms and textures
 * @param {GPUBuffer} vertexBuffer - Vertex buffer with fullscreen quad positions
 */
function draw(device, context, pipeline, bindGroup, vertexBuffer) {
  // Create a command encoder to record rendering commands
  const commandEncoder = device.createCommandEncoder();

  // Get the current canvas texture to render to
  const view = context.getCurrentTexture().createView();

  const renderPassDescriptor = {
    colorAttachments: [
      {
        view,
        clearValue: { r: 0.02, g: 0.02, b: 0.04, a: 1.0 }, // Dark blue clear color
        loadOp: 'clear',   // Clear the texture before rendering
        storeOp: 'store',  // Store the results to the texture
      },
    ],
  };

  // Begin render pass and record commands
  const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.setVertexBuffer(0, vertexBuffer);
  passEncoder.draw(4); // Draw 4 vertices (triangle-strip creates 2 triangles)
  passEncoder.end();

  // Submit the recorded commands to the GPU queue for execution
  device.queue.submit([commandEncoder.finish()]);
}

/**
 * Computes and packs all uniform data for the shader
 *
 * This function builds the camera transformation matrices and gathers all
 * rendering parameters into a single buffer that will be uploaded to the GPU.
 *
 * The uniform buffer layout matches the WGSL Globals struct:
 * - viewFromClip (mat4x4<f32>): Inverse projection matrix
 * - modelFromView (mat4x4<f32>): Inverse view matrix
 * - camera (vec3<f32>) + exposure (f32)
 * - sunDirection (vec3<f32>) + sunSize.x (f32)
 * - whitePoint (vec3<f32>) + sunSize.y (f32)
 * - earthCenter (vec3<f32>) + padding (f32)
 *
 * @param {HTMLCanvasElement} canvas - Canvas element (for aspect ratio)
 * @param {Object} state - Current camera and sun state
 * @returns {Float32Array} Packed uniform data ready for GPU upload
 */
function updateGlobalUniforms(canvas, state) {
  // Build inverse projection matrix (viewFromClip)
  // This transforms from clip space [-1,1] to view space
  const kFovY = (50 / 180) * Math.PI;
  const kTanFovY = Math.tan(kFovY / 2);
  const aspect = canvas.width / canvas.height;
  viewFromClip.set([
    kTanFovY * aspect, 0, 0, 0,
    0, kTanFovY, 0, 0,
    0, 0, 0, -1,
    0, 0, 1, 1,
  ]);

  // Build inverse view matrix (modelFromView)
  // This transforms from view space to world space and positions the camera
  // using spherical coordinates (zenith and azimuth angles)
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

  // Extract camera position from the translation column of modelFromView
  const camera = [
    modelFromView[3],
    modelFromView[7],
    modelFromView[11],
  ];

  // Compute sun direction vector from spherical coordinates
  // zenith = 0 means sun is directly overhead
  // zenith = π/2 means sun is on the horizon
  const sunDir = [
    Math.cos(state.sunAzimuthAngleRadians) * Math.sin(state.sunZenithAngleRadians),
    Math.sin(state.sunAzimuthAngleRadians) * Math.sin(state.sunZenithAngleRadians),
    Math.cos(state.sunZenithAngleRadians),
  ];

  // Sun size parameters for rendering the solar disk
  // x: tan(angular_radius) - used for disk size calculation
  // y: cos(angular_radius) - used for smooth edges
  const sunSize = [Math.tan(SUN_ANGULAR_RADIUS), Math.cos(SUN_ANGULAR_RADIUS)];

  // White point for tone mapping (neutral white)
  const whitePoint = [1, 1, 1];

  // Earth center position in world space
  // Earth radius is 6360 km, positioned below the origin
  const earthCenter = [0, 0, -6360000 / LENGTH_UNIT_IN_METERS];

  // Pack all data into the uniform buffer (converting matrices to column-major)
  copyRowMajorToColumnMajor(uniformScratch, 0, viewFromClip);   // Offset 0: mat4x4 (16 floats)
  copyRowMajorToColumnMajor(uniformScratch, 16, modelFromView); // Offset 16: mat4x4 (16 floats)
  uniformScratch.set([camera[0], camera[1], camera[2], state.exposure], 32);       // Offset 32: vec4
  uniformScratch.set([sunDir[0], sunDir[1], sunDir[2], sunSize[0]], 36);          // Offset 36: vec4
  uniformScratch.set([whitePoint[0], whitePoint[1], whitePoint[2], sunSize[1]], 40); // Offset 40: vec4
  uniformScratch.set([earthCenter[0], earthCenter[1], earthCenter[2], 0], 44);    // Offset 44: vec4

  return uniformScratch;
}

/**
 * Applies a preset configuration to the controls
 *
 * @param {Object} controls - Control state object to update
 * @param {string} presetKey - Key for the preset (e.g., '1', '2', ..., '9')
 * @returns {boolean} True if preset was found and applied, false otherwise
 */
function applyPreset(controls, presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) {
    return false;
  }
  Object.assign(controls, preset);
  return true;
}

/**
 * Main application entry point
 *
 * This function:
 * 1. Initializes WebGPU (device, context, pipeline)
 * 2. Loads precomputed atmospheric scattering LUTs
 * 3. Creates GPU resources (buffers, bind groups)
 * 4. Sets up the render loop
 * 5. Attaches event handlers for user interaction
 */
async function main() {
  try {
    // Initialize WebGPU and create the render pipeline
    const gpuState = await initWebGPU(canvas);
    const pipeline = await initPipeline(gpuState.device, gpuState.format);

    // Load precomputed lookup tables (transmittance, scattering, irradiance)
    const precomputedTextures = await loadPrecomputedTextures(gpuState.device);

    // Create sampler for LUT textures
    // Linear filtering provides smooth interpolation between LUT values
    // Clamp-to-edge prevents artifacts at texture boundaries
    const lutSampler = gpuState.device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    });

    // Create vertex buffer (fullscreen quad) and uniform buffer
    const quadBuffer = createFullscreenQuadBuffer(gpuState.device);
    const uniformBuffer = createGlobalUniformBuffer(gpuState.device);

    // Create bind group that connects shader bindings to GPU resources
    const bindGroup = gpuState.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },                        // Uniforms
        { binding: 1, resource: precomputedTextures.transmittance.createView() },  // Transmittance LUT
        { binding: 2, resource: precomputedTextures.scattering.createView() },     // Scattering LUT
        { binding: 3, resource: precomputedTextures.irradiance.createView() },     // Irradiance LUT
        { binding: 4, resource: lutSampler },                                       // Sampler
      ],
    });

    // Initialize control state
    const controls = { ...DEFAULT_STATE };

    // Render loop: updates uniforms and draws each frame
    const render = () => {
      const data = updateGlobalUniforms(canvas, controls);
      writeGlobalUniforms(gpuState.device, uniformBuffer, data);
      draw(gpuState.device, gpuState.context, pipeline, bindGroup, quadBuffer);
      requestAnimationFrame(render);
    };
    render(); // Start the render loop

    /**
     * Keyboard Controls
     *
     * +/=: Increase exposure (brighten image)
     * -: Decrease exposure (darken image)
     * h: Toggle help overlay
     * 1-9: Apply preset camera/sun configurations
     */
    window.addEventListener('keydown', (event) => {
      // Exposure controls
      if (event.key === '=' || event.key === '+') {
        controls.exposure *= 1.1; // Increase by 10%
        event.preventDefault();
        return;
      }
      if (event.key === '-') {
        controls.exposure = Math.max(0.01, controls.exposure / 1.1); // Decrease by 10%, min 0.01
        event.preventDefault();
        return;
      }

      // Toggle help overlay
      if (event.key === 'h' || event.key === 'H') {
        if (helpElement) {
          helpElement.classList.toggle('hidden');
        }
        event.preventDefault();
        return;
      }

      // Preset views (1-9)
      if (applyPreset(controls, event.key)) {
        event.preventDefault();
      }
    });

    /**
     * Mouse Wheel Control
     *
     * Zoom in/out by adjusting camera distance from Earth's center
     */
    canvas.addEventListener('wheel', (event) => {
      const scale = event.deltaY > 0 ? 1.05 : 1 / 1.05;
      controls.viewDistanceMeters *= scale;
      controls.viewDistanceMeters = Math.max(1.0, controls.viewDistanceMeters); // Prevent going below 1 meter
      event.preventDefault();
    }, { passive: false }); // passive: false allows preventDefault()

    /**
     * Mouse Drag Controls
     *
     * Drag: Rotate camera (change view direction)
     * Shift+Drag: Rotate sun (change sun position)
     *
     * The drag system uses pointer events for better device compatibility
     */
    let dragMode = null;  // 'camera' or 'sun' or null
    let prevPointerX = 0;
    let prevPointerY = 0;
    const kScale = 500;   // Sensitivity factor for mouse movement

    // Start dragging
    canvas.addEventListener('pointerdown', (event) => {
      // Shift key switches to sun control mode
      dragMode = event.shiftKey ? 'sun' : 'camera';

      // Record initial pointer position (relative to canvas)
      const rect = canvas.getBoundingClientRect();
      prevPointerX = event.clientX - rect.left;
      prevPointerY = event.clientY - rect.top;

      // Capture pointer to receive move events even outside canvas
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    // Handle dragging
    canvas.addEventListener('pointermove', (event) => {
      if (!dragMode || !canvas.hasPointerCapture(event.pointerId)) {
        return;
      }

      // Calculate delta movement
      const rect = canvas.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const dx = prevPointerX - pointerX;
      const dy = prevPointerY - pointerY;

      if (dragMode === 'sun') {
        // Adjust sun position
        controls.sunZenithAngleRadians -= dy / kScale;
        controls.sunZenithAngleRadians = Math.min(Math.PI, Math.max(0, controls.sunZenithAngleRadians));
        controls.sunAzimuthAngleRadians += dx / kScale;
      } else {
        // Adjust camera view direction
        controls.viewZenithAngleRadians += dy / kScale;
        // Clamp zenith to [0, π/2] to prevent flipping upside down
        controls.viewZenithAngleRadians =
            Math.min(Math.PI / 2, Math.max(0, controls.viewZenithAngleRadians));
        controls.viewAzimuthAngleRadians += dx / kScale;
      }

      // Update previous position for next frame
      prevPointerX = pointerX;
      prevPointerY = pointerY;
    });

    // End dragging (on pointer up or cancel)
    const endDrag = (event) => {
      if (!canvas.hasPointerCapture(event.pointerId)) {
        return;
      }
      canvas.releasePointerCapture(event.pointerId);
      dragMode = null;
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    /**
     * Window Resize Handler
     *
     * Reconfigures the canvas context to match new window dimensions
     * with proper DPI scaling
     */
    window.addEventListener('resize', () => {
      configureContext(canvas, gpuState.context, gpuState.device, gpuState.format);
    });
  } catch (error) {
    console.error(error);
    const fallbackMessage =
        'Unable to start the WebGPU demo in this browser. See console for details.';
    showStatusMessage(error instanceof Error && error.message ? error.message : fallbackMessage);
  }
}

// Start the application
main();

/**
 * WebGPU Utility Functions for Atmospheric Scattering Demo
 *
 * This module provides helper functions for:
 * - Loading precomputed lookup table (LUT) textures from .dat files
 * - Creating WebGPU buffers and textures
 * - Managing uniform data uploads
 */

/**
 * LUT_SPECS: Specifications for precomputed atmospheric scattering lookup tables
 *
 * These tables are precomputed offline and stored as binary .dat files containing
 * Float32 RGBA data. The tables store:
 *
 * - transmittance: 2D texture (256x64) - Light absorption through atmosphere
 *   Parameterized by (r, mu) = (altitude, view zenith angle)
 *
 * - scattering: 3D texture (256x128x32) - Combined Rayleigh+Mie scattering
 *   4D data (r, mu, mu_s, nu) packed into 3D by treating nu as horizontal slices
 *
 * - irradiance: 2D texture (64x16) - Ground-level lighting from sun + sky
 *   Parameterized by (r, mu_s) = (altitude, sun zenith angle)
 */
const LUT_SPECS = {
  transmittance: {
    url: new URL('../assets/transmittance.dat', import.meta.url).href,
    width: 256,
    height: 64,
    depthOrArrayLayers: 1,
    dimension: '2d',
  },
  scattering: {
    url: new URL('../assets/scattering.dat', import.meta.url).href,
    width: 256,
    height: 128,
    depthOrArrayLayers: 32,
    dimension: '3d',
  },
  irradiance: {
    url: new URL('../assets/irradiance.dat', import.meta.url).href,
    width: 64,
    height: 16,
    depthOrArrayLayers: 1,
    dimension: '2d',
  },
};

/**
 * fetchDatFile: Loads and parses a binary .dat file containing Float32 data
 *
 * The .dat files contain raw Float32 RGBA pixel data in little-endian format.
 * This function:
 * 1. Fetches the binary file
 * 2. Reads Float32 values in little-endian byte order
 * 3. Returns a Float32Array suitable for GPU upload
 *
 * @param {string} url - URL to the .dat file
 * @returns {Promise<Float32Array>} Array of Float32 RGBA values
 * @throws {Error} If the fetch fails
 */
async function fetchDatFile(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const dataView = new DataView(buffer);
  const array = new Float32Array(buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);

  // Read Float32 values in little-endian format
  for (let i = 0; i < array.length; ++i) {
    array[i] = dataView.getFloat32(i * Float32Array.BYTES_PER_ELEMENT, true);
  }

  return array;
}

/**
 * createTexture: Creates a WebGPU texture for LUT storage
 *
 * Creates a texture with rgba32float format (4 × Float32 per pixel) to store
 * precomputed atmospheric scattering data. The texture is configured for:
 * - TEXTURE_BINDING: Can be bound to shaders for sampling
 * - COPY_DST: Can receive data via writeTexture
 *
 * @param {GPUDevice} device - WebGPU device
 * @param {Object} spec - Texture specification (width, height, dimension, etc.)
 * @returns {GPUTexture} Created texture
 */
function createTexture(device, spec) {
  return device.createTexture({
    size: [spec.width, spec.height, spec.depthOrArrayLayers],
    dimension: spec.dimension === '3d' ? '3d' : '2d',
    format: 'rgba32float',  // 4 × 32-bit floats per pixel (128 bits/pixel)
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
}

/**
 * uploadTextureData: Uploads Float32 data to a WebGPU texture
 *
 * Transfers the precomputed LUT data from CPU memory to GPU texture memory.
 * The data must be in RGBA format (4 floats per pixel).
 *
 * Layout calculation:
 * - Each pixel: 4 floats (RGBA) × 4 bytes = 16 bytes
 * - Each row: width × 16 bytes
 * - For 3D textures: multiple 2D slices stacked
 *
 * @param {GPUDevice} device - WebGPU device
 * @param {GPUTexture} texture - Target texture
 * @param {Object} spec - Texture specification (dimensions)
 * @param {Float32Array} data - RGBA float data to upload
 */
function uploadTextureData(device, texture, spec, data) {
  const bytesPerElement = Float32Array.BYTES_PER_ELEMENT;  // 4 bytes
  const bytesPerRow = spec.width * 4 * bytesPerElement;    // width × RGBA × 4 bytes
  const rowsPerImage = spec.height;

  device.queue.writeTexture(
      { texture },
      data,
      {
        bytesPerRow,
        rowsPerImage,
      },
      {
        width: spec.width,
        height: spec.height,
        depthOrArrayLayers: spec.depthOrArrayLayers,
      });
}

/**
 * loadPrecomputedTextures: Loads all atmospheric scattering LUTs
 *
 * This function is the main entry point for loading precomputed data.
 * It loads all three LUTs in parallel:
 * 1. Transmittance (2D)
 * 2. Scattering (3D)
 * 3. Irradiance (2D)
 *
 * Process for each texture:
 * 1. Fetch binary .dat file from assets
 * 2. Parse Float32 data
 * 3. Create GPU texture with appropriate dimensions
 * 4. Upload data to GPU
 *
 * @param {GPUDevice} device - WebGPU device
 * @returns {Promise<Object>} Object with keys: { transmittance, scattering, irradiance }
 *                             Values are GPUTexture objects ready for binding
 */
export async function loadPrecomputedTextures(device) {
  const entries = await Promise.all(Object.entries(LUT_SPECS).map(async ([key, spec]) => {
    const data = await fetchDatFile(spec.url);
    const texture = createTexture(device, spec);
    uploadTextureData(device, texture, spec, data);
    return [key, texture];
  }));
  return Object.fromEntries(entries);
}

// Export LUT specs for external use (if needed)
export const lutSpecs = LUT_SPECS;

/**
 * FULLSCREEN_QUAD_VERTS: Vertex positions for a fullscreen quad
 *
 * Two triangles forming a quad covering the entire screen in clip space [-1,1]:
 * - Triangle 1: (-1,-1), (1,-1), (-1,1)
 * - Triangle 2: (-1,1), (1,-1), (1,1)
 *
 * Using triangle-strip topology, these 4 vertices form 2 triangles.
 * The fragment shader will run for every pixel on screen.
 */
const FULLSCREEN_QUAD_VERTS = new Float32Array([
  -1, -1,  // Bottom-left
  1, -1,   // Bottom-right
  -1, 1,   // Top-left
  1, 1,    // Top-right
]);

/**
 * createFullscreenQuadBuffer: Creates vertex buffer for fullscreen rendering
 *
 * Creates a GPU buffer containing vertex positions for a fullscreen quad.
 * This quad covers the entire viewport and is used for post-processing effects
 * and raymarching (as in this atmospheric scattering demo).
 *
 * The buffer is configured for:
 * - VERTEX: Can be bound as vertex buffer in render pass
 * - COPY_DST: Can receive data via writeBuffer
 *
 * @param {GPUDevice} device - WebGPU device
 * @returns {GPUBuffer} Vertex buffer with 4 vertices (8 floats total)
 */
export function createFullscreenQuadBuffer(device) {
  const buffer = device.createBuffer({
    size: FULLSCREEN_QUAD_VERTS.byteLength,  // 8 floats × 4 bytes = 32 bytes
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  // Upload vertex data to GPU
  device.queue.writeBuffer(
      buffer, 0,
      FULLSCREEN_QUAD_VERTS.buffer,
      FULLSCREEN_QUAD_VERTS.byteOffset,
      FULLSCREEN_QUAD_VERTS.byteLength);

  return buffer;
}

/**
 * Uniform Buffer Configuration
 *
 * The uniform buffer holds all per-frame shader parameters:
 * - 2 × mat4x4 (32 floats): viewFromClip, modelFromView matrices
 * - 4 × vec4 (16 floats): camera+exposure, sun+size, whitePoint+size, earthCenter
 * Total: 48 floats minimum, padded to 64 for alignment
 */
const GLOBAL_UNIFORM_FLOAT_COUNT = 64;  // 64 floats = 256 bytes
export const GLOBAL_UNIFORM_BUFFER_SIZE =
    GLOBAL_UNIFORM_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;

/**
 * createGlobalUniformBuffer: Creates uniform buffer for shader parameters
 *
 * Creates a GPU buffer to hold per-frame rendering parameters (matrices,
 * camera position, sun direction, exposure, etc.). The buffer is configured for:
 * - UNIFORM: Can be bound as uniform buffer in shaders
 * - COPY_DST: Can receive data via writeBuffer (updated each frame)
 *
 * @param {GPUDevice} device - WebGPU device
 * @returns {GPUBuffer} Uniform buffer (256 bytes)
 */
export function createGlobalUniformBuffer(device) {
  return device.createBuffer({
    size: GLOBAL_UNIFORM_BUFFER_SIZE,  // 256 bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

/**
 * writeGlobalUniforms: Updates uniform buffer with new data
 *
 * Uploads the latest uniform data to the GPU. This is called every frame
 * to update camera matrices, sun position, exposure, etc.
 *
 * @param {GPUDevice} device - WebGPU device
 * @param {GPUBuffer} buffer - Target uniform buffer
 * @param {Float32Array} data - Uniform data (should be 64 floats = 256 bytes)
 */
export function writeGlobalUniforms(device, buffer, data) {
  device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
}

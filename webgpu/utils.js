const LUT_SPECS = {
  transmittance: {
    url: new URL('./transmittance.dat', import.meta.url).href,
    width: 256,
    height: 64,
    depthOrArrayLayers: 1,
    dimension: '2d',
  },
  scattering: {
    url: new URL('./scattering.dat', import.meta.url).href,
    width: 256,
    height: 128,
    depthOrArrayLayers: 32,
    dimension: '3d',
  },
  irradiance: {
    url: new URL('./irradiance.dat', import.meta.url).href,
    width: 64,
    height: 16,
    depthOrArrayLayers: 1,
    dimension: '2d',
  },
};

async function fetchDatFile(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  const dataView = new DataView(buffer);
  const array = new Float32Array(buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
  for (let i = 0; i < array.length; ++i) {
    array[i] = dataView.getFloat32(i * Float32Array.BYTES_PER_ELEMENT, true);
  }
  return array;
}

function createTexture(device, spec) {
  return device.createTexture({
    size: [spec.width, spec.height, spec.depthOrArrayLayers],
    dimension: spec.dimension === '3d' ? '3d' : '2d',
    format: 'rgba32float',  // Changed from rgba16float to match Float32Array data
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
}

function uploadTextureData(device, texture, spec, data) {
  const bytesPerElement = Float32Array.BYTES_PER_ELEMENT;
  const bytesPerRow = spec.width * 4 * bytesPerElement;
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

export async function loadPrecomputedTextures(device) {
  const entries = await Promise.all(Object.entries(LUT_SPECS).map(async ([key, spec]) => {
    const data = await fetchDatFile(spec.url);
    const texture = createTexture(device, spec);
    uploadTextureData(device, texture, spec, data);
    return [key, texture];
  }));
  return Object.fromEntries(entries);
}

export const lutSpecs = LUT_SPECS;

const FULLSCREEN_QUAD_VERTS = new Float32Array([
  -1, -1,
  1, -1,
  -1, 1,
  1, 1,
]);

export function createFullscreenQuadBuffer(device) {
  const buffer = device.createBuffer({
    size: FULLSCREEN_QUAD_VERTS.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(
      buffer, 0,
      FULLSCREEN_QUAD_VERTS.buffer,
      FULLSCREEN_QUAD_VERTS.byteOffset,
      FULLSCREEN_QUAD_VERTS.byteLength);
  return buffer;
}

const GLOBAL_UNIFORM_FLOAT_COUNT = 64; // 256 bytes
export const GLOBAL_UNIFORM_BUFFER_SIZE =
    GLOBAL_UNIFORM_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;

export function createGlobalUniformBuffer(device) {
  return device.createBuffer({
    size: GLOBAL_UNIFORM_BUFFER_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

export function writeGlobalUniforms(device, buffer, data) {
  device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
}

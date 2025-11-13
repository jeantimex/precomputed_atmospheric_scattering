import {
  ClampToEdgeWrapping,
  Data3DTexture,
  DataTexture,
  FloatType,
  LinearFilter,
  RGBAFormat,
} from 'three';

/**
 * Shared LUT specs (mirrors `webgpu/utils.js`).
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

async function fetchDatFile(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  const array = new Float32Array(buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
  for (let i = 0; i < array.length; i += 1) {
    array[i] = view.getFloat32(i * Float32Array.BYTES_PER_ELEMENT, true);
  }
  return array;
}

function createTexture(spec, data) {
  const is3D = spec.dimension === '3d';
  const texture = is3D
    ? new Data3DTexture(data, spec.width, spec.height, spec.depthOrArrayLayers)
    : new DataTexture(data, spec.width, spec.height);
  texture.format = RGBAFormat;
  texture.type = FloatType;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  if (is3D) {
    texture.wrapR = ClampToEdgeWrapping;
  }
  texture.needsUpdate = true;
  return texture;
}

export async function loadPrecomputedTextures() {
  const entries = await Promise.all(
      Object.entries(LUT_SPECS).map(async ([key, spec]) => {
        const data = await fetchDatFile(spec.url);
        const texture = createTexture(spec, data);
        return [key, texture];
      }),
  );
  return Object.fromEntries(entries);
}

export const lutSpecs = LUT_SPECS;

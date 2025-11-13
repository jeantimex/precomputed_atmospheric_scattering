import {
  BufferAttribute,
  BufferGeometry,
  Color,
  FloatType,
  Mesh,
  PerspectiveCamera,
  Scene,
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { uv, uniform, uniformTexture, texture, vec3 } from 'three/tsl';
import MeshBasicNodeMaterial from 'three/src/materials/nodes/MeshBasicNodeMaterial.js';
import { loadPrecomputedTextures } from './luts.js';
import { DEFAULT_STATE } from './state.js';
import { updateAtmosphereUniforms } from './uniforms.js';

/**
 * Shared DOM references
 */
const canvas = document.getElementById('webgpu-canvas');
const statusElement = document.getElementById('status-message');

/**
 * Utility helpers for status overlay
 */
function showStatus(message) {
  if (!statusElement) {
    console.warn('Missing status element; message:', message);
    return;
  }
  statusElement.textContent = message;
  statusElement.classList.remove('hidden');
}

function hideStatus() {
  if (statusElement) {
    statusElement.classList.add('hidden');
  }
}

/**
 * Resize the renderer + camera when the canvas size changes
 */
function updateRendererSize(renderer, camera) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

/**
 * Minimal "Hello WebGPU" scene rendered via Three.js WebGPURenderer.
 */
async function init() {
  if (!canvas) {
    throw new Error('Canvas element #webgpu-canvas not found.');
  }
  if (!navigator.gpu) {
    throw new Error('WebGPU not available in this browser.');
  }

  const renderer = new WebGPURenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);

  const scene = new Scene();
  scene.background = new Color(0x0a0f1f);

  const camera = new PerspectiveCamera(
      50,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      10,
  );
  camera.position.z = 1;

  /**
   * Create a simple fullscreen quad to prove rendering works.
   */
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    -1, -1, 0,
    3, -1, 0,
    -1, 3, 0,
  ]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([
    0, 0,
    2, 0,
    0, 2,
  ]), 2));

  const transmittanceNode = uniformTexture();
  const exposureNode = uniform(DEFAULT_STATE.exposure);
  const debugColor = texture(transmittanceNode, uv().mul(0.5)).rgb.mul(exposureNode.mul(0.05));
  const material = new MeshBasicNodeMaterial({
    colorNode: vec3(debugColor),
  });
  const quad = new Mesh(geometry, material);
  scene.add(quad);

  await renderer.init();
  updateRendererSize(renderer, camera);

  const textures = await loadPrecomputedTextures();
  console.log('Loaded LUT textures:', {
    transmittance: {
      size: textures.transmittance.image.data.length,
      dimensions: `${textures.transmittance.image.width}x${textures.transmittance.image.height}`,
      isFloat32: textures.transmittance.type === FloatType,
      sample: Array.from(textures.transmittance.image.data.slice(0, 4)),
    },
    scattering: {
      size: textures.scattering.image.data.length,
      dimensions: `${textures.scattering.image.width}x${textures.scattering.image.height}x${textures.scattering.image.depth}`,
      isFloat32: textures.scattering.type === FloatType,
    },
    irradiance: {
      size: textures.irradiance.image.data.length,
      dimensions: `${textures.irradiance.image.width}x${textures.irradiance.image.height}`,
      isFloat32: textures.irradiance.type === FloatType,
    },
  });

  const uniforms = updateAtmosphereUniforms(
      { width: canvas.width, height: canvas.height },
      DEFAULT_STATE,
  );
  console.log('Global uniform sample (camera + sun):', Array.from(uniforms.slice(32, 44)));

  transmittanceNode.value = textures.transmittance;

  const onResize = () => updateRendererSize(renderer, camera);
  window.addEventListener('resize', onResize);

  renderer.setAnimationLoop(() => {
    renderer.render(scene, camera);
  });

  hideStatus();

  return () => {
    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', onResize);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
  };
}

init().catch((error) => {
  console.error(error);
  showStatus(error instanceof Error ? error.message : 'Initialization failed.');
});

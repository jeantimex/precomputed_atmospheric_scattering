import {
  Color,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from 'three';
import { WebGPURenderer } from 'three/webgpu';

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
  const geometry = new PlaneGeometry(2, 2);
  const material = new MeshBasicMaterial({ color: 0x1d7cf2 });
  const quad = new Mesh(geometry, material);
  scene.add(quad);

  await renderer.init();
  updateRendererSize(renderer, camera);

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

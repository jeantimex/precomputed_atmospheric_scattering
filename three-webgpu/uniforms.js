import { LENGTH_UNIT_IN_METERS, SUN_ANGULAR_RADIUS } from './state.js';

const viewFromClip = new Float32Array(16);
const modelFromView = new Float32Array(16);
const uniformScratch = new Float32Array(64);

export function copyRowMajorToColumnMajor(target, offset, source) {
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      target[offset + column * 4 + row] = source[row * 4 + column];
    }
  }
}

export function updateAtmosphereUniforms(size, state, target = uniformScratch) {
  const kFovY = (50 / 180) * Math.PI;
  const kTanFovY = Math.tan(kFovY / 2);
  const aspect = size.width / size.height;
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

  copyRowMajorToColumnMajor(target, 0, viewFromClip);
  copyRowMajorToColumnMajor(target, 16, modelFromView);
  target.set([camera[0], camera[1], camera[2], state.exposure], 32);
  target.set([sunDir[0], sunDir[1], sunDir[2], sunSize[0]], 36);
  target.set([whitePoint[0], whitePoint[1], whitePoint[2], sunSize[1]], 40);
  target.set([earthCenter[0], earthCenter[1], earthCenter[2], 0], 44);
  return target;
}

export function getUniformScratchBuffer() {
  return uniformScratch;
}

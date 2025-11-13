export const LENGTH_UNIT_IN_METERS = 1000.0;
export const SUN_ANGULAR_RADIUS = 0.00935 / 2.0;

export const DEFAULT_STATE = {
  viewDistanceMeters: 9000,
  viewZenithAngleRadians: 1.47,
  viewAzimuthAngleRadians: -0.1,
  sunZenithAngleRadians: 1.3,
  sunAzimuthAngleRadians: 2.9,
  exposure: 10,
};

export const PRESETS = {
  1: { viewDistanceMeters: 9000, viewZenithAngleRadians: 1.47, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.3, sunAzimuthAngleRadians: 3.0, exposure: 10 },
  2: { viewDistanceMeters: 9000, viewZenithAngleRadians: 1.47, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.564, sunAzimuthAngleRadians: -3.0, exposure: 10 },
  3: { viewDistanceMeters: 7000, viewZenithAngleRadians: 1.57, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.54, sunAzimuthAngleRadians: -2.96, exposure: 10 },
  4: { viewDistanceMeters: 7000, viewZenithAngleRadians: 1.57, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.328, sunAzimuthAngleRadians: -3.044, exposure: 10 },
  5: { viewDistanceMeters: 9000, viewZenithAngleRadians: 1.39, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.2, sunAzimuthAngleRadians: 0.7, exposure: 10 },
  6: { viewDistanceMeters: 9000, viewZenithAngleRadians: 1.5, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.628, sunAzimuthAngleRadians: 1.05, exposure: 200 },
  7: { viewDistanceMeters: 7000, viewZenithAngleRadians: 1.43, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.57, sunAzimuthAngleRadians: 1.34, exposure: 40 },
  8: { viewDistanceMeters: 2.7e6, viewZenithAngleRadians: 0.81, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 1.57, sunAzimuthAngleRadians: 2.0, exposure: 10 },
  9: { viewDistanceMeters: 1.2e7, viewZenithAngleRadians: 0.0, viewAzimuthAngleRadians: 0, sunZenithAngleRadians: 0.93, sunAzimuthAngleRadians: -2.0, exposure: 10 },
};

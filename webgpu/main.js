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

function copyRowMajorToColumnMajor(target, offset, source) {
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      target[offset + column * 4 + row] = source[row * 4 + column];
    }
  }
}

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

// ============================================================================
// ATMOSPHERE CONSTANTS AND TYPE DEFINITIONS
// ============================================================================

// Texture dimensions for precomputed lookup tables
const TRANSMITTANCE_TEXTURE_WIDTH: i32 = 256;
const TRANSMITTANCE_TEXTURE_HEIGHT: i32 = 64;
const SCATTERING_TEXTURE_R_SIZE: i32 = 32;
const SCATTERING_TEXTURE_MU_SIZE: i32 = 128;
const SCATTERING_TEXTURE_MU_S_SIZE: i32 = 32;
const SCATTERING_TEXTURE_NU_SIZE: i32 = 8;
const IRRADIANCE_TEXTURE_WIDTH: i32 = 64;
const IRRADIANCE_TEXTURE_HEIGHT: i32 = 16;

// Physical unit constants (base units set to 1.0)
const m: f32 = 1.0;
const nm: f32 = 1.0;
const rad: f32 = 1.0;
const sr: f32 = 1.0;
const watt: f32 = 1.0;
const lm: f32 = 1.0;

// Mathematical constants
const PI: f32 = 3.14159265358979323846;

// Derived unit constants
const km: f32 = 1000.0 * m;
const m2: f32 = m * m;
const m3: f32 = m * m * m;
const pi: f32 = PI * rad;
const deg: f32 = pi / 180.0;
const watt_per_square_meter: f32 = watt / m2;
const watt_per_square_meter_per_sr: f32 = watt / (m2 * sr);
const watt_per_square_meter_per_nm: f32 = watt / (m2 * nm);
const watt_per_square_meter_per_sr_per_nm: f32 = watt / (m2 * sr * nm);
const watt_per_cubic_meter_per_sr_per_nm: f32 = watt / (m3 * sr * nm);
const cd: f32 = lm / sr;
const kcd: f32 = 1000.0 * cd;
const cd_per_square_meter: f32 = cd / m2;
const kcd_per_square_meter: f32 = kcd / m2;

// Conversion factors for spectral radiance to luminance
const SKY_SPECTRAL_RADIANCE_TO_LUMINANCE: vec3f = vec3f(114974.916437, 71305.954816, 65310.548555);
const SUN_SPECTRAL_RADIANCE_TO_LUMINANCE: vec3f = vec3f(98242.786222, 69954.398112, 66475.012354);

// Sphere constants (demonstration sphere floating in atmosphere)
const kLengthUnitInMeters: f32 = 1000.0;
const kSphereCenter: vec3f = vec3f(0.0, 0.0, 1000.0) / kLengthUnitInMeters;
const kSphereRadius: f32 = 1000.0 / kLengthUnitInMeters;
const kSphereAlbedo: vec3f = vec3f(0.8);
const kGroundAlbedo: vec3f = vec3f(0.0, 0.0, 0.04);

// Type aliases (WGSL doesn't support typedef, so these are documented here for reference)
// Length = f32, Wavelength = f32, Angle = f32, SolidAngle = f32
// Power = f32, LuminousPower = f32, Number = f32, InverseLength = f32
// Area = f32, Volume = f32, NumberDensity = f32
// Irradiance = f32, Radiance = f32, SpectralPower = f32
// SpectralIrradiance = f32, SpectralRadiance = f32, SpectralRadianceDensity = f32
// ScatteringCoefficient = f32, InverseSolidAngle = f32
// LuminousIntensity = f32, Luminance = f32, Illuminance = f32
// AbstractSpectrum = vec3f, DimensionlessSpectrum = vec3f, PowerSpectrum = vec3f
// IrradianceSpectrum = vec3f, RadianceSpectrum = vec3f, RadianceDensitySpectrum = vec3f
// ScatteringSpectrum = vec3f, Position = vec3f, Direction = vec3f
// Luminance3 = vec3f, Illuminance3 = vec3f

// Density profile layer for modeling atmosphere density variations with altitude
struct DensityProfileLayer {
  width: f32,              // Layer width (Length)
  exp_term: f32,           // Exponential term coefficient (Number)
  exp_scale: f32,          // Exponential scale factor (InverseLength)
  linear_term: f32,        // Linear term coefficient (InverseLength)
  constant_term: f32,      // Constant term (Number)
}

// Complete density profile consisting of two layers
struct DensityProfile {
  layers: array<DensityProfileLayer, 2>,
}

// Atmosphere parameters defining the physical properties of the atmosphere
struct AtmosphereParameters {
  solar_irradiance: vec3f,           // Solar irradiance at top of atmosphere (IrradianceSpectrum)
  sun_angular_radius: f32,           // Angular radius of the sun (Angle)
  bottom_radius: f32,                // Radius of the planet (Length)
  top_radius: f32,                   // Radius of atmosphere (Length)
  rayleigh_density: DensityProfile,  // Rayleigh scattering density profile
  rayleigh_scattering: vec3f,        // Rayleigh scattering coefficient (ScatteringSpectrum)
  mie_density: DensityProfile,       // Mie scattering density profile
  mie_scattering: vec3f,             // Mie scattering coefficient (ScatteringSpectrum)
  mie_extinction: vec3f,             // Mie extinction coefficient (ScatteringSpectrum)
  mie_phase_function_g: f32,         // Mie phase function asymmetry factor (Number)
  absorption_density: DensityProfile, // Absorption (ozone) density profile
  absorption_extinction: vec3f,      // Absorption extinction coefficient (ScatteringSpectrum)
  ground_albedo: vec3f,              // Ground albedo (DimensionlessSpectrum)
  mu_s_min: f32,                     // Minimum sun zenith angle cosine (Number)
}

// Precomputed atmosphere parameters (Earth's atmosphere)
const ATMOSPHERE: AtmosphereParameters = AtmosphereParameters(
  // solar_irradiance
  vec3f(1.474000, 1.850400, 1.911980),
  // sun_angular_radius
  0.004675,
  // bottom_radius
  6360.000000,
  // top_radius
  6420.000000,
  // rayleigh_density
  DensityProfile(array<DensityProfileLayer, 2>(
    DensityProfileLayer(0.0, 0.0, 0.0, 0.0, 0.0),
    DensityProfileLayer(0.0, 1.0, -0.125, 0.0, 0.0)
  )),
  // rayleigh_scattering
  vec3f(0.005802, 0.013558, 0.033100),
  // mie_density
  DensityProfile(array<DensityProfileLayer, 2>(
    DensityProfileLayer(0.0, 0.0, 0.0, 0.0, 0.0),
    DensityProfileLayer(0.0, 1.0, -0.833333, 0.0, 0.0)
  )),
  // mie_scattering
  vec3f(0.003996, 0.003996, 0.003996),
  // mie_extinction
  vec3f(0.004440, 0.004440, 0.004440),
  // mie_phase_function_g
  0.800000,
  // absorption_density
  DensityProfile(array<DensityProfileLayer, 2>(
    DensityProfileLayer(25.0, 0.0, 0.0, 0.066667, -0.666667),
    DensityProfileLayer(0.0, 0.0, 0.0, -0.066667, 2.666667)
  )),
  // absorption_extinction
  vec3f(0.000650, 0.001881, 0.000085),
  // ground_albedo
  vec3f(0.100000, 0.100000, 0.100000),
  // mu_s_min
  -0.207912
);

// ============================================================================
// GEOMETRY HELPER FUNCTIONS
// ============================================================================

// Clamps cosine of zenith angle to valid range [-1, 1]
fn ClampCosine(mu: f32) -> f32 {
  return clamp(mu, -1.0, 1.0);
}

// Clamps distance to non-negative values
fn ClampDistance(d: f32) -> f32 {
  return max(d, 0.0);
}

// Clamps radius to atmosphere bounds [bottom_radius, top_radius]
fn ClampRadius(atmosphere: AtmosphereParameters, r: f32) -> f32 {
  return clamp(r, atmosphere.bottom_radius, atmosphere.top_radius);
}

// Safe square root that avoids NaN for negative values
fn SafeSqrt(a: f32) -> f32 {
  return sqrt(max(a, 0.0));
}

// Computes distance to the top atmosphere boundary for a ray (r, mu)
// r: length of the position vector (radius from planet center)
// mu: cosine of the zenith angle
fn DistanceToTopAtmosphereBoundary(atmosphere: AtmosphereParameters, r: f32, mu: f32) -> f32 {
  let discriminant = r * r * (mu * mu - 1.0) +
      atmosphere.top_radius * atmosphere.top_radius;
  return ClampDistance(-r * mu + SafeSqrt(discriminant));
}

// Computes distance to the bottom atmosphere boundary for a ray (r, mu)
fn DistanceToBottomAtmosphereBoundary(atmosphere: AtmosphereParameters, r: f32, mu: f32) -> f32 {
  let discriminant = r * r * (mu * mu - 1.0) +
      atmosphere.bottom_radius * atmosphere.bottom_radius;
  return ClampDistance(-r * mu - SafeSqrt(discriminant));
}

// Checks if a ray (r, mu) intersects the ground
fn RayIntersectsGround(atmosphere: AtmosphereParameters, r: f32, mu: f32) -> bool {
  return mu < 0.0 && r * r * (mu * mu - 1.0) +
      atmosphere.bottom_radius * atmosphere.bottom_radius >= 0.0;
}

// ============================================================================
// TEXTURE COORDINATE MAPPING FUNCTIONS
// ============================================================================

// Maps a unit range value [0,1] to texture coordinates with half-pixel offset
fn GetTextureCoordFromUnitRange(x: f32, texture_size: i32) -> f32 {
  return 0.5 / f32(texture_size) + x * (1.0 - 1.0 / f32(texture_size));
}

// Inverse of GetTextureCoordFromUnitRange
fn GetUnitRangeFromTextureCoord(u: f32, texture_size: i32) -> f32 {
  return (u - 0.5 / f32(texture_size)) / (1.0 - 1.0 / f32(texture_size));
}

// Maps (r, mu) to UV coordinates in the transmittance LUT
// r: radius from planet center
// mu: cosine of zenith angle
fn GetTransmittanceTextureUvFromRMu(atmosphere: AtmosphereParameters, r: f32, mu: f32) -> vec2f {
  // Height at horizon
  let H = sqrt(atmosphere.top_radius * atmosphere.top_radius -
      atmosphere.bottom_radius * atmosphere.bottom_radius);
  // Distance to horizon
  let rho = SafeSqrt(r * r - atmosphere.bottom_radius * atmosphere.bottom_radius);
  // Distance to top atmosphere boundary
  let d = DistanceToTopAtmosphereBoundary(atmosphere, r, mu);
  let d_min = atmosphere.top_radius - r;
  let d_max = rho + H;
  let x_mu = (d - d_min) / (d_max - d_min);
  let x_r = rho / H;
  return vec2f(
    GetTextureCoordFromUnitRange(x_mu, TRANSMITTANCE_TEXTURE_WIDTH),
    GetTextureCoordFromUnitRange(x_r, TRANSMITTANCE_TEXTURE_HEIGHT)
  );
}

// Inverse mapping: UV coordinates to (r, mu)
// Returns a struct instead of using out parameters (WGSL doesn't have out params)
struct RMuResult {
  r: f32,
  mu: f32,
}

fn GetRMuFromTransmittanceTextureUv(atmosphere: AtmosphereParameters, uv: vec2f) -> RMuResult {
  let x_mu = GetUnitRangeFromTextureCoord(uv.x, TRANSMITTANCE_TEXTURE_WIDTH);
  let x_r = GetUnitRangeFromTextureCoord(uv.y, TRANSMITTANCE_TEXTURE_HEIGHT);
  let H = sqrt(atmosphere.top_radius * atmosphere.top_radius -
      atmosphere.bottom_radius * atmosphere.bottom_radius);
  let rho = H * x_r;
  let r = sqrt(rho * rho + atmosphere.bottom_radius * atmosphere.bottom_radius);
  let d_min = atmosphere.top_radius - r;
  let d_max = rho + H;
  let d = d_min + x_mu * (d_max - d_min);
  let mu = select((H * H - rho * rho - d * d) / (2.0 * r * d), 1.0, d == 0.0);

  var result: RMuResult;
  result.r = r;
  result.mu = ClampCosine(mu);
  return result;
}

// ============================================================================
// TRANSMITTANCE LOOKUP FUNCTIONS
// ============================================================================

// Samples the transmittance LUT to get transmittance to top atmosphere boundary
// r: radius from planet center
// mu: cosine of zenith angle
fn GetTransmittanceToTopAtmosphereBoundary(
    atmosphere: AtmosphereParameters,
    r: f32,
    mu: f32
) -> vec3f {
  let uv = GetTransmittanceTextureUvFromRMu(atmosphere, r, mu);
  return textureSampleLevel(transmittance_texture, transmittance_sampler, uv, 0.0).rgb;
}

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
  let view_ray = input.view_ray;
  let view_dir = normalize(view_ray);

  // Camera position in atmosphere coordinates (relative to earth_center)
  let camera = vec3f(
    globals.camera_exposure.x,
    globals.camera_exposure.y,
    globals.camera_exposure.z
  );
  let camera_pos = camera - globals.earth_center.xyz;

  // Distance from planet center (in km, since LENGTH_UNIT_IN_METERS = 1000)
  let r = length(camera_pos);
  let r_clamped = ClampRadius(ATMOSPHERE, r);

  // Cosine of zenith angle (angle between view direction and radial "up" direction)
  let mu = dot(view_dir, normalize(camera_pos));
  let mu_clamped = ClampCosine(mu);

  // Get transmittance to top of atmosphere (background sky)
  let transmittance = GetTransmittanceToTopAtmosphereBoundary(ATMOSPHERE, r_clamped, mu_clamped);

  // Apply exposure and tone mapping for background
  let exposure = globals.camera_exposure.w;
  let white_point = globals.white_point_size.xyz;
  let sky_color = transmittance * exposure;
  let sky_tone_mapped = pow(sky_color / (vec3f(1.0) + sky_color), vec3f(1.0 / 2.2));

  // ============================================================================
  // RAY-SPHERE INTERSECTION (demonstration sphere)
  // ============================================================================

  // DIAGNOSTIC: Let's just place the sphere at where WebGL has it and see what happens
  // For now, ignore the math and trust the WebGL code

  // Sphere at (0, 0, 1km) - same position as WebGL demo
  var p = camera - kSphereCenter;
  let p_dot_v = dot(p, view_dir);
  let p_dot_p = dot(p, p);
  let ray_sphere_center_squared_distance = p_dot_p - p_dot_v * p_dot_v;
  let discriminant = kSphereRadius * kSphereRadius - ray_sphere_center_squared_distance;

  let fragment_angular_size =
      length(dpdx(view_ray) + dpdy(view_ray)) / max(length(view_ray), 1e-5);
  var closest_distance = 1e32;
  var final_color = sky_tone_mapped;

  // Check for ground intersection (planet surface) so we can layer it behind the sphere.
  {
    let earth_offset = camera - globals.earth_center.xyz;
    let earth_dot_v = dot(earth_offset, view_dir);
    let earth_dot_earth = dot(earth_offset, earth_offset);
    let earth_radius_sq = ATMOSPHERE.bottom_radius * ATMOSPHERE.bottom_radius;
    let ray_center_sq = earth_dot_earth - earth_dot_v * earth_dot_v;
    let ground_discriminant = earth_radius_sq - ray_center_sq;
    if (ground_discriminant >= 0.0) {
      let ground_distance = -earth_dot_v - sqrt(ground_discriminant);
      if (ground_distance > 0.0) {
        let ground_exposed = kGroundAlbedo * exposure;
        let ground_tone_mapped = pow(
            ground_exposed / (vec3f(1.0) + ground_exposed), vec3f(1.0 / 2.2));
        final_color = ground_tone_mapped;
        closest_distance = ground_distance;
      }
    }
  }

  if (discriminant >= 0.0) {
    let sphere_distance = -p_dot_v - sqrt(discriminant);
    if (sphere_distance > 0.0 && sphere_distance < closest_distance) {
      let ray_sphere_distance =
          kSphereRadius - sqrt(ray_sphere_center_squared_distance);
      let ray_sphere_angular_distance =
          ray_sphere_distance / max(-p_dot_v, 1e-5);
      let sphere_alpha = min(
          ray_sphere_angular_distance / max(fragment_angular_size, 1e-5), 1.0);

      let sphere_color = kSphereAlbedo;
      let sphere_exposed = sphere_color * exposure;
      let sphere_tone_mapped =
          pow(sphere_exposed / (vec3f(1.0) + sphere_exposed), vec3f(1.0 / 2.2));

      final_color = mix(final_color, sphere_tone_mapped, sphere_alpha);
      closest_distance = sphere_distance;
    }
  }

  return vec4f(final_color, 1.0);
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

  // Request float32-filterable feature to enable linear filtering on rgba32float textures
  const device = await adapter.requestDevice({
    requiredFeatures: ['float32-filterable'],
  });
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

  copyRowMajorToColumnMajor(uniformScratch, 0, viewFromClip);
  copyRowMajorToColumnMajor(uniformScratch, 16, modelFromView);
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

    setStatus('WebGPU ready — Sub-task 5.3: Sphere edge anti-aliasing');

    window.addEventListener('resize', () => {
      configureContext(canvas, gpuState.context, gpuState.device, gpuState.format);
    });
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'WebGPU initialization failed');
  }
}

main();

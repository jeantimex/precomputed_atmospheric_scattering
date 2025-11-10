import"./modulepreload-polyfill-B5Qt9EMX.js";const C={transmittance:{url:new URL("../assets/transmittance.dat",import.meta.url).href,width:256,height:64,depthOrArrayLayers:1,dimension:"2d"},scattering:{url:new URL("../assets/scattering.dat",import.meta.url).href,width:256,height:128,depthOrArrayLayers:32,dimension:"3d"},irradiance:{url:new URL("../assets/irradiance.dat",import.meta.url).href,width:64,height:16,depthOrArrayLayers:1,dimension:"2d"}};async function M(e){const n=await fetch(e);if(!n.ok)throw new Error(`Failed to load ${e}: ${n.status} ${n.statusText}`);const t=await n.arrayBuffer(),a=new DataView(t),i=new Float32Array(t.byteLength/Float32Array.BYTES_PER_ELEMENT);for(let s=0;s<i.length;++s)i[s]=a.getFloat32(s*Float32Array.BYTES_PER_ELEMENT,!0);return i}function P(e,n){return e.createTexture({size:[n.width,n.height,n.depthOrArrayLayers],dimension:n.dimension==="3d"?"3d":"2d",format:"rgba32float",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST})}function D(e,n,t,a){const i=Float32Array.BYTES_PER_ELEMENT,s=t.width*4*i,d=t.height;e.queue.writeTexture({texture:n},a,{bytesPerRow:s,rowsPerImage:d},{width:t.width,height:t.height,depthOrArrayLayers:t.depthOrArrayLayers})}async function G(e){const n=await Promise.all(Object.entries(C).map(async([t,a])=>{const i=await M(a.url),s=P(e,a);return D(e,s,a,i),[t,s]}));return Object.fromEntries(n)}const v=new Float32Array([-1,-1,1,-1,-1,1,1,1]);function I(e){const n=e.createBuffer({size:v.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});return e.queue.writeBuffer(n,0,v.buffer,v.byteOffset,v.byteLength),n}const U=64,L=U*Float32Array.BYTES_PER_ELEMENT;function N(e){return e.createBuffer({size:L,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}function q(e,n,t){e.queue.writeBuffer(n,0,t.buffer,t.byteOffset,t.byteLength)}const F=`/**
 * WebGPU Atmospheric Scattering Shader
 *
 * This shader implements Eric Bruneton's precomputed atmospheric scattering model.
 * It renders physically-based sky colors, aerial perspective, and atmospheric effects
 * by sampling precomputed lookup tables (LUTs) for transmittance, scattering, and irradiance.
 *
 * Key concepts:
 * - Rayleigh scattering: Molecular scattering (blue sky)
 * - Mie scattering: Aerosol scattering (haze, sun glow)
 * - Transmittance: Light absorption through the atmosphere
 * - Irradiance: Ground-level lighting from sky and sun
 *
 * The LUTs are parameterized by:
 * - r: Distance from Earth's center
 * - mu: Cosine of zenith angle
 * - mu_s: Cosine of sun zenith angle
 * - nu: Cosine of angle between view and sun directions
 */

/**
 * Globals struct - Uniform parameters passed from CPU
 *
 * Fields are packed into vec4s for alignment:
 * - view_from_clip: Inverse projection matrix
 * - model_from_view: Inverse view matrix
 * - camera_exposure: Camera position (xyz) + exposure value (w)
 * - sun_direction_size: Sun direction (xyz) + tan(sun_angular_radius) (w)
 * - white_point_size: White point for tone mapping (xyz) + cos(sun_angular_radius) (w)
 * - earth_center: Earth's center position in world space (xyz)
 */
struct Globals {
  view_from_clip : mat4x4f,
  model_from_view : mat4x4f,
  camera_exposure : vec4f,
  sun_direction_size : vec4f,
  white_point_size : vec4f,
  earth_center : vec4f,
}

// Bind group 0: All shader resources
@group(0) @binding(0) var<uniform> globals : Globals;
@group(0) @binding(1) var transmittance_texture : texture_2d<f32>;   // Atmospheric transmittance LUT
@group(0) @binding(2) var scattering_texture : texture_3d<f32>;      // Combined scattering LUT (4D packed into 3D)
@group(0) @binding(3) var irradiance_texture : texture_2d<f32>;      // Ground irradiance LUT
@group(0) @binding(4) var lut_sampler : sampler;                      // Linear sampler for all LUTs

// ============================================================================
// ATMOSPHERE CONSTANTS AND TYPE DEFINITIONS
// ============================================================================

/**
 * Precomputed Texture Dimensions
 *
 * These match the dimensions used during LUT precomputation:
 * - Transmittance: 2D texture parameterized by (r, mu)
 * - Scattering: 4D texture (r, mu, mu_s, nu) packed into 3D by treating nu as texture slices
 * - Irradiance: 2D texture parameterized by (r, mu_s)
 */
const TRANSMITTANCE_TEXTURE_WIDTH : i32 = 256;
const TRANSMITTANCE_TEXTURE_HEIGHT : i32 = 64;
const SCATTERING_TEXTURE_R_SIZE : i32 = 32;        // Altitude resolution
const SCATTERING_TEXTURE_MU_SIZE : i32 = 128;      // View zenith angle resolution
const SCATTERING_TEXTURE_MU_S_SIZE : i32 = 32;     // Sun zenith angle resolution
const SCATTERING_TEXTURE_NU_SIZE : i32 = 8;        // View-sun angle resolution
const IRRADIANCE_TEXTURE_WIDTH : i32 = 64;
const IRRADIANCE_TEXTURE_HEIGHT : i32 = 16;

/**
 * Physical Units
 *
 * These constants define the base units used in the atmospheric model.
 * All are set to 1.0 for dimensional analysis clarity (the model uses kilometers internally).
 */
const m : f32 = 1.0;      // Meters
const nm : f32 = 1.0;     // Nanometers (wavelength)
const rad : f32 = 1.0;    // Radians (angle)
const sr : f32 = 1.0;     // Steradians (solid angle)
const watt : f32 = 1.0;   // Watts (power)
const lm : f32 = 1.0;     // Lumens (luminous flux)
const PI : f32 = 3.14159265358979323846;

// Derived units for radiometric quantities
const m2 : f32 = m * m;
const m3 : f32 = m * m * m;
const watt_per_square_meter : f32 = watt / m2;                        // Irradiance
const watt_per_square_meter_per_sr : f32 = watt / (m2 * sr);          // Radiance
const watt_per_square_meter_per_nm : f32 = watt / (m2 * nm);          // Spectral irradiance
const watt_per_square_meter_per_sr_per_nm : f32 = watt / (m2 * sr * nm);  // Spectral radiance
const watt_per_cubic_meter_per_sr_per_nm : f32 = watt / (m3 * sr * nm);   // Scattering coefficient

/**
 * Conversion Factors: Spectral Radiance to Luminance
 *
 * These constants convert RGB spectral radiance (at wavelengths ~680nm, 550nm, 440nm)
 * to CIE luminance values. Different conversion factors are used for sky and sun
 * because they have different spectral distributions.
 */
const SKY_SPECTRAL_RADIANCE_TO_LUMINANCE : vec3f =
    vec3f(114974.916437, 71305.954816, 65310.548555);
const SUN_SPECTRAL_RADIANCE_TO_LUMINANCE : vec3f =
    vec3f(98242.786222, 69954.398112, 66475.012354);

/**
 * Demo Scene Objects
 *
 * The demo includes a small sphere in the scene to demonstrate atmospheric effects
 * on objects. These constants define its properties:
 * - kLengthUnitInMeters: The model uses kilometers (1000m) as its base unit
 * - kSphereCenter: Center position of the demo sphere (1km above origin)
 * - kSphereRadius: Radius of the demo sphere (1km)
 * - kSphereAlbedo: Reflectance of the sphere (0.8 = bright white)
 * - kGroundAlbedo: Reflectance of the ground (dark with slight blue tint)
 */
const kLengthUnitInMeters : f32 = 1000.0;
const kSphereCenter : vec3f = vec3f(0.0, 0.0, 1000.0) / kLengthUnitInMeters;
const kSphereRadius : f32 = 1000.0 / kLengthUnitInMeters;
const kSphereAlbedo : vec3f = vec3f(0.8);
const kGroundAlbedo : vec3f = vec3f(0.0, 0.0, 0.04);

/**
 * DensityProfileLayer: Defines atmospheric density as a function of altitude
 *
 * The density at altitude h is computed as:
 * density(h) = exp_term * exp(exp_scale * h) + linear_term * h + constant_term
 *
 * This allows modeling of exponential density falloff (e.g., molecular atmosphere)
 * as well as linear regions (e.g., ozone layer).
 */
struct DensityProfileLayer {
  width : f32,          // Layer thickness (km)
  exp_term : f32,       // Coefficient for exponential term
  exp_scale : f32,      // Exponent scale factor
  linear_term : f32,    // Coefficient for linear term
  constant_term : f32,  // Constant offset
}

/**
 * DensityProfile: Two-layer density profile
 *
 * Most atmospheric constituents can be modeled with two layers
 * (e.g., lower and upper atmosphere)
 */
struct DensityProfile {
  layers : array<DensityProfileLayer, 2>,
}

/**
 * AtmosphereParameters: Complete description of atmospheric properties
 *
 * This struct contains all physical parameters needed to compute scattering:
 * - Solar irradiance and sun size
 * - Planet geometry (radii defining atmosphere shell)
 * - Rayleigh scattering (molecular) - wavelength dependent, causes blue sky
 * - Mie scattering (aerosol) - larger particles, causes haze and sun glow
 * - Absorption (ozone) - removes light at certain wavelengths
 * - Ground albedo for surface reflections
 */
struct AtmosphereParameters {
  solar_irradiance : vec3f,         // Sun's spectral irradiance at top of atmosphere (RGB)
  sun_angular_radius : f32,         // Angular size of the sun (radians)
  bottom_radius : f32,              // Planet radius (km)
  top_radius : f32,                 // Atmosphere outer radius (km)
  rayleigh_density : DensityProfile, // Rayleigh scattering density vs altitude
  rayleigh_scattering : vec3f,      // Rayleigh scattering coefficients (RGB, wavelength-dependent)
  mie_density : DensityProfile,     // Mie scattering density vs altitude
  mie_scattering : vec3f,           // Mie scattering coefficient (wavelength-independent)
  mie_extinction : vec3f,           // Mie extinction = scattering + absorption
  mie_phase_function_g : f32,       // Mie phase function asymmetry parameter (-1 to 1)
  absorption_density : DensityProfile, // Absorption (ozone) density vs altitude
  absorption_extinction : vec3f,    // Absorption coefficients (RGB)
  ground_albedo : vec3f,            // Ground surface reflectance (RGB)
  mu_s_min : f32,                   // Minimum sun zenith angle cosine for LUT
}

/**
 * ATMOSPHERE: Earth's atmosphere parameters
 *
 * These values are calibrated to match Earth's real atmosphere:
 * - Bottom radius: 6360 km (Earth's radius)
 * - Top radius: 6420 km (60 km atmosphere thickness)
 * - Rayleigh scattering: Exponential with 8km scale height
 * - Mie scattering: Exponential with 1.2km scale height
 * - Absorption (ozone): Peaked around 25km altitude
 * - Mie asymmetry g=0.8: Strongly forward-scattering (typical for aerosols)
 */
const ATMOSPHERE : AtmosphereParameters = AtmosphereParameters(
  vec3f(1.474000, 1.850400, 1.911980),  // Solar irradiance (RGB)
  0.004675,                              // Sun angular radius
  6360.0,                                // Earth radius (km)
  6420.0,                                // Atmosphere top (km)
  // Rayleigh density: exponential with scale height ~8km
  DensityProfile(array<DensityProfileLayer, 2>(
    DensityProfileLayer(0.0, 0.0, 0.0, 0.0, 0.0),
    DensityProfileLayer(0.0, 1.0, -0.125, 0.0, 0.0)
  )),
  vec3f(0.005802, 0.013558, 0.033100),  // Rayleigh scattering (blue-weighted)
  // Mie density: exponential with scale height ~1.2km
  DensityProfile(array<DensityProfileLayer, 2>(
    DensityProfileLayer(0.0, 0.0, 0.0, 0.0, 0.0),
    DensityProfileLayer(0.0, 1.0, -0.833333, 0.0, 0.0)
  )),
  vec3f(0.003996, 0.003996, 0.003996),  // Mie scattering (wavelength-independent)
  vec3f(0.004440, 0.004440, 0.004440),  // Mie extinction
  0.8,                                   // Mie phase function g (forward scattering)
  // Ozone absorption: peaked at 25km altitude
  DensityProfile(array<DensityProfileLayer, 2>(
    DensityProfileLayer(25.0, 0.0, 0.0, 0.066667, -0.666667),
    DensityProfileLayer(0.0, 0.0, 0.0, -0.066667, 2.666667)
  )),
  vec3f(0.000650, 0.001881, 0.000085),  // Absorption extinction (green-weighted)
  vec3f(0.1, 0.1, 0.1),                 // Ground albedo
  -0.207912                              // mu_s_min
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * ClampCosine: Clamps a cosine value to valid range [-1, 1]
 *
 * Prevents numerical errors when computing angles
 */
fn ClampCosine(mu : f32) -> f32 {
  return clamp(mu, -1.0, 1.0);
}

/**
 * ClampDistance: Ensures distance is non-negative
 */
fn ClampDistance(d : f32) -> f32 {
  return max(d, 0.0);
}

/**
 * ClampRadius: Clamps altitude to atmosphere shell
 *
 * Ensures r is within [bottom_radius, top_radius]
 */
fn ClampRadius(atmosphere : AtmosphereParameters, r : f32) -> f32 {
  return clamp(r, atmosphere.bottom_radius, atmosphere.top_radius);
}

/**
 * SafeSqrt: Square root that handles negative values
 *
 * Returns 0 for negative inputs (can occur due to numerical precision)
 */
fn SafeSqrt(v : f32) -> f32 {
  return sqrt(max(v, 0.0));
}

/**
 * RayDistanceToAtmosphereTop: Ray-sphere intersection distance
 *
 * Computes distance from point at radius r, looking in direction mu,
 * to the top atmosphere boundary.
 *
 * This uses the ray-sphere intersection formula:
 * Given ray origin at distance r from center, direction with cos(zenith) = mu,
 * and sphere of radius top_radius, solve for intersection distance.
 *
 * @param r Distance from planet center
 * @param mu Cosine of zenith angle (1 = up, 0 = horizon, -1 = down)
 */
fn RayDistanceToAtmosphereTop(atmosphere : AtmosphereParameters, r : f32, mu : f32) -> f32 {
  let discriminant = r * r * (mu * mu - 1.0) + atmosphere.top_radius * atmosphere.top_radius;
  return ClampDistance(-r * mu + SafeSqrt(discriminant));
}

/**
 * RayDistanceToGround: Ray-sphere intersection distance to ground
 *
 * Similar to RayDistanceToAtmosphereTop but for the planet surface
 */
fn RayDistanceToGround(atmosphere : AtmosphereParameters, r : f32, mu : f32) -> f32 {
  let discriminant = r * r * (mu * mu - 1.0) + atmosphere.bottom_radius * atmosphere.bottom_radius;
  return ClampDistance(-r * mu - SafeSqrt(discriminant));
}

/**
 * RayIntersectsGround: Checks if a ray hits the planet surface
 *
 * Returns true if the ray (from radius r, direction mu) intersects the ground
 * before exiting the atmosphere. This affects transmittance calculations.
 */
fn RayIntersectsGround(atmosphere : AtmosphereParameters, r : f32, mu : f32) -> bool {
  return mu < 0.0 && (r * r * (mu * mu - 1.0) +
      atmosphere.bottom_radius * atmosphere.bottom_radius >= 0.0);
}

/**
 * NormalizedToTexCoord: Converts [0,1] to texture coordinate
 *
 * Maps unit range to texture space, centering samples in texel centers.
 * For a texture of size N, maps:
 * - 0.0 -> 0.5/N (center of first texel)
 * - 1.0 -> (N-0.5)/N (center of last texel)
 */
fn NormalizedToTexCoord(x : f32, texture_size : i32) -> f32 {
  return 0.5 / f32(texture_size) + x * (1.0 - 1.0 / f32(texture_size));
}

/**
 * TexCoordToNormalized: Inverse of NormalizedToTexCoord
 *
 * Converts texture coordinate back to [0,1] range
 */
fn TexCoordToNormalized(u : f32, texture_size : i32) -> f32 {
  return (u - 0.5 / f32(texture_size)) / (1.0 - 1.0 / f32(texture_size));
}

// ============================================================================
// TRANSMITTANCE LOOKUPS
// ============================================================================

/**
 * Transmittance LUT Parameterization
 *
 * The transmittance texture stores the fraction of light that survives
 * traveling from any point (r, mu) to the top of the atmosphere.
 *
 * The 2D texture is parameterized by:
 * - r: Distance from planet center (altitude)
 * - mu: Cosine of zenith angle (view direction)
 *
 * The mapping uses a non-linear parameterization that allocates more
 * precision near the horizon where transmittance changes rapidly.
 */

struct RMuResult {
  r : f32,   // Distance from planet center
  mu : f32,  // Cosine of zenith angle
}

/**
 * MapToTransmittanceTexture: Maps (r, mu) to texture UV coordinates
 *
 * This function implements the non-linear mapping from physical parameters
 * (r, mu) to 2D texture coordinates. The parameterization is designed to:
 * 1. Use more precision near the horizon (mu ≈ 0)
 * 2. Use more precision near the ground (low altitude)
 *
 * The mapping works by:
 * - Computing distance to atmosphere top boundary
 * - Normalizing this distance relative to min/max possible distances
 * - Mapping to texture space with proper texel centering
 *
 * @param r Distance from planet center (km)
 * @param mu Cosine of zenith angle
 * @return UV coordinates in [0,1]^2
 */
fn MapToTransmittanceTexture(atmosphere : AtmosphereParameters, r : f32, mu : f32) -> vec2f {
  // H: Maximum horizontal distance in atmosphere
  let H = sqrt(atmosphere.top_radius * atmosphere.top_radius -
      atmosphere.bottom_radius * atmosphere.bottom_radius);

  // rho: Horizontal distance from planet center axis
  let rho = SafeSqrt(r * r - atmosphere.bottom_radius * atmosphere.bottom_radius);

  // d: Distance to top atmosphere boundary in this direction
  let d = RayDistanceToAtmosphereTop(atmosphere, r, mu);

  // Normalize distance to [0,1] range
  let d_min = atmosphere.top_radius - r;  // Minimum distance (looking up)
  let d_max = rho + H;                     // Maximum distance (looking at horizon)
  let x_mu = (d - d_min) / (d_max - d_min);

  // Normalize altitude to [0,1] range
  let x_r = rho / H;

  return vec2f(
    NormalizedToTexCoord(x_mu, TRANSMITTANCE_TEXTURE_WIDTH),
    NormalizedToTexCoord(x_r, TRANSMITTANCE_TEXTURE_HEIGHT)
  );
}

/**
 * MapFromTransmittanceTexture: Inverse mapping from texture UV to (r, mu)
 *
 * This is the inverse of MapToTransmittanceTexture. Given a texture coordinate,
 * it recovers the physical parameters (r, mu) that were mapped to that location.
 *
 * This function is primarily used during LUT precomputation, not during runtime rendering.
 *
 * @param uv Texture coordinates in [0,1]^2
 * @return RMuResult containing r (distance from center) and mu (cos zenith angle)
 */
fn MapFromTransmittanceTexture(atmosphere : AtmosphereParameters, uv : vec2f) -> RMuResult {
  // Convert texture coords back to normalized [0,1] range
  let x_mu = TexCoordToNormalized(uv.x, TRANSMITTANCE_TEXTURE_WIDTH);
  let x_r = TexCoordToNormalized(uv.y, TRANSMITTANCE_TEXTURE_HEIGHT);

  // Reverse the parameterization
  let H = sqrt(atmosphere.top_radius * atmosphere.top_radius -
      atmosphere.bottom_radius * atmosphere.bottom_radius);
  let rho = H * x_r;
  let r = sqrt(rho * rho + atmosphere.bottom_radius * atmosphere.bottom_radius);
  let d_min = atmosphere.top_radius - r;
  let d_max = rho + H;
  let d = d_min + x_mu * (d_max - d_min);

  // Solve for mu using the law of cosines
  let mu = select((H * H - rho * rho - d * d) / (2.0 * r * d), 1.0, d == 0.0);

  var result : RMuResult;
  result.r = r;
  result.mu = ClampCosine(mu);
  return result;
}

/**
 * SampleTransmittanceLUT: Samples transmittance LUT
 *
 * Returns the fraction of light (RGB) that reaches the top of the atmosphere
 * when traveling from point (r, mu).
 */
fn SampleTransmittanceLUT(
    atmosphere : AtmosphereParameters, r : f32, mu : f32) -> vec3f {
  let uv = MapToTransmittanceTexture(atmosphere, r, mu);
  return textureSampleLevel(transmittance_texture, lut_sampler, uv, 0.0).rgb;
}

/**
 * GetTransmittance: Computes transmittance between two points
 *
 * Returns the fraction of light that survives traveling distance d
 * along a ray from (r, mu). Handles both ground-intersecting and
 * non-intersecting rays.
 *
 * For rays that don't hit ground: T(r→r_d) = T(r→top) / T(r_d→top)
 * For rays that hit ground: T(r→r_d) = T(r_d→top, looking down) / T(r→top, looking down)
 */
fn GetTransmittance(
    atmosphere : AtmosphereParameters,
    r : f32,
    mu : f32,
    d : f32,
    ray_r_mu_intersects_ground : bool) -> vec3f {
  // Compute endpoint of ray segment
  let r_d = ClampRadius(atmosphere, sqrt(d * d + 2.0 * r * mu * d + r * r));
  let mu_d = ClampCosine((r * mu + d) / r_d);

  if (ray_r_mu_intersects_ground) {
    // Ray hits ground: use ratio of transmittances looking down
    return min(
        SampleTransmittanceLUT(atmosphere, r_d, -mu_d) /
        SampleTransmittanceLUT(atmosphere, r, -mu),
        vec3f(1.0));
  }

  // Ray doesn't hit ground: use ratio of transmittances looking up
  return min(
      SampleTransmittanceLUT(atmosphere, r, mu) /
      SampleTransmittanceLUT(atmosphere, r_d, mu_d),
      vec3f(1.0));
}

/**
 * GetTransmittanceToSun: Computes atmospheric transmittance to the sun
 *
 * Returns the fraction of sunlight (RGB) that reaches a point at altitude r
 * when the sun is at zenith angle mu_s. This accounts for:
 * 1. Atmospheric absorption along the path to the sun
 * 2. Smooth fadeout when sun is below the horizon (to avoid harsh cutoff)
 *
 * The smoothstep creates a smooth transition as the sun sets/rises, preventing
 * the abrupt change that would occur at the mathematical horizon.
 *
 * @param r Distance from planet center (altitude)
 * @param mu_s Cosine of sun zenith angle
 * @return RGB transmittance factors [0,1]
 */
fn GetTransmittanceToSun(atmosphere : AtmosphereParameters, r : f32, mu_s : f32) -> vec3f {
  // Compute horizon angle at this altitude
  let sin_theta_h = atmosphere.bottom_radius / r;
  let cos_theta_h = -sqrt(max(1.0 - sin_theta_h * sin_theta_h, 0.0));

  // Multiply transmittance by smooth fadeout near horizon
  return SampleTransmittanceLUT(atmosphere, r, mu_s) *
      smoothstep(
        -sin_theta_h * atmosphere.sun_angular_radius / rad,
        sin_theta_h * atmosphere.sun_angular_radius / rad,
        mu_s - cos_theta_h);
}

// ============================================================================
// SCATTERING LOOKUPS
// ============================================================================

/**
 * RayleighPhaseFunction: Angular distribution of Rayleigh scattering
 *
 * Rayleigh scattering (molecular) has a symmetric phase function:
 * - Equal scattering forward and backward
 * - Minimum scattering at 90° (nu = 0)
 * - Maximum scattering at 0° and 180° (nu = ±1)
 *
 * Formula: P(nu) = (3/16π) * (1 + nu²)
 * where nu = cos(angle between view and sun)
 */
fn RayleighPhaseFunction(nu : f32) -> f32 {
  let k = 3.0 / (16.0 * PI * sr);
  return k * (1.0 + nu * nu);
}

/**
 * MiePhaseFunction: Angular distribution of Mie scattering
 *
 * Mie scattering (aerosol) is strongly forward-scattering:
 * - Most light scatters in the forward direction (nu ≈ 1)
 * - Creates bright glow around the sun
 * - Asymmetry parameter g controls the strength (g=0.8 for Earth)
 *
 * Uses the Cornette-Shanks phase function:
 * P(g,nu) = (3/8π) * [(1-g²)/(2+g²)] * (1+nu²) / (1+g²-2g*nu)^1.5
 */
fn MiePhaseFunction(g : f32, nu : f32) -> f32 {
  let k = 3.0 / (8.0 * PI * sr) * (1.0 - g * g) / (2.0 + g * g);
  return k * (1.0 + nu * nu) / pow(1.0 + g * g - 2.0 * g * nu, 1.5);
}

/**
 * MapToScatteringTexture: Maps scattering parameters to 4D texture coordinates
 *
 * The scattering LUT is 4-dimensional (r, mu, mu_s, nu) but GPUs only support up to 3D textures.
 * This function packs the 4D data into a 3D texture by treating the nu dimension as horizontal
 * slices laid out side-by-side.
 *
 * Parameters:
 * - r: Distance from planet center (altitude)
 * - mu: Cosine of view zenith angle
 * - mu_s: Cosine of sun zenith angle
 * - nu: Cosine of angle between view and sun directions
 * - ray_r_mu_intersects_ground: Whether the view ray hits the ground
 *
 * Returns vec4(u_nu, u_mu_s, u_mu, u_r) where:
 * - u_nu is used to compute which texture slice and lerp factor
 * - u_mu_s, u_mu, u_r are the 3D texture coordinates
 *
 * The parameterization is non-linear to allocate more precision where scattering
 * changes rapidly (e.g., near the horizon, near the ground).
 */
fn MapToScatteringTexture(
    atmosphere : AtmosphereParameters,
    r : f32,
    mu : f32,
    mu_s : f32,
    nu : f32,
    ray_r_mu_intersects_ground : bool) -> vec4f {
  let H = sqrt(atmosphere.top_radius * atmosphere.top_radius -
      atmosphere.bottom_radius * atmosphere.bottom_radius);
  let rho = SafeSqrt(r * r - atmosphere.bottom_radius * atmosphere.bottom_radius);
  let u_r = NormalizedToTexCoord(rho / H, SCATTERING_TEXTURE_R_SIZE);
  let r_mu = r * mu;
  let discriminant =
      r_mu * r_mu - r * r + atmosphere.bottom_radius * atmosphere.bottom_radius;
  var u_mu : f32;
  if (ray_r_mu_intersects_ground) {
    let d = -r_mu - SafeSqrt(discriminant);
    let d_min = r - atmosphere.bottom_radius;
    let d_max = rho;
    var ratio : f32;
    if (d_max == d_min) {
      ratio = 0.0;
    } else {
      ratio = (d - d_min) / (d_max - d_min);
    }
    u_mu = 0.5 - 0.5 * NormalizedToTexCoord(
        ratio,
        SCATTERING_TEXTURE_MU_SIZE / 2);
  } else {
    let d = -r_mu + SafeSqrt(discriminant + H * H);
    let d_min = atmosphere.top_radius - r;
    let d_max = rho + H;
    u_mu = 0.5 + 0.5 * NormalizedToTexCoord(
        (d - d_min) / (d_max - d_min),
        SCATTERING_TEXTURE_MU_SIZE / 2);
  }
  let d = RayDistanceToAtmosphereTop(atmosphere, atmosphere.bottom_radius, mu_s);
  let d_min = atmosphere.top_radius - atmosphere.bottom_radius;
  let d_max = H;
  let a = (d - d_min) / (d_max - d_min);
  let D = RayDistanceToAtmosphereTop(atmosphere, atmosphere.bottom_radius, atmosphere.mu_s_min);
  let A = (D - d_min) / (d_max - d_min);
  let u_mu_s = NormalizedToTexCoord(
      max(1.0 - a / A, 0.0) / (1.0 + a), SCATTERING_TEXTURE_MU_S_SIZE);
  let u_nu = (nu + 1.0) * 0.5;
  return vec4f(u_nu, u_mu_s, u_mu, u_r);
}

/**
 * MapToIrradianceTexture: Maps (r, mu_s) to irradiance texture coordinates
 *
 * The irradiance LUT stores ground-level lighting (sun + sky) as a function of:
 * - r: Altitude above ground
 * - mu_s: Cosine of sun zenith angle
 *
 * This uses a simple linear parameterization since irradiance varies smoothly.
 *
 * @param r Distance from planet center
 * @param mu_s Cosine of sun zenith angle
 * @return UV texture coordinates
 */
fn MapToIrradianceTexture(atmosphere : AtmosphereParameters, r : f32, mu_s : f32) -> vec2f {
  let x_r = (r - atmosphere.bottom_radius) /
      (atmosphere.top_radius - atmosphere.bottom_radius);
  let x_mu_s = mu_s * 0.5 + 0.5;  // Map [-1,1] to [0,1]
  return vec2f(
      NormalizedToTexCoord(x_mu_s, IRRADIANCE_TEXTURE_WIDTH),
      NormalizedToTexCoord(x_r, IRRADIANCE_TEXTURE_HEIGHT));
}

/**
 * GetIrradiance: Samples the irradiance LUT
 *
 * Returns the total ground irradiance (sum of sun + sky light) at altitude r
 * when the sun is at zenith angle mu_s.
 *
 * @param r Distance from planet center
 * @param mu_s Cosine of sun zenith angle
 * @return RGB irradiance (W/m²)
 */
fn GetIrradiance(atmosphere : AtmosphereParameters, r : f32, mu_s : f32) -> vec3f {
  let uv = MapToIrradianceTexture(atmosphere, r, mu_s);
  return textureSampleLevel(irradiance_texture, lut_sampler, uv, 0.0).rgb;
}

/**
 * ExtrapolateSingleMie: Extracts single Mie scattering from combined scattering
 *
 * The scattering LUT stores Rayleigh + multiple-scattering in RGB, and a ratio in alpha
 * that allows extracting single Mie scattering. This is needed because Mie and Rayleigh
 * have different phase functions.
 *
 * The formula extrapolates the single Mie component using the stored ratio and the
 * known relationship between Rayleigh and Mie scattering coefficients.
 *
 * @param scattering Combined scattering from LUT (rgba)
 * @return Single Mie scattering component (RGB)
 */
fn ExtrapolateSingleMie(atmosphere : AtmosphereParameters, scattering : vec4f) -> vec3f {
  if (scattering.x <= 0.0) {
    return vec3f(0.0);
  }
  return scattering.xyz * scattering.w / scattering.x *
      (atmosphere.rayleigh_scattering.x / atmosphere.mie_scattering.x) *
      (atmosphere.mie_scattering / atmosphere.rayleigh_scattering);
}

struct CombinedScatteringResult {
  scattering : vec3f,
  single_mie : vec3f,
}

/**
 * GetCombinedScattering: Samples the scattering LUT with manual interpolation
 *
 * The scattering LUT is 4D (r, mu, mu_s, nu) but stored as a 3D texture with nu
 * packed as horizontal slices. This function:
 * 1. Maps parameters to 4D texture coordinates
 * 2. Computes which two nu slices to sample
 * 3. Samples both slices and linearly interpolates
 * 4. Separates combined scattering into Rayleigh and Mie components
 *
 * Returns both the total scattering and the single-Mie component (which needs
 * a different phase function applied).
 *
 * @param r Distance from planet center
 * @param mu Cosine of view zenith angle
 * @param mu_s Cosine of sun zenith angle
 * @param nu Cosine of angle between view and sun
 * @param ray_r_mu_intersects_ground Whether view ray hits ground
 * @return Combined scattering and separated single-Mie component
 */
fn GetCombinedScattering(
    atmosphere : AtmosphereParameters,
    r : f32,
    mu : f32,
    mu_s : f32,
    nu : f32,
    ray_r_mu_intersects_ground : bool) -> CombinedScatteringResult {
  // Get 4D texture coordinates
  let uvwz = MapToScatteringTexture(
      atmosphere, r, mu, mu_s, nu, ray_r_mu_intersects_ground);

  // Compute which two nu slices to sample and interpolation factor
  let tex_coord_x = uvwz.x * f32(SCATTERING_TEXTURE_NU_SIZE - 1);
  let tex_x = floor(tex_coord_x);
  let lerp = tex_coord_x - tex_x;

  // Sample two adjacent nu slices
  let uvw0 = vec3f((tex_x + uvwz.y) / f32(SCATTERING_TEXTURE_NU_SIZE), uvwz.z, uvwz.w);
  let uvw1 = vec3f((tex_x + 1.0 + uvwz.y) / f32(SCATTERING_TEXTURE_NU_SIZE), uvwz.z, uvwz.w);
  let combined0 = textureSampleLevel(scattering_texture, lut_sampler, uvw0, 0.0);
  let combined1 = textureSampleLevel(scattering_texture, lut_sampler, uvw1, 0.0);
  let combined = combined0 * (1.0 - lerp) + combined1 * lerp;

  // Separate Rayleigh and Mie components
  var result : CombinedScatteringResult;
  result.scattering = combined.rgb;
  result.single_mie = ExtrapolateSingleMie(atmosphere, combined);
  return result;
}

/**
 * SkySample: Result of atmospheric scattering computation
 *
 * Contains both the in-scattered radiance (sky color) and the transmittance
 * to a point, allowing composition with objects in the scene.
 */
struct SkySample {
  radiance : vec3f,       // In-scattered light (sky glow)
  transmittance : vec3f,  // Fraction of light transmitted through atmosphere
}

/**
 * GetSkyRadiance: Computes sky color along a view ray
 *
 * This is the main atmospheric scattering function. It:
 * 1. Handles camera outside atmosphere (moves it to atmosphere boundary)
 * 2. Samples precomputed scattering LUTs
 * 3. Applies phase functions for Rayleigh and Mie scattering
 * 4. Accounts for shadows from objects (optional)
 *
 * Returns both the scattered radiance (sky color) and transmittance.
 *
 * @param camera Camera position relative to planet center
 * @param view_ray Normalized view direction
 * @param shadow_length Distance along ray that is in shadow (0 = no shadow)
 * @param sun_direction Normalized sun direction
 */
fn GetSkyRadiance(
    atmosphere : AtmosphereParameters,
    camera : vec3f,
    view_ray : vec3f,
    shadow_length : f32,
    sun_direction : vec3f) -> SkySample {
  var local_camera = camera;
  var r = length(local_camera);
  var rmu = dot(local_camera, view_ray);
  let top_radius = atmosphere.top_radius;
  let distance_to_top =
      -rmu - sqrt(rmu * rmu - r * r + top_radius * top_radius);
  if (distance_to_top > 0.0) {
    local_camera = local_camera + view_ray * distance_to_top;
    r = top_radius;
    rmu += distance_to_top;
  } else if (r > top_radius) {
    return SkySample(vec3f(0.0), vec3f(1.0));
  }

  let mu = rmu / r;
  let mu_s = dot(local_camera, sun_direction) / r;
  let nu = dot(view_ray, sun_direction);
  let ray_r_mu_intersects_ground = RayIntersectsGround(atmosphere, r, mu);

  var scatter_result = CombinedScatteringResult(vec3f(0.0), vec3f(0.0));
  var transmittance : vec3f;
  if (ray_r_mu_intersects_ground) {
    transmittance = vec3f(0.0);
  } else {
    transmittance = SampleTransmittanceLUT(atmosphere, r, mu);
  }

  if (shadow_length == 0.0) {
    scatter_result = GetCombinedScattering(
        atmosphere, r, mu, mu_s, nu, ray_r_mu_intersects_ground);
  } else {
    let d = shadow_length;
    let r_p = ClampRadius(atmosphere, sqrt(d * d + 2.0 * r * mu * d + r * r));
    let mu_p = (r * mu + d) / r_p;
    let mu_s_p = (r * mu_s + d * nu) / r_p;
    scatter_result = GetCombinedScattering(
        atmosphere, r_p, mu_p, mu_s_p, nu, ray_r_mu_intersects_ground);
    let shadow_transmittance = GetTransmittance(
        atmosphere, r, mu, shadow_length, ray_r_mu_intersects_ground);
    scatter_result.scattering *= shadow_transmittance;
    scatter_result.single_mie *= shadow_transmittance;
  }

  let radiance = scatter_result.scattering * RayleighPhaseFunction(nu) +
      scatter_result.single_mie * MiePhaseFunction(atmosphere.mie_phase_function_g, nu);
  return SkySample(radiance, transmittance);
}

/**
 * GetSkyRadianceToPoint: Computes scattering along a ray segment to a specific point
 *
 * Similar to GetSkyRadiance, but instead of ray-marching to infinity, this computes
 * scattering along a finite ray segment from camera to a specific 3D point. This is
 * used for aerial perspective (atmospheric fog) on objects in the scene.
 *
 * The function:
 * 1. Handles camera outside atmosphere (moves to atmosphere boundary)
 * 2. Computes scattering integral from camera to point
 * 3. Accounts for shadows by subtracting the shadowed portion
 * 4. Returns both scattered radiance and transmittance for compositing
 *
 * @param camera Camera position
 * @param point Target point (e.g., surface intersection)
 * @param shadow_length Length of ray segment that is in shadow
 * @param sun_direction Normalized sun direction
 * @return SkySample with radiance and transmittance
 */
fn GetSkyRadianceToPoint(
    atmosphere : AtmosphereParameters,
    camera : vec3f,
    point : vec3f,
    shadow_length : f32,
    sun_direction : vec3f) -> SkySample {
  let view_ray = normalize(point - camera);
  var local_camera = camera;
  var r = length(local_camera);
  var rmu = dot(local_camera, view_ray);
  let distance_to_top =
      -rmu - sqrt(rmu * rmu - r * r + atmosphere.top_radius * atmosphere.top_radius);
  if (distance_to_top > 0.0) {
    local_camera = local_camera + view_ray * distance_to_top;
    r = atmosphere.top_radius;
    rmu += distance_to_top;
  }

  let mu = rmu / r;
  let mu_s = dot(local_camera, sun_direction) / r;
  let nu = dot(view_ray, sun_direction);
  var d = length(point - local_camera);
  let ray_r_mu_intersects_ground = RayIntersectsGround(atmosphere, r, mu);
  let transmittance = GetTransmittance(atmosphere, r, mu, d, ray_r_mu_intersects_ground);
  var scatter_result = GetCombinedScattering(
      atmosphere, r, mu, mu_s, nu, ray_r_mu_intersects_ground);
  d = max(d - shadow_length, 0.0);
  let r_p = ClampRadius(atmosphere, sqrt(d * d + 2.0 * r * mu * d + r * r));
  let mu_p = (r * mu + d) / r_p;
  let mu_s_p = (r * mu_s + d * nu) / r_p;
  let scatter_p = GetCombinedScattering(
      atmosphere, r_p, mu_p, mu_s_p, nu, ray_r_mu_intersects_ground);
  var shadow_transmittance : vec3f;
  if (shadow_length > 0.0) {
    shadow_transmittance =
        GetTransmittance(atmosphere, r, mu, d, ray_r_mu_intersects_ground);
  } else {
    shadow_transmittance = transmittance;
  }
  scatter_result.scattering -= shadow_transmittance * scatter_p.scattering;
  scatter_result.single_mie -= shadow_transmittance * scatter_p.single_mie;
  scatter_result.single_mie *= smoothstep(0.0, 0.01, mu_s);

  let radiance = scatter_result.scattering * RayleighPhaseFunction(nu) +
      scatter_result.single_mie * MiePhaseFunction(atmosphere.mie_phase_function_g, nu);
  return SkySample(radiance, transmittance);
}

struct SunSkyIrradiance {
  sun : vec3f,
  sky : vec3f,
}

/**
 * GetSunAndSkyIrradiance: Computes direct sun and diffuse sky lighting
 *
 * Returns the total irradiance (incoming light power per area) at a surface point
 * from two sources:
 * 1. Direct sunlight (with atmospheric attenuation)
 * 2. Diffuse skylight (light scattered from the sky dome)
 *
 * The sky irradiance uses a hemisphere integral approximation:
 * - Multiplies by (1 + dot(normal, zenith)) / 2
 * - This is a simple approximation of integrating over the visible hemisphere
 *
 * @param point Surface point position
 * @param normal Surface normal (normalized)
 * @param sun_direction Sun direction (normalized)
 * @return Separated sun and sky irradiance (RGB)
 */
fn GetSunAndSkyIrradiance(
    atmosphere : AtmosphereParameters,
    point : vec3f,
    normal : vec3f,
    sun_direction : vec3f) -> SunSkyIrradiance {
  let r = length(point);
  let mu_s = dot(point, sun_direction) / r;

  // Sky irradiance with hemisphere weighting
  let sky = GetIrradiance(atmosphere, r, mu_s) *
      (1.0 + dot(normal, point) / r) * 0.5;

  // Direct sun irradiance with cosine law (Lambert)
  let sun = atmosphere.solar_irradiance *
      GetTransmittanceToSun(atmosphere, r, mu_s) *
      max(dot(normal, sun_direction), 0.0);

  return SunSkyIrradiance(sun, sky);
}

/**
 * GetSolarRadiance: Converts solar irradiance to radiance
 *
 * The sun is modeled as a uniform disk with angular radius. This function
 * converts the irradiance (W/m²) to radiance (W/m²/sr) by dividing by the
 * solid angle subtended by the sun disk.
 *
 * Solid angle of a disk: Ω = π * sin²(angular_radius) ≈ π * angular_radius²
 *
 * @return Solar radiance (RGB)
 */
fn GetSolarRadiance(atmosphere : AtmosphereParameters) -> vec3f {
  return atmosphere.solar_irradiance /
      (PI * atmosphere.sun_angular_radius * atmosphere.sun_angular_radius);
}

/**
 * GetSunVisibility: Checks if demo sphere occludes the sun
 *
 * Computes whether the demo sphere blocks the sun when viewed from a given point.
 * Returns a smooth [0,1] visibility factor:
 * - 1.0: Sun fully visible
 * - 0.0: Sun fully occluded by sphere
 * - (0,1): Partial occulsion (smooth transition)
 *
 * This is used to cast shadows from the demo sphere onto the ground.
 *
 * @param point Surface point
 * @param sun_direction Direction to sun
 * @param sun_size Sun angular size parameters
 * @return Visibility factor [0,1]
 */
fn GetSunVisibility(point : vec3f, sun_direction : vec3f, sun_size : vec2f) -> f32 {
  let p = point - kSphereCenter;
  let p_dot_v = dot(p, sun_direction);
  let p_dot_p = dot(p, p);
  let ray_sphere_center_squared_distance = p_dot_p - p_dot_v * p_dot_v;
  let distance_to_intersection = -p_dot_v -
      sqrt(kSphereRadius * kSphereRadius - ray_sphere_center_squared_distance);

  if (distance_to_intersection > 0.0) {
    // Sphere occludes sun - compute smooth transition
    let ray_sphere_distance =
        kSphereRadius - sqrt(ray_sphere_center_squared_distance);
    let ray_sphere_angular_distance = -ray_sphere_distance / p_dot_v;
    return smoothstep(1.0, 0.0, ray_sphere_angular_distance / sun_size.x);
  }

  return 1.0;  // Sun fully visible
}

/**
 * GetSkyVisibility: Computes sky visibility factor for ambient occlusion
 *
 * Approximates how much sky hemisphere is visible from a point near the demo sphere.
 * This creates a simple ambient occlusion effect on the underside of the sphere.
 *
 * The formula approximates the solid angle of visible sky based on the sphere's
 * obstruction of the upper hemisphere.
 *
 * @param point Surface point
 * @return Sky visibility factor (typically close to 1.0)
 */
fn GetSkyVisibility(point : vec3f) -> f32 {
  let p = point - kSphereCenter;
  let p_dot_p = dot(p, p);
  return 1.0 + p.z / sqrt(p_dot_p) *
      kSphereRadius * kSphereRadius / p_dot_p;
}

/**
 * GetSphereShadowInOut: Computes shadow cone intersection along view ray
 *
 * This function computes where the view ray enters and exits the shadow volume
 * cast by the demo sphere. The shadow is modeled as a cone with:
 * - Apex at the sphere center (projected along sun direction)
 * - Base perpendicular to sun direction
 * - Opening angle determined by sun's angular size
 *
 * This creates volumetric light shafts (god rays) through the atmosphere
 * when looking through the shadow cone.
 *
 * The math solves for ray-cone intersection using a quadratic equation.
 * The cone equation accounts for the sun's angular size to create soft
 * shadow boundaries (penumbra effect).
 *
 * @param view_direction View ray direction (normalized)
 * @param sun_direction Sun direction (normalized)
 * @param sun_size Sun angular size parameters (tan, cos)
 * @return vec2(d_in, d_out) - distances where ray enters/exits shadow
 *         Returns (0,0) if no intersection
 */
fn GetSphereShadowInOut(
    view_direction : vec3f,
    sun_direction : vec3f,
    sun_size : vec2f) -> vec2f {
  // Position relative to sphere center
  let pos = vec3f(
      globals.camera_exposure.x,
      globals.camera_exposure.y,
      globals.camera_exposure.z) - kSphereCenter;

  let pos_dot_sun = dot(pos, sun_direction);
  let view_dot_sun = dot(view_direction, sun_direction);

  // Shadow cone parameters
  let k = sun_size.x;  // tan(sun_angular_radius)
  let l = 1.0 + k * k;

  // Quadratic equation coefficients for ray-cone intersection
  let a = 1.0 - l * view_dot_sun * view_dot_sun;
  let b = dot(pos, view_direction) - l * pos_dot_sun * view_dot_sun -
      k * kSphereRadius * view_dot_sun;
  let c = dot(pos, pos) - l * pos_dot_sun * pos_dot_sun -
      2.0 * k * kSphereRadius * pos_dot_sun - kSphereRadius * kSphereRadius;

  let discriminant = b * b - a * c;
  if (discriminant <= 0.0) {
    return vec2f(0.0);  // No intersection with shadow cone
  }

  // Solve quadratic equation
  var d_in = max(0.0, (-b - sqrt(discriminant)) / a);
  var d_out = (-b + sqrt(discriminant)) / a;

  // Clamp to shadow cone base and apex
  let d_base = -pos_dot_sun / view_dot_sun;
  let d_apex = -(pos_dot_sun + kSphereRadius / k) / view_dot_sun;

  if (view_dot_sun > 0.0) {
    d_in = max(d_in, d_apex);
    d_out = select(d_base, min(d_out, d_base), a > 0.0);
  } else {
    d_in = select(d_base, max(d_in, d_base), a > 0.0);
    d_out = min(d_out, d_apex);
  }

  return vec2f(d_in, d_out);
}

// ============================================================================
// SHADER ENTRY POINTS
// ============================================================================

struct VertexInput {
  @location(0) position : vec2f,  // 2D position in clip space [-1,1]
}

struct VertexOutput {
  @builtin(position) position : vec4f,  // Clip space position for rasterizer
  @location(0) view_ray : vec3f,        // View ray direction in world space
}

/**
 * Vertex Shader: Fullscreen quad with view ray computation
 *
 * This shader:
 * 1. Passes through the clip space position (fullscreen quad vertices)
 * 2. Computes the view ray direction for each vertex by:
 *    - Transforming clip position to view space (inverse projection)
 *    - Transforming to world space (inverse view matrix)
 *
 * The view ray is then interpolated across the triangle and used in the
 * fragment shader to ray-march through the atmosphere.
 */
@vertex
fn vs_main(input : VertexInput) -> VertexOutput {
  var clip = vec4f(input.position, 0.0, 1.0);
  var output : VertexOutput;
  output.position = clip;

  // Transform clip space position to world space direction
  let view_clip = globals.view_from_clip * clip;
  output.view_ray =
      (globals.model_from_view * vec4f(view_clip.xyz, 0.0)).xyz;

  return output;
}

/**
 * Fragment Shader: Main atmospheric rendering
 *
 * This shader renders:
 * 1. Sky - Atmospheric scattering in all directions
 * 2. Sun - Solar disk with proper size and limb darkening
 * 3. Ground - Earth surface with atmospheric effects
 * 4. Demo sphere - Small object demonstrating aerial perspective
 *
 * The rendering process:
 * 1. Ray-cast to find intersections with ground and demo sphere
 * 2. Compute direct lighting (sun + sky irradiance) for surfaces
 * 3. Add atmospheric scattering between camera and surfaces
 * 4. Composite sky, sun disk, and surfaces
 * 5. Apply tone mapping and gamma correction
 *
 * Returns final RGBA color ready for display.
 */
@fragment
fn fs_main(input : VertexOutput) -> @location(0) vec4f {
  // Extract uniforms and compute derived values
  let view_ray = input.view_ray;
  let view_dir = normalize(view_ray);
  let camera = vec3f(
      globals.camera_exposure.x,
      globals.camera_exposure.y,
      globals.camera_exposure.z);
  let earth_center = globals.earth_center.xyz;
  let sun_direction = normalize(globals.sun_direction_size.xyz);
  let sun_size = vec2f(globals.sun_direction_size.w, globals.white_point_size.w);
  let exposure = globals.camera_exposure.w;
  let white_point = globals.white_point_size.xyz;

  // Compute angular size of this pixel for anti-aliasing
  let fragment_angular_size =
      length(dpdx(view_ray) + dpdy(view_ray)) / max(length(view_ray), 1e-5);

  // Compute shadow region from demo sphere (for volumetric light shafts)
  let shadow_bounds = GetSphereShadowInOut(view_dir, sun_direction, sun_size);
  let shadow_in = shadow_bounds.x;
  let shadow_out = shadow_bounds.y;

  // Fade in light shafts based on sun elevation (avoid artifacts at sunset)
  let lightshaft_fadein_hack = smoothstep(
      0.02, 0.04, dot(normalize(camera - earth_center), sun_direction));

  // ======================================================================
  // Demo Sphere Intersection and Rendering
  // ======================================================================
  let p = camera - kSphereCenter;
  let p_dot_v = dot(p, view_dir);
  let p_dot_p = dot(p, p);
  let ray_sphere_center_squared_distance = p_dot_p - p_dot_v * p_dot_v;
  let discriminant = kSphereRadius * kSphereRadius - ray_sphere_center_squared_distance;

  var sphere_alpha = 0.0;
  var sphere_radiance = vec3f(0.0);
  if (discriminant >= 0.0) {
    let distance_to_intersection = -p_dot_v - sqrt(discriminant);
    if (distance_to_intersection > 0.0) {
      // Compute alpha for soft anti-aliased edges
      let ray_sphere_distance =
          kSphereRadius - sqrt(ray_sphere_center_squared_distance);
      let ray_sphere_angular_distance =
          ray_sphere_distance / max(-p_dot_v, 1e-5);
      sphere_alpha = min(
          ray_sphere_angular_distance / max(fragment_angular_size, 1e-5), 1.0);

      // Compute direct lighting (sun + sky) at intersection point
      let point = camera + view_dir * distance_to_intersection;
      let normal = normalize(point - kSphereCenter);
      let irradiance = GetSunAndSkyIrradiance(
          ATMOSPHERE, point - earth_center, normal, sun_direction);
      sphere_radiance = kSphereAlbedo * (1.0 / PI) *
          (irradiance.sun + irradiance.sky);

      // Add atmospheric scattering between camera and sphere
      let shadow_length =
          max(0.0, min(shadow_out, distance_to_intersection) - shadow_in) *
          lightshaft_fadein_hack;
      let scatter = GetSkyRadianceToPoint(
          ATMOSPHERE,
          camera - earth_center,
          point - earth_center,
          shadow_length,
          sun_direction);
      sphere_radiance = sphere_radiance * scatter.transmittance + scatter.radiance;
    }
  }

  // ======================================================================
  // Ground (Earth Surface) Intersection and Rendering
  // ======================================================================
  var ground_alpha = 0.0;
  var ground_radiance = vec3f(0.0);
  let earth_offset = camera - earth_center;
  let earth_dot_v = dot(earth_offset, view_dir);
  let earth_dot_earth = dot(earth_offset, earth_offset);
  let earth_radius_sq = ATMOSPHERE.bottom_radius * ATMOSPHERE.bottom_radius;
  let ray_center_sq = earth_dot_earth - earth_dot_v * earth_dot_v;
  let ground_discriminant = earth_radius_sq - ray_center_sq;

  if (ground_discriminant >= 0.0) {
    let ground_distance = -earth_dot_v - sqrt(ground_discriminant);
    if (ground_distance > 0.0) {
      // Compute direct lighting at ground intersection
      let point = camera + view_dir * ground_distance;
      let normal = normalize(point - earth_center);
      let irradiance = GetSunAndSkyIrradiance(
          ATMOSPHERE, point - earth_center, normal, sun_direction);

      // Apply sun visibility (occlusion by demo sphere) and sky visibility
      ground_radiance = kGroundAlbedo * (1.0 / PI) * (
          irradiance.sun * GetSunVisibility(point, sun_direction, sun_size) +
          irradiance.sky * GetSkyVisibility(point));

      // Add atmospheric scattering between camera and ground
      let shadow_length =
          max(0.0, min(shadow_out, ground_distance) - shadow_in) *
          lightshaft_fadein_hack;
      let scatter = GetSkyRadianceToPoint(
          ATMOSPHERE,
          camera - earth_center,
          point - earth_center,
          shadow_length,
          sun_direction);
      ground_radiance = ground_radiance * scatter.transmittance + scatter.radiance;
      ground_alpha = 1.0;
    }
  }

  // ======================================================================
  // Sky and Sun Disk Rendering
  // ======================================================================

  // Compute sky scattering (aerial perspective)
  let sky_shadow_length =
      max(0.0, shadow_out - shadow_in) * lightshaft_fadein_hack;
  let sky = GetSkyRadiance(
      ATMOSPHERE, camera - earth_center, view_dir,
      sky_shadow_length, sun_direction);

  var radiance = sky.radiance;

  // Add sun disk if looking toward the sun
  if (dot(view_dir, sun_direction) > sun_size.y) {
    radiance = radiance + sky.transmittance * GetSolarRadiance(ATMOSPHERE);
  }

  // ======================================================================
  // Final Composition and Tone Mapping
  // ======================================================================

  // Composite ground and sphere over sky (front-to-back blending)
  radiance = mix(radiance, ground_radiance, ground_alpha);
  radiance = mix(radiance, sphere_radiance, sphere_alpha);

  // Apply tone mapping (Reinhard) and gamma correction (sRGB)
  // 1. Exposure adjustment
  // 2. Reinhard tone mapping: color = 1 - exp(-radiance * exposure)
  // 3. Gamma correction: color^(1/2.2) for sRGB display
  let color = pow(
      vec3f(1.0) - exp(-radiance / white_point * exposure),
      vec3f(1.0 / 2.2));

  return vec4f(color, 1.0);
}
`,c=document.getElementById("webgpu-canvas"),b=document.getElementById("help"),S=1e3,A=.00935/2,O={viewDistanceMeters:9e3,viewZenithAngleRadians:1.47,viewAzimuthAngleRadians:-.1,sunZenithAngleRadians:1.3,sunAzimuthAngleRadians:2.9,exposure:10},B={1:{viewDistanceMeters:9e3,viewZenithAngleRadians:1.47,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.3,sunAzimuthAngleRadians:3,exposure:10},2:{viewDistanceMeters:9e3,viewZenithAngleRadians:1.47,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.564,sunAzimuthAngleRadians:-3,exposure:10},3:{viewDistanceMeters:7e3,viewZenithAngleRadians:1.57,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.54,sunAzimuthAngleRadians:-2.96,exposure:10},4:{viewDistanceMeters:7e3,viewZenithAngleRadians:1.57,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.328,sunAzimuthAngleRadians:-3.044,exposure:10},5:{viewDistanceMeters:9e3,viewZenithAngleRadians:1.39,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.2,sunAzimuthAngleRadians:.7,exposure:10},6:{viewDistanceMeters:9e3,viewZenithAngleRadians:1.5,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.628,sunAzimuthAngleRadians:1.05,exposure:200},7:{viewDistanceMeters:7e3,viewZenithAngleRadians:1.43,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.57,sunAzimuthAngleRadians:1.34,exposure:40},8:{viewDistanceMeters:27e5,viewZenithAngleRadians:.81,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.57,sunAzimuthAngleRadians:2,exposure:10},9:{viewDistanceMeters:12e6,viewZenithAngleRadians:0,viewAzimuthAngleRadians:0,sunZenithAngleRadians:.93,sunAzimuthAngleRadians:-2,exposure:10}},E=new Float32Array(16),y=new Float32Array(16),f=new Float32Array(64);function k(e,n,t){for(let a=0;a<4;a+=1)for(let i=0;i<4;i+=1)e[n+a*4+i]=t[i*4+a]}async function H(e){const n=["localhost","127.0.0.1","","::1"].includes(window.location.hostname);if(!window.isSecureContext&&!n)throw new Error("WebGPU requires a secure context. Run `npm run dev` and open http://localhost:5173/webgpu/.");if(!navigator.gpu)throw new Error("WebGPU is not available. Use Chrome 113+/Edge 113+ with the WebGPU flag enabled.");const t=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});if(!t)throw new Error("Failed to acquire GPU adapter.");const a=await t.requestDevice({requiredFeatures:["float32-filterable"]}),i=e.getContext("webgpu");if(!i)throw new Error("Failed to acquire WebGPU context.");const s=navigator.gpu.getPreferredCanvasFormat();return z(e,i,a,s),{device:a,context:i,format:s}}function z(e,n,t,a){const i=window.devicePixelRatio||1;e.width=Math.max(1,Math.floor(e.clientWidth*i)),e.height=Math.max(1,Math.floor(e.clientHeight*i)),n.configure({device:t,format:a,alphaMode:"opaque"})}async function Z(e,n){const t=e.createShaderModule({code:F}),a={layout:"auto",vertex:{module:t,entryPoint:"vs_main",buffers:[{arrayStride:8,attributes:[{shaderLocation:0,offset:0,format:"float32x2"}]}]},fragment:{module:t,entryPoint:"fs_main",targets:[{format:n}]},primitive:{topology:"triangle-strip"}};return e.createRenderPipeline(a)}function V(e,n,t,a,i){const s=e.createCommandEncoder(),o={colorAttachments:[{view:n.getCurrentTexture().createView(),clearValue:{r:.02,g:.02,b:.04,a:1},loadOp:"clear",storeOp:"store"}]},u=s.beginRenderPass(o);u.setPipeline(t),u.setBindGroup(0,a),u.setVertexBuffer(0,i),u.draw(4),u.end(),e.queue.submit([s.finish()])}function X(e,n){const t=.2777777777777778*Math.PI,a=Math.tan(t/2),i=e.width/e.height;E.set([a*i,0,0,0,0,a,0,0,0,0,0,-1,0,0,1,1]);const s=Math.cos(n.viewZenithAngleRadians),d=Math.sin(n.viewZenithAngleRadians),o=Math.cos(n.viewAzimuthAngleRadians),u=Math.sin(n.viewAzimuthAngleRadians),m=n.viewDistanceMeters/S;y.set([-u,-s*o,d*o,d*o*m,o,-s*u,d*u,d*u*m,0,d,s,s*m,0,0,0,1]);const l=[y[3],y[7],y[11]],h=[Math.cos(n.sunAzimuthAngleRadians)*Math.sin(n.sunZenithAngleRadians),Math.sin(n.sunAzimuthAngleRadians)*Math.sin(n.sunZenithAngleRadians),Math.cos(n.sunZenithAngleRadians)],p=[Math.tan(A),Math.cos(A)],g=[1,1,1],r=[0,0,-636e4/S];return k(f,0,E),k(f,16,y),f.set([l[0],l[1],l[2],n.exposure],32),f.set([h[0],h[1],h[2],p[0]],36),f.set([g[0],g[1],g[2],p[1]],40),f.set([r[0],r[1],r[2],0],44),f}function W(e,n){const t=B[n];return t?(Object.assign(e,t),!0):!1}async function Y(){try{const e=await H(c),n=await Z(e.device,e.format),t=await G(e.device),a=e.device.createSampler({minFilter:"linear",magFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge",addressModeW:"clamp-to-edge"}),i=I(e.device),s=N(e.device),d=e.device.createBindGroup({layout:n.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:s}},{binding:1,resource:t.transmittance.createView()},{binding:2,resource:t.scattering.createView()},{binding:3,resource:t.irradiance.createView()},{binding:4,resource:a}]}),o={...O},u=()=>{const r=X(c,o);q(e.device,s,r),V(e.device,e.context,n,d,i),requestAnimationFrame(u)};u(),window.addEventListener("keydown",r=>{if(r.key==="="||r.key==="+"){o.exposure*=1.1,r.preventDefault();return}if(r.key==="-"){o.exposure=Math.max(.01,o.exposure/1.1),r.preventDefault();return}if(r.key==="h"||r.key==="H"){b&&b.classList.toggle("hidden"),r.preventDefault();return}W(o,r.key)&&r.preventDefault()}),c.addEventListener("wheel",r=>{const _=r.deltaY>0?1.05:.9523809523809523;o.viewDistanceMeters*=_,o.viewDistanceMeters=Math.max(1,o.viewDistanceMeters),r.preventDefault()},{passive:!1});let m=null,l=0,h=0;const p=500;c.addEventListener("pointerdown",r=>{m=r.shiftKey?"sun":"camera";const _=c.getBoundingClientRect();l=r.clientX-_.left,h=r.clientY-_.top,c.setPointerCapture(r.pointerId),r.preventDefault()}),c.addEventListener("pointermove",r=>{if(!m||!c.hasPointerCapture(r.pointerId))return;const _=c.getBoundingClientRect(),w=r.clientX-_.left,T=r.clientY-_.top,x=l-w,R=h-T;m==="sun"?(o.sunZenithAngleRadians-=R/p,o.sunZenithAngleRadians=Math.min(Math.PI,Math.max(0,o.sunZenithAngleRadians)),o.sunAzimuthAngleRadians+=x/p):(o.viewZenithAngleRadians+=R/p,o.viewZenithAngleRadians=Math.min(Math.PI/2,Math.max(0,o.viewZenithAngleRadians)),o.viewAzimuthAngleRadians+=x/p),l=w,h=T});const g=r=>{c.hasPointerCapture(r.pointerId)&&(c.releasePointerCapture(r.pointerId),m=null)};c.addEventListener("pointerup",g),c.addEventListener("pointercancel",g),window.addEventListener("resize",()=>{z(c,e.context,e.device,e.format)})}catch(e){console.error(e)}}Y();

import"./modulepreload-polyfill-B5Qt9EMX.js";const G={transmittance:{url:new URL("/precomputed_atmospheric_scattering/assets/transmittance-Dhu7e32V.dat",import.meta.url).href,width:256,height:64,depthOrArrayLayers:1,dimension:"2d"},scattering:{url:new URL("/precomputed_atmospheric_scattering/assets/scattering-DZS1K7te.dat",import.meta.url).href,width:256,height:128,depthOrArrayLayers:32,dimension:"3d"},irradiance:{url:new URL("/precomputed_atmospheric_scattering/assets/irradiance-QaddpanP.dat",import.meta.url).href,width:64,height:16,depthOrArrayLayers:1,dimension:"2d"}};async function I(e){const n=await fetch(e);if(!n.ok)throw new Error(`Failed to load ${e}: ${n.status} ${n.statusText}`);const t=await n.arrayBuffer(),a=new DataView(t),i=new Float32Array(t.byteLength/Float32Array.BYTES_PER_ELEMENT);for(let s=0;s<i.length;++s)i[s]=a.getFloat32(s*Float32Array.BYTES_PER_ELEMENT,!0);return i}function M(e,n){return e.createTexture({size:[n.width,n.height,n.depthOrArrayLayers],dimension:n.dimension==="3d"?"3d":"2d",format:"rgba32float",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST})}function U(e,n,t,a){const i=Float32Array.BYTES_PER_ELEMENT,s=t.width*4*i,d=t.height;e.queue.writeTexture({texture:n},a,{bytesPerRow:s,rowsPerImage:d},{width:t.width,height:t.height,depthOrArrayLayers:t.depthOrArrayLayers})}async function C(e){const n=await Promise.all(Object.entries(G).map(async([t,a])=>{const i=await I(a.url),s=M(e,a);return U(e,s,a,i),[t,s]}));return Object.fromEntries(n)}const w=new Float32Array([-1,-1,1,-1,-1,1,1,1]);function k(e){const n=e.createBuffer({size:w.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});return e.queue.writeBuffer(n,0,w.buffer,w.byteOffset,w.byteLength),n}const z=64,D=z*Float32Array.BYTES_PER_ELEMENT;function N(e){return e.createBuffer({size:D,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}function L(e,n,t){e.queue.writeBuffer(n,0,t.buffer,t.byteOffset,t.byteLength)}const F=`struct Globals {
  view_from_clip : mat4x4f,
  model_from_view : mat4x4f,
  camera_exposure : vec4f,
  sun_direction_size : vec4f,
  white_point_size : vec4f,
  earth_center : vec4f,
}

@group(0) @binding(0) var<uniform> globals : Globals;
@group(0) @binding(1) var transmittance_texture : texture_2d<f32>;
@group(0) @binding(2) var scattering_texture : texture_3d<f32>;
@group(0) @binding(3) var irradiance_texture : texture_2d<f32>;
@group(0) @binding(4) var lut_sampler : sampler;

// ============================================================================
// ATMOSPHERE CONSTANTS AND TYPE DEFINITIONS
// ============================================================================

const TRANSMITTANCE_TEXTURE_WIDTH : i32 = 256;
const TRANSMITTANCE_TEXTURE_HEIGHT : i32 = 64;
const SCATTERING_TEXTURE_R_SIZE : i32 = 32;
const SCATTERING_TEXTURE_MU_SIZE : i32 = 128;
const SCATTERING_TEXTURE_MU_S_SIZE : i32 = 32;
const SCATTERING_TEXTURE_NU_SIZE : i32 = 8;
const IRRADIANCE_TEXTURE_WIDTH : i32 = 64;
const IRRADIANCE_TEXTURE_HEIGHT : i32 = 16;

const m : f32 = 1.0;
const nm : f32 = 1.0;
const rad : f32 = 1.0;
const sr : f32 = 1.0;
const watt : f32 = 1.0;
const lm : f32 = 1.0;
const PI : f32 = 3.14159265358979323846;
const m2 : f32 = m * m;
const m3 : f32 = m * m * m;
const watt_per_square_meter : f32 = watt / m2;
const watt_per_square_meter_per_sr : f32 = watt / (m2 * sr);
const watt_per_square_meter_per_nm : f32 = watt / (m2 * nm);
const watt_per_square_meter_per_sr_per_nm : f32 = watt / (m2 * sr * nm);
const watt_per_cubic_meter_per_sr_per_nm : f32 = watt / (m3 * sr * nm);

const SKY_SPECTRAL_RADIANCE_TO_LUMINANCE : vec3f =
    vec3f(114974.916437, 71305.954816, 65310.548555);
const SUN_SPECTRAL_RADIANCE_TO_LUMINANCE : vec3f =
    vec3f(98242.786222, 69954.398112, 66475.012354);

const kLengthUnitInMeters : f32 = 1000.0;
const kSphereCenter : vec3f = vec3f(0.0, 0.0, 1000.0) / kLengthUnitInMeters;
const kSphereRadius : f32 = 1000.0 / kLengthUnitInMeters;
const kSphereAlbedo : vec3f = vec3f(0.8);
const kGroundAlbedo : vec3f = vec3f(0.0, 0.0, 0.04);

struct DensityProfileLayer {
  width : f32,
  exp_term : f32,
  exp_scale : f32,
  linear_term : f32,
  constant_term : f32,
}

struct DensityProfile {
  layers : array<DensityProfileLayer, 2>,
}

struct AtmosphereParameters {
  solar_irradiance : vec3f,
  sun_angular_radius : f32,
  bottom_radius : f32,
  top_radius : f32,
  rayleigh_density : DensityProfile,
  rayleigh_scattering : vec3f,
  mie_density : DensityProfile,
  mie_scattering : vec3f,
  mie_extinction : vec3f,
  mie_phase_function_g : f32,
  absorption_density : DensityProfile,
  absorption_extinction : vec3f,
  ground_albedo : vec3f,
  mu_s_min : f32,
}

const ATMOSPHERE : AtmosphereParameters = AtmosphereParameters(
  vec3f(1.474000, 1.850400, 1.911980),
  0.004675,
  6360.0,
  6420.0,
  DensityProfile(array<DensityProfileLayer, 2>(
    DensityProfileLayer(0.0, 0.0, 0.0, 0.0, 0.0),
    DensityProfileLayer(0.0, 1.0, -0.125, 0.0, 0.0)
  )),
  vec3f(0.005802, 0.013558, 0.033100),
  DensityProfile(array<DensityProfileLayer, 2>(
    DensityProfileLayer(0.0, 0.0, 0.0, 0.0, 0.0),
    DensityProfileLayer(0.0, 1.0, -0.833333, 0.0, 0.0)
  )),
  vec3f(0.003996, 0.003996, 0.003996),
  vec3f(0.004440, 0.004440, 0.004440),
  0.8,
  DensityProfile(array<DensityProfileLayer, 2>(
    DensityProfileLayer(25.0, 0.0, 0.0, 0.066667, -0.666667),
    DensityProfileLayer(0.0, 0.0, 0.0, -0.066667, 2.666667)
  )),
  vec3f(0.000650, 0.001881, 0.000085),
  vec3f(0.1, 0.1, 0.1),
  -0.207912
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

fn ClampCosine(mu : f32) -> f32 {
  return clamp(mu, -1.0, 1.0);
}

fn ClampDistance(d : f32) -> f32 {
  return max(d, 0.0);
}

fn ClampRadius(atmosphere : AtmosphereParameters, r : f32) -> f32 {
  return clamp(r, atmosphere.bottom_radius, atmosphere.top_radius);
}

fn SafeSqrt(v : f32) -> f32 {
  return sqrt(max(v, 0.0));
}

fn DistanceToTopAtmosphereBoundary(atmosphere : AtmosphereParameters, r : f32, mu : f32) -> f32 {
  let discriminant = r * r * (mu * mu - 1.0) + atmosphere.top_radius * atmosphere.top_radius;
  return ClampDistance(-r * mu + SafeSqrt(discriminant));
}

fn DistanceToBottomAtmosphereBoundary(atmosphere : AtmosphereParameters, r : f32, mu : f32) -> f32 {
  let discriminant = r * r * (mu * mu - 1.0) + atmosphere.bottom_radius * atmosphere.bottom_radius;
  return ClampDistance(-r * mu - SafeSqrt(discriminant));
}

fn RayIntersectsGround(atmosphere : AtmosphereParameters, r : f32, mu : f32) -> bool {
  return mu < 0.0 && (r * r * (mu * mu - 1.0) +
      atmosphere.bottom_radius * atmosphere.bottom_radius >= 0.0);
}

fn GetTextureCoordFromUnitRange(x : f32, texture_size : i32) -> f32 {
  return 0.5 / f32(texture_size) + x * (1.0 - 1.0 / f32(texture_size));
}

fn GetUnitRangeFromTextureCoord(u : f32, texture_size : i32) -> f32 {
  return (u - 0.5 / f32(texture_size)) / (1.0 - 1.0 / f32(texture_size));
}

// ============================================================================
// TRANSMITTANCE LOOKUPS
// ============================================================================

struct RMuResult {
  r : f32,
  mu : f32,
}

fn GetTransmittanceTextureUvFromRMu(atmosphere : AtmosphereParameters, r : f32, mu : f32) -> vec2f {
  let H = sqrt(atmosphere.top_radius * atmosphere.top_radius -
      atmosphere.bottom_radius * atmosphere.bottom_radius);
  let rho = SafeSqrt(r * r - atmosphere.bottom_radius * atmosphere.bottom_radius);
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

fn GetRMuFromTransmittanceTextureUv(atmosphere : AtmosphereParameters, uv : vec2f) -> RMuResult {
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

  var result : RMuResult;
  result.r = r;
  result.mu = ClampCosine(mu);
  return result;
}

fn GetTransmittanceToTopAtmosphereBoundary(
    atmosphere : AtmosphereParameters, r : f32, mu : f32) -> vec3f {
  let uv = GetTransmittanceTextureUvFromRMu(atmosphere, r, mu);
  return textureSampleLevel(transmittance_texture, lut_sampler, uv, 0.0).rgb;
}

fn GetTransmittance(
    atmosphere : AtmosphereParameters,
    r : f32,
    mu : f32,
    d : f32,
    ray_r_mu_intersects_ground : bool) -> vec3f {
  let r_d = ClampRadius(atmosphere, sqrt(d * d + 2.0 * r * mu * d + r * r));
  let mu_d = ClampCosine((r * mu + d) / r_d);
  if (ray_r_mu_intersects_ground) {
    return min(
        GetTransmittanceToTopAtmosphereBoundary(atmosphere, r_d, -mu_d) /
        GetTransmittanceToTopAtmosphereBoundary(atmosphere, r, -mu),
        vec3f(1.0));
  }
  return min(
      GetTransmittanceToTopAtmosphereBoundary(atmosphere, r, mu) /
      GetTransmittanceToTopAtmosphereBoundary(atmosphere, r_d, mu_d),
      vec3f(1.0));
}

fn GetTransmittanceToSun(atmosphere : AtmosphereParameters, r : f32, mu_s : f32) -> vec3f {
  let sin_theta_h = atmosphere.bottom_radius / r;
  let cos_theta_h = -sqrt(max(1.0 - sin_theta_h * sin_theta_h, 0.0));
  return GetTransmittanceToTopAtmosphereBoundary(atmosphere, r, mu_s) *
      smoothstep(
        -sin_theta_h * atmosphere.sun_angular_radius / rad,
        sin_theta_h * atmosphere.sun_angular_radius / rad,
        mu_s - cos_theta_h);
}

// ============================================================================
// SCATTERING LOOKUPS
// ============================================================================

fn RayleighPhaseFunction(nu : f32) -> f32 {
  let k = 3.0 / (16.0 * PI * sr);
  return k * (1.0 + nu * nu);
}

fn MiePhaseFunction(g : f32, nu : f32) -> f32 {
  let k = 3.0 / (8.0 * PI * sr) * (1.0 - g * g) / (2.0 + g * g);
  return k * (1.0 + nu * nu) / pow(1.0 + g * g - 2.0 * g * nu, 1.5);
}

fn GetScatteringTextureUvwzFromRMuMuSNu(
    atmosphere : AtmosphereParameters,
    r : f32,
    mu : f32,
    mu_s : f32,
    nu : f32,
    ray_r_mu_intersects_ground : bool) -> vec4f {
  let H = sqrt(atmosphere.top_radius * atmosphere.top_radius -
      atmosphere.bottom_radius * atmosphere.bottom_radius);
  let rho = SafeSqrt(r * r - atmosphere.bottom_radius * atmosphere.bottom_radius);
  let u_r = GetTextureCoordFromUnitRange(rho / H, SCATTERING_TEXTURE_R_SIZE);
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
    u_mu = 0.5 - 0.5 * GetTextureCoordFromUnitRange(
        ratio,
        SCATTERING_TEXTURE_MU_SIZE / 2);
  } else {
    let d = -r_mu + SafeSqrt(discriminant + H * H);
    let d_min = atmosphere.top_radius - r;
    let d_max = rho + H;
    u_mu = 0.5 + 0.5 * GetTextureCoordFromUnitRange(
        (d - d_min) / (d_max - d_min),
        SCATTERING_TEXTURE_MU_SIZE / 2);
  }
  let d = DistanceToTopAtmosphereBoundary(atmosphere, atmosphere.bottom_radius, mu_s);
  let d_min = atmosphere.top_radius - atmosphere.bottom_radius;
  let d_max = H;
  let a = (d - d_min) / (d_max - d_min);
  let D = DistanceToTopAtmosphereBoundary(atmosphere, atmosphere.bottom_radius, atmosphere.mu_s_min);
  let A = (D - d_min) / (d_max - d_min);
  let u_mu_s = GetTextureCoordFromUnitRange(
      max(1.0 - a / A, 0.0) / (1.0 + a), SCATTERING_TEXTURE_MU_S_SIZE);
  let u_nu = (nu + 1.0) * 0.5;
  return vec4f(u_nu, u_mu_s, u_mu, u_r);
}

fn GetIrradianceTextureUvFromRMuS(atmosphere : AtmosphereParameters, r : f32, mu_s : f32) -> vec2f {
  let x_r = (r - atmosphere.bottom_radius) /
      (atmosphere.top_radius - atmosphere.bottom_radius);
  let x_mu_s = mu_s * 0.5 + 0.5;
  return vec2f(
      GetTextureCoordFromUnitRange(x_mu_s, IRRADIANCE_TEXTURE_WIDTH),
      GetTextureCoordFromUnitRange(x_r, IRRADIANCE_TEXTURE_HEIGHT));
}

fn GetIrradiance(atmosphere : AtmosphereParameters, r : f32, mu_s : f32) -> vec3f {
  let uv = GetIrradianceTextureUvFromRMuS(atmosphere, r, mu_s);
  return textureSampleLevel(irradiance_texture, lut_sampler, uv, 0.0).rgb;
}

fn GetExtrapolatedSingleMieScattering(atmosphere : AtmosphereParameters, scattering : vec4f) -> vec3f {
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

fn GetCombinedScattering(
    atmosphere : AtmosphereParameters,
    r : f32,
    mu : f32,
    mu_s : f32,
    nu : f32,
    ray_r_mu_intersects_ground : bool) -> CombinedScatteringResult {
  let uvwz = GetScatteringTextureUvwzFromRMuMuSNu(
      atmosphere, r, mu, mu_s, nu, ray_r_mu_intersects_ground);
  let tex_coord_x = uvwz.x * f32(SCATTERING_TEXTURE_NU_SIZE - 1);
  let tex_x = floor(tex_coord_x);
  let lerp = tex_coord_x - tex_x;
  let uvw0 = vec3f((tex_x + uvwz.y) / f32(SCATTERING_TEXTURE_NU_SIZE), uvwz.z, uvwz.w);
  let uvw1 = vec3f((tex_x + 1.0 + uvwz.y) / f32(SCATTERING_TEXTURE_NU_SIZE), uvwz.z, uvwz.w);
  let combined0 = textureSampleLevel(scattering_texture, lut_sampler, uvw0, 0.0);
  let combined1 = textureSampleLevel(scattering_texture, lut_sampler, uvw1, 0.0);
  let combined = combined0 * (1.0 - lerp) + combined1 * lerp;

  var result : CombinedScatteringResult;
  result.scattering = combined.rgb;
  result.single_mie = GetExtrapolatedSingleMieScattering(atmosphere, combined);
  return result;
}

struct SkySample {
  radiance : vec3f,
  transmittance : vec3f,
}

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
    transmittance = GetTransmittanceToTopAtmosphereBoundary(atmosphere, r, mu);
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

fn GetSunAndSkyIrradiance(
    atmosphere : AtmosphereParameters,
    point : vec3f,
    normal : vec3f,
    sun_direction : vec3f) -> SunSkyIrradiance {
  let r = length(point);
  let mu_s = dot(point, sun_direction) / r;
  let sky = GetIrradiance(atmosphere, r, mu_s) *
      (1.0 + dot(normal, point) / r) * 0.5;
  let sun = atmosphere.solar_irradiance *
      GetTransmittanceToSun(atmosphere, r, mu_s) *
      max(dot(normal, sun_direction), 0.0);
  return SunSkyIrradiance(sun, sky);
}

fn GetSolarRadiance(atmosphere : AtmosphereParameters) -> vec3f {
  return atmosphere.solar_irradiance /
      (PI * atmosphere.sun_angular_radius * atmosphere.sun_angular_radius);
}

fn GetSunVisibility(point : vec3f, sun_direction : vec3f, sun_size : vec2f) -> f32 {
  let p = point - kSphereCenter;
  let p_dot_v = dot(p, sun_direction);
  let p_dot_p = dot(p, p);
  let ray_sphere_center_squared_distance = p_dot_p - p_dot_v * p_dot_v;
  let distance_to_intersection = -p_dot_v -
      sqrt(kSphereRadius * kSphereRadius - ray_sphere_center_squared_distance);
  if (distance_to_intersection > 0.0) {
    let ray_sphere_distance =
        kSphereRadius - sqrt(ray_sphere_center_squared_distance);
    let ray_sphere_angular_distance = -ray_sphere_distance / p_dot_v;
    return smoothstep(1.0, 0.0, ray_sphere_angular_distance / sun_size.x);
  }
  return 1.0;
}

fn GetSkyVisibility(point : vec3f) -> f32 {
  let p = point - kSphereCenter;
  let p_dot_p = dot(p, p);
  return 1.0 + p.z / sqrt(p_dot_p) *
      kSphereRadius * kSphereRadius / p_dot_p;
}

fn GetSphereShadowInOut(
    view_direction : vec3f,
    sun_direction : vec3f,
    sun_size : vec2f) -> vec2f {
  let pos = vec3f(
      globals.camera_exposure.x,
      globals.camera_exposure.y,
      globals.camera_exposure.z) - kSphereCenter;
  let pos_dot_sun = dot(pos, sun_direction);
  let view_dot_sun = dot(view_direction, sun_direction);
  let k = sun_size.x;
  let l = 1.0 + k * k;
  let a = 1.0 - l * view_dot_sun * view_dot_sun;
  let b = dot(pos, view_direction) - l * pos_dot_sun * view_dot_sun -
      k * kSphereRadius * view_dot_sun;
  let c = dot(pos, pos) - l * pos_dot_sun * pos_dot_sun -
      2.0 * k * kSphereRadius * pos_dot_sun - kSphereRadius * kSphereRadius;
  let discriminant = b * b - a * c;
  if (discriminant <= 0.0) {
    return vec2f(0.0);
  }
  var d_in = max(0.0, (-b - sqrt(discriminant)) / a);
  var d_out = (-b + sqrt(discriminant)) / a;
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
  let camera = vec3f(
      globals.camera_exposure.x,
      globals.camera_exposure.y,
      globals.camera_exposure.z);
  let earth_center = globals.earth_center.xyz;
  let sun_direction = normalize(globals.sun_direction_size.xyz);
  let sun_size = vec2f(globals.sun_direction_size.w, globals.white_point_size.w);
  let exposure = globals.camera_exposure.w;
  let white_point = globals.white_point_size.xyz;

  let fragment_angular_size =
      length(dpdx(view_ray) + dpdy(view_ray)) / max(length(view_ray), 1e-5);

  let shadow_bounds = GetSphereShadowInOut(view_dir, sun_direction, sun_size);
  let shadow_in = shadow_bounds.x;
  let shadow_out = shadow_bounds.y;
  let lightshaft_fadein_hack = smoothstep(
      0.02, 0.04, dot(normalize(camera - earth_center), sun_direction));

  // Sphere intersection
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
      let ray_sphere_distance =
          kSphereRadius - sqrt(ray_sphere_center_squared_distance);
      let ray_sphere_angular_distance =
          ray_sphere_distance / max(-p_dot_v, 1e-5);
      sphere_alpha = min(
          ray_sphere_angular_distance / max(fragment_angular_size, 1e-5), 1.0);

      let point = camera + view_dir * distance_to_intersection;
      let normal = normalize(point - kSphereCenter);
      let irradiance = GetSunAndSkyIrradiance(
          ATMOSPHERE, point - earth_center, normal, sun_direction);
      sphere_radiance = kSphereAlbedo * (1.0 / PI) *
          (irradiance.sun + irradiance.sky);
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

  // Ground intersection
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
      let point = camera + view_dir * ground_distance;
      let normal = normalize(point - earth_center);
      let irradiance = GetSunAndSkyIrradiance(
          ATMOSPHERE, point - earth_center, normal, sun_direction);
      ground_radiance = kGroundAlbedo * (1.0 / PI) * (
          irradiance.sun * GetSunVisibility(point, sun_direction, sun_size) +
          irradiance.sky * GetSkyVisibility(point));
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

  let sky_shadow_length =
      max(0.0, shadow_out - shadow_in) * lightshaft_fadein_hack;
  let sky = GetSkyRadiance(
      ATMOSPHERE, camera - earth_center, view_dir,
      sky_shadow_length, sun_direction);
  var radiance = sky.radiance;
  if (dot(view_dir, sun_direction) > sun_size.y) {
    radiance = radiance + sky.transmittance * GetSolarRadiance(ATMOSPHERE);
  }
  radiance = mix(radiance, ground_radiance, ground_alpha);
  radiance = mix(radiance, sphere_radiance, sphere_alpha);

  let color = pow(
      vec3f(1.0) - exp(-radiance / white_point * exposure),
      vec3f(1.0 / 2.2));
  return vec4f(color, 1.0);
}
`,_=document.getElementById("webgpu-canvas"),x=1e3,S=.00935/2,q={viewDistanceMeters:9e3,viewZenithAngleRadians:1.47,viewAzimuthAngleRadians:-.1,sunZenithAngleRadians:1.3,sunAzimuthAngleRadians:2.9,exposure:10},O={1:{viewDistanceMeters:9e3,viewZenithAngleRadians:1.47,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.3,sunAzimuthAngleRadians:3,exposure:10},2:{viewDistanceMeters:9e3,viewZenithAngleRadians:1.47,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.564,sunAzimuthAngleRadians:-3,exposure:10},3:{viewDistanceMeters:7e3,viewZenithAngleRadians:1.57,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.54,sunAzimuthAngleRadians:-2.96,exposure:10},4:{viewDistanceMeters:7e3,viewZenithAngleRadians:1.57,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.328,sunAzimuthAngleRadians:-3.044,exposure:10},5:{viewDistanceMeters:9e3,viewZenithAngleRadians:1.39,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.2,sunAzimuthAngleRadians:.7,exposure:10},6:{viewDistanceMeters:9e3,viewZenithAngleRadians:1.5,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.628,sunAzimuthAngleRadians:1.05,exposure:200},7:{viewDistanceMeters:7e3,viewZenithAngleRadians:1.43,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.57,sunAzimuthAngleRadians:1.34,exposure:40},8:{viewDistanceMeters:27e5,viewZenithAngleRadians:.81,viewAzimuthAngleRadians:0,sunZenithAngleRadians:1.57,sunAzimuthAngleRadians:2,exposure:10},9:{viewDistanceMeters:12e6,viewZenithAngleRadians:0,viewAzimuthAngleRadians:0,sunZenithAngleRadians:.93,sunAzimuthAngleRadians:-2,exposure:10}},E=new Float32Array(16),v=new Float32Array(16),f=new Float32Array(64);function b(e,n,t){for(let a=0;a<4;a+=1)for(let i=0;i<4;i+=1)e[n+a*4+i]=t[i*4+a]}async function Z(e){const n=["localhost","127.0.0.1","","::1"].includes(window.location.hostname);if(!window.isSecureContext&&!n)throw new Error("WebGPU requires a secure context. Run `npm run dev` and open http://localhost:5173/webgpu/.");if(!navigator.gpu)throw new Error("WebGPU is not available. Use Chrome 113+/Edge 113+ with the WebGPU flag enabled.");const t=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});if(!t)throw new Error("Failed to acquire GPU adapter.");const a=await t.requestDevice({requiredFeatures:["float32-filterable"]}),i=e.getContext("webgpu");if(!i)throw new Error("Failed to acquire WebGPU context.");const s=navigator.gpu.getPreferredCanvasFormat();return P(e,i,a,s),{device:a,context:i,format:s}}function P(e,n,t,a){const i=window.devicePixelRatio||1;e.width=Math.max(1,Math.floor(e.clientWidth*i)),e.height=Math.max(1,Math.floor(e.clientHeight*i)),n.configure({device:t,format:a,alphaMode:"opaque"})}async function H(e,n){const t=e.createShaderModule({code:F}),a={layout:"auto",vertex:{module:t,entryPoint:"vs_main",buffers:[{arrayStride:8,attributes:[{shaderLocation:0,offset:0,format:"float32x2"}]}]},fragment:{module:t,entryPoint:"fs_main",targets:[{format:n}]},primitive:{topology:"triangle-strip"}};return e.createRenderPipeline(a)}function B(e,n,t,a,i){const s=e.createCommandEncoder(),o={colorAttachments:[{view:n.getCurrentTexture().createView(),clearValue:{r:.02,g:.02,b:.04,a:1},loadOp:"clear",storeOp:"store"}]},u=s.beginRenderPass(o);u.setPipeline(t),u.setBindGroup(0,a),u.setVertexBuffer(0,i),u.draw(4),u.end(),e.queue.submit([s.finish()])}function X(e,n){const t=.2777777777777778*Math.PI,a=Math.tan(t/2),i=e.width/e.height;E.set([a*i,0,0,0,0,a,0,0,0,0,0,-1,0,0,1,1]);const s=Math.cos(n.viewZenithAngleRadians),d=Math.sin(n.viewZenithAngleRadians),o=Math.cos(n.viewAzimuthAngleRadians),u=Math.sin(n.viewAzimuthAngleRadians),c=n.viewDistanceMeters/x;v.set([-u,-s*o,d*o,d*o*c,o,-s*u,d*u,d*u*c,0,d,s,s*c,0,0,0,1]);const m=[v[3],v[7],v[11]],l=[Math.cos(n.sunAzimuthAngleRadians)*Math.sin(n.sunZenithAngleRadians),Math.sin(n.sunAzimuthAngleRadians)*Math.sin(n.sunZenithAngleRadians),Math.cos(n.sunZenithAngleRadians)],p=[Math.tan(S),Math.cos(S)],g=[1,1,1],r=[0,0,-636e4/x];return b(f,0,E),b(f,16,v),f.set([m[0],m[1],m[2],n.exposure],32),f.set([l[0],l[1],l[2],p[0]],36),f.set([g[0],g[1],g[2],p[1]],40),f.set([r[0],r[1],r[2],0],44),f}function V(e,n){const t=O[n];return t?(Object.assign(e,t),!0):!1}async function Y(){try{const e=await Z(_),n=await H(e.device,e.format),t=await C(e.device);console.info("Loaded LUT textures:",t);const a=e.device.createSampler({minFilter:"linear",magFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge",addressModeW:"clamp-to-edge"}),i=k(e.device),s=N(e.device),d=e.device.createBindGroup({layout:n.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:s}},{binding:1,resource:t.transmittance.createView()},{binding:2,resource:t.scattering.createView()},{binding:3,resource:t.irradiance.createView()},{binding:4,resource:a}]}),o={...q},u=()=>{const r=X(_,o);L(e.device,s,r),B(e.device,e.context,n,d,i),requestAnimationFrame(u)};u(),window.addEventListener("keydown",r=>{if(r.key==="="||r.key==="+"){o.exposure*=1.1,r.preventDefault();return}if(r.key==="-"){o.exposure=Math.max(.01,o.exposure/1.1),r.preventDefault();return}V(o,r.key)&&r.preventDefault()}),_.addEventListener("wheel",r=>{const h=r.deltaY>0?1.05:.9523809523809523;o.viewDistanceMeters*=h,o.viewDistanceMeters=Math.max(1,o.viewDistanceMeters),r.preventDefault()},{passive:!1});let c=null,m=0,l=0;const p=500;_.addEventListener("pointerdown",r=>{c=r.shiftKey?"sun":"camera";const h=_.getBoundingClientRect();m=r.clientX-h.left,l=r.clientY-h.top,_.setPointerCapture(r.pointerId),r.preventDefault()}),_.addEventListener("pointermove",r=>{if(!c||!_.hasPointerCapture(r.pointerId))return;const h=_.getBoundingClientRect(),T=r.clientX-h.left,R=r.clientY-h.top,y=m-T,A=l-R;c==="sun"?(o.sunZenithAngleRadians-=A/p,o.sunZenithAngleRadians=Math.min(Math.PI,Math.max(0,o.sunZenithAngleRadians)),o.sunAzimuthAngleRadians+=y/p):(o.viewZenithAngleRadians+=A/p,o.viewZenithAngleRadians=Math.min(Math.PI/2,Math.max(0,o.viewZenithAngleRadians)),o.viewAzimuthAngleRadians+=y/p),m=T,l=R});const g=r=>{_.hasPointerCapture(r.pointerId)&&(_.releasePointerCapture(r.pointerId),c=null)};_.addEventListener("pointerup",g),_.addEventListener("pointercancel",g),window.addEventListener("resize",()=>{P(_,e.context,e.device,e.format)})}catch(e){console.error(e)}}Y();

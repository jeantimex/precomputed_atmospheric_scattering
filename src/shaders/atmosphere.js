/**
 * Copyright (c) 2018 Eric Bruneton
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holders nor the names of its
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * Atmospheric scattering shader
 * 
 * This shader implements a physically-based atmospheric scattering model
 * based on precomputed atmospheric scattering. It simulates:
 * 
 * 1. Rayleigh scattering (scattering by air molecules)
 * 2. Mie scattering (scattering by aerosols/particles)
 * 3. Absorption by ozone
 * 4. Multiple scattering effects
 * 5. Ground reflections
 * 
 * The implementation uses precomputed lookup tables stored in textures
 * to avoid expensive real-time calculations.
 */
export const atmosphereShader = /* glsl */ `
  // Set precision for floating point calculations
  precision highp float;
  precision highp sampler3D;
  
  // Define macros for function parameter qualifiers
  #define IN(x) const in x
  #define OUT(x) out x
  #define TEMPLATE(x)
  #define TEMPLATE_ARGUMENT(x)
  #define assert(x)
  
  // Texture dimensions for the precomputed lookup tables
  const int TRANSMITTANCE_TEXTURE_WIDTH = 256;
  const int TRANSMITTANCE_TEXTURE_HEIGHT = 64;
  const int SCATTERING_TEXTURE_R_SIZE = 32;
  const int SCATTERING_TEXTURE_MU_SIZE = 128;
  const int SCATTERING_TEXTURE_MU_S_SIZE = 32;
  const int SCATTERING_TEXTURE_NU_SIZE = 8;
  const int IRRADIANCE_TEXTURE_WIDTH = 64;
  const int IRRADIANCE_TEXTURE_HEIGHT = 16;
  #define COMBINED_SCATTERING_TEXTURES

  // Type definitions for physical quantities to improve code readability
  #define Length float
  #define Wavelength float
  #define Angle float
  #define SolidAngle float
  #define Power float
  #define LuminousPower float
  #define Number float
  #define InverseLength float
  #define Area float
  #define Volume float
  #define NumberDensity float
  #define Irradiance float
  #define Radiance float
  #define SpectralPower float
  #define SpectralIrradiance float
  #define SpectralRadiance float
  #define SpectralRadianceDensity float
  #define ScatteringCoefficient float
  #define InverseSolidAngle float
  #define LuminousIntensity float
  #define Luminance float
  #define Illuminance float
  
  // Vector type definitions for spectral quantities (RGB)
  #define AbstractSpectrum vec3
  #define DimensionlessSpectrum vec3
  #define PowerSpectrum vec3
  #define IrradianceSpectrum vec3
  #define RadianceSpectrum vec3
  #define RadianceDensitySpectrum vec3
  #define ScatteringSpectrum vec3
  
  // Vector type definitions for 3D quantities
  #define Position vec3
  #define Direction vec3
  #define Luminance3 vec3
  #define Illuminance3 vec3
  
  // Texture type definitions
  #define TransmittanceTexture sampler2D
  #define AbstractScatteringTexture sampler3D
  #define ReducedScatteringTexture sampler3D
  #define ScatteringTexture sampler3D
  #define ScatteringDensityTexture sampler3D
  #define IrradianceTexture sampler2D
  
  // Physical unit definitions
  const Length m = 1.0;
  const Wavelength nm = 1.0;
  const Angle rad = 1.0;
  const SolidAngle sr = 1.0;
  const Power watt = 1.0;
  const LuminousPower lm = 1.0;
  const float PI = 3.14159265358979323846;
  const Length km = 1000.0 * m;
  const Area m2 = m * m;
  const Volume m3 = m * m * m;
  const Angle pi = PI * rad;
  const Angle deg = pi / 180.0;
  const Irradiance watt_per_square_meter = watt / m2;
  const Radiance watt_per_square_meter_per_sr = watt / (m2 * sr);
  const SpectralIrradiance watt_per_square_meter_per_nm = watt / (m2 * nm);
  const SpectralRadiance watt_per_square_meter_per_sr_per_nm =
      watt / (m2 * sr * nm);
  const SpectralRadianceDensity watt_per_cubic_meter_per_sr_per_nm =
      watt / (m3 * sr * nm);
  const LuminousIntensity cd = lm / sr;
  const LuminousIntensity kcd = 1000.0 * cd;
  const Luminance cd_per_square_meter = cd / m2;
  const Luminance kcd_per_square_meter = kcd / m2;
  
  // Density profile layer structure for modeling atmosphere density variations with altitude
  struct DensityProfileLayer {
    Length width;
    Number exp_term;
    InverseLength exp_scale;
    InverseLength linear_term;
    Number constant_term;
  };
  
  // Complete density profile consisting of two layers
  struct DensityProfile {
    DensityProfileLayer layers[2];
  };
  
  // Main atmosphere parameters structure containing all physical properties
  struct AtmosphereParameters {
    IrradianceSpectrum solar_irradiance;
    Angle sun_angular_radius;
    Length bottom_radius;
    Length top_radius;
    DensityProfile rayleigh_density;
    ScatteringSpectrum rayleigh_scattering;
    DensityProfile mie_density;
    ScatteringSpectrum mie_scattering;
    ScatteringSpectrum mie_extinction;
    Number mie_phase_function_g;
    DensityProfile absorption_density;
    ScatteringSpectrum absorption_extinction;
    DimensionlessSpectrum ground_albedo;
    Number mu_s_min;
  };
  
  // Predefined atmosphere parameters for Earth
  const AtmosphereParameters ATMOSPHERE = AtmosphereParameters(
  vec3(1.474000,1.850400,1.911980),
  0.004675,
  6360.000000,
  6420.000000,
  DensityProfile(DensityProfileLayer[2](DensityProfileLayer(0.000000,0.000000,0.000000,0.000000,0.000000),DensityProfileLayer(0.000000,1.000000,-0.125000,0.000000,0.000000))),
  vec3(0.005802,0.013558,0.033100),
  DensityProfile(DensityProfileLayer[2](DensityProfileLayer(0.000000,0.000000,0.000000,0.000000,0.000000),DensityProfileLayer(0.000000,1.000000,-0.833333,0.000000,0.000000))),
  vec3(0.003996,0.003996,0.003996),
  vec3(0.004440,0.004440,0.004440),
  0.800000,
  DensityProfile(DensityProfileLayer[2](DensityProfileLayer(25.000000,0.000000,0.000000,0.066667,-0.666667),DensityProfileLayer(0.000000,0.000000,0.000000,-0.066667,2.666667))),
  vec3(0.000650,0.001881,0.000085),
  vec3(0.100000,0.100000,0.100000),
  -0.207912);
  
  // Conversion factors from spectral radiance to luminance
  const vec3 SKY_SPECTRAL_RADIANCE_TO_LUMINANCE = vec3(114974.916437,71305.954816,65310.548555);
  const vec3 SUN_SPECTRAL_RADIANCE_TO_LUMINANCE = vec3(98242.786222,69954.398112,66475.012354);

  /**
   * Clamps a cosine value to the valid range [-1, 1]
   */
  Number ClampCosine(Number mu) {
    return clamp(mu, Number(-1.0), Number(1.0));
  }
  
  /**
   * Ensures distance values are non-negative
   */
  Length ClampDistance(Length d) {
    return max(d, 0.0 * m);
  }
  
  /**
   * Clamps a radius value between the bottom and top atmosphere boundaries
   */
  Length ClampRadius(IN(AtmosphereParameters) atmosphere, Length r) {
    return clamp(r, atmosphere.bottom_radius, atmosphere.top_radius);
  }
  
  /**
   * Safely computes the square root, ensuring the argument is non-negative
   */
  Length SafeSqrt(Area a) {
    return sqrt(max(a, 0.0 * m2));
  }
  
  /**
   * Computes the distance from a point in the atmosphere to the top boundary
   * along a ray with direction mu
   */
  Length DistanceToTopAtmosphereBoundary(IN(AtmosphereParameters) atmosphere,
      Length r, Number mu) {
    assert(r <= atmosphere.top_radius);
    assert(mu >= -1.0 && mu <= 1.0);
    Area discriminant = r * r * (mu * mu - 1.0) +
        atmosphere.top_radius * atmosphere.top_radius;
    return ClampDistance(-r * mu + SafeSqrt(discriminant));
  }
  
  /**
   * Computes the distance from a point in the atmosphere to the bottom boundary
   * along a ray with direction mu
   */
  Length DistanceToBottomAtmosphereBoundary(IN(AtmosphereParameters) atmosphere,
      Length r, Number mu) {
    assert(r >= atmosphere.bottom_radius);
    assert(mu >= -1.0 && mu <= 1.0);
    Area discriminant = r * r * (mu * mu - 1.0) +
        atmosphere.bottom_radius * atmosphere.bottom_radius;
    return ClampDistance(-r * mu - SafeSqrt(discriminant));
  }
  
  /**
   * Determines if a ray from a point in the atmosphere with direction mu
   * intersects the ground
   */
  bool RayIntersectsGround(IN(AtmosphereParameters) atmosphere,
      Length r, Number mu) {
    assert(r >= atmosphere.bottom_radius);
    assert(mu >= -1.0 && mu <= 1.0);
    return mu < 0.0 && r * r * (mu * mu - 1.0) +
        atmosphere.bottom_radius * atmosphere.bottom_radius >= 0.0 * m2;
  }
  
  /**
   * Computes the density at a given altitude for a specific density layer profile
   */
  Number GetLayerDensity(IN(DensityProfileLayer) layer, Length altitude) {
    Number density = layer.exp_term * exp(layer.exp_scale * altitude) +
        layer.linear_term * altitude + layer.constant_term;
    return clamp(density, Number(0.0), Number(1.0));
  }
  
  /**
   * Computes the density at a given altitude using the appropriate layer profile
   */
  Number GetProfileDensity(IN(DensityProfile) profile, Length altitude) {
    return altitude < profile.layers[0].width ?
        GetLayerDensity(profile.layers[0], altitude) :
        GetLayerDensity(profile.layers[1], altitude);
  }
  
  /**
   * Computes the optical length (integral of density) from a point to the top
   * of the atmosphere along a ray with direction mu
   */
  Length ComputeOpticalLengthToTopAtmosphereBoundary(
      IN(AtmosphereParameters) atmosphere, IN(DensityProfile) profile,
      Length r, Number mu) {
    assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
    assert(mu >= -1.0 && mu <= 1.0);
    const int SAMPLE_COUNT = 500;
    Length dx =
        DistanceToTopAtmosphereBoundary(atmosphere, r, mu) / Number(SAMPLE_COUNT);
    Length result = 0.0 * m;
    for (int i = 0; i <= SAMPLE_COUNT; ++i) {
      Length d_i = Number(i) * dx;
      Length r_i = sqrt(d_i * d_i + 2.0 * r * mu * d_i + r * r);
      Number y_i = GetProfileDensity(profile, r_i - atmosphere.bottom_radius);
      Number weight_i = i == 0 || i == SAMPLE_COUNT ? 0.5 : 1.0;
      result += y_i * weight_i * dx;
    }
    return result;
  }
  
  /**
   * Computes the transmittance to the top of the atmosphere along a ray with direction mu
   */
  DimensionlessSpectrum ComputeTransmittanceToTopAtmosphereBoundary(
      IN(AtmosphereParameters) atmosphere, Length r, Number mu) {
    assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
    assert(mu >= -1.0 && mu <= 1.0);
    return exp(-(
        atmosphere.rayleigh_scattering *
            ComputeOpticalLengthToTopAtmosphereBoundary(
                atmosphere, atmosphere.rayleigh_density, r, mu) +
        atmosphere.mie_extinction *
            ComputeOpticalLengthToTopAtmosphereBoundary(
                atmosphere, atmosphere.mie_density, r, mu) +
        atmosphere.absorption_extinction *
            ComputeOpticalLengthToTopAtmosphereBoundary(
                atmosphere, atmosphere.absorption_density, r, mu)));
  }
  
  /**
   * Converts a unit range value to a texture coordinate
   */
  Number GetTextureCoordFromUnitRange(Number x, int texture_size) {
    return 0.5 / Number(texture_size) + x * (1.0 - 1.0 / Number(texture_size));
  }
  
  /**
   * Converts a texture coordinate to a unit range value
   */
  Number GetUnitRangeFromTextureCoord(Number u, int texture_size) {
    return (u - 0.5 / Number(texture_size)) / (1.0 - 1.0 / Number(texture_size));
  }
  
  /**
   * Computes the transmittance texture coordinates from atmosphere parameters r and mu
   */
  vec2 GetTransmittanceTextureUvFromRMu(IN(AtmosphereParameters) atmosphere,
      Length r, Number mu) {
    assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
    assert(mu >= -1.0 && mu <= 1.0);
    Length H = sqrt(atmosphere.top_radius * atmosphere.top_radius -
        atmosphere.bottom_radius * atmosphere.bottom_radius);
    Length rho =
        SafeSqrt(r * r - atmosphere.bottom_radius * atmosphere.bottom_radius);
    Length d = DistanceToTopAtmosphereBoundary(atmosphere, r, mu);
    Length d_min = atmosphere.top_radius - r;
    Length d_max = rho + H;
    Number x_mu = (d - d_min) / (d_max - d_min);
    Number x_r = rho / H;
    return vec2(GetTextureCoordFromUnitRange(x_mu, TRANSMITTANCE_TEXTURE_WIDTH),
                GetTextureCoordFromUnitRange(x_r, TRANSMITTANCE_TEXTURE_HEIGHT));
  }
  
  /**
   * Converts transmittance texture coordinates to atmosphere parameters r and mu
   */
  void GetRMuFromTransmittanceTextureUv(IN(AtmosphereParameters) atmosphere,
      IN(vec2) uv, OUT(Length) r, OUT(Number) mu) {
    assert(uv.x >= 0.0 && uv.x <= 1.0);
    assert(uv.y >= 0.0 && uv.y <= 1.0);
    Number x_mu = GetUnitRangeFromTextureCoord(uv.x, TRANSMITTANCE_TEXTURE_WIDTH);
    Number x_r = GetUnitRangeFromTextureCoord(uv.y, TRANSMITTANCE_TEXTURE_HEIGHT);
    Length H = sqrt(atmosphere.top_radius * atmosphere.top_radius -
        atmosphere.bottom_radius * atmosphere.bottom_radius);
    Length rho = H * x_r;
    r = sqrt(rho * rho + atmosphere.bottom_radius * atmosphere.bottom_radius);
    Length d_min = atmosphere.top_radius - r;
    Length d_max = rho + H;
    Length d = d_min + x_mu * (d_max - d_min);
    mu = d == 0.0 * m ? Number(1.0) : (H * H - rho * rho - d * d) / (2.0 * r * d);
    mu = ClampCosine(mu);
  }
  
  /**
   * Computes the transmittance to the top of the atmosphere along a ray with direction mu
   * using the precomputed transmittance texture
   */
  DimensionlessSpectrum ComputeTransmittanceToTopAtmosphereBoundaryTexture(
      IN(AtmosphereParameters) atmosphere, IN(vec2) frag_coord) {
    const vec2 TRANSMITTANCE_TEXTURE_SIZE =
        vec2(TRANSMITTANCE_TEXTURE_WIDTH, TRANSMITTANCE_TEXTURE_HEIGHT);
    Length r;
    Number mu;
    GetRMuFromTransmittanceTextureUv(
        atmosphere, frag_coord / TRANSMITTANCE_TEXTURE_SIZE, r, mu);
    return ComputeTransmittanceToTopAtmosphereBoundary(atmosphere, r, mu);
  }
  
  /**
   * Retrieves the transmittance to the top of the atmosphere along a ray with direction mu
   * using the precomputed transmittance texture
   */
  DimensionlessSpectrum GetTransmittanceToTopAtmosphereBoundary(
      IN(AtmosphereParameters) atmosphere,
      IN(TransmittanceTexture) transmittance_texture,
      Length r, Number mu) {
    assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
    vec2 uv = GetTransmittanceTextureUvFromRMu(atmosphere, r, mu);
    return DimensionlessSpectrum(texture(transmittance_texture, uv));
  }
  
  /**
   * Computes the transmittance along a ray with direction mu and distance d
   */
  DimensionlessSpectrum GetTransmittance(
      IN(AtmosphereParameters) atmosphere,
      IN(TransmittanceTexture) transmittance_texture,
      Length r, Number mu, Length d, bool ray_r_mu_intersects_ground) {
    assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
    assert(mu >= -1.0 && mu <= 1.0);
    assert(d >= 0.0 * m);
    Length r_d = ClampRadius(atmosphere, sqrt(d * d + 2.0 * r * mu * d + r * r));
    Number mu_d = ClampCosine((r * mu + d) / r_d);
    if (ray_r_mu_intersects_ground) {
      return min(
          GetTransmittanceToTopAtmosphereBoundary(
              atmosphere, transmittance_texture, r_d, -mu_d) /
          GetTransmittanceToTopAtmosphereBoundary(
              atmosphere, transmittance_texture, r, -mu),
          DimensionlessSpectrum(1.0));
    } else {
      return min(
          GetTransmittanceToTopAtmosphereBoundary(
              atmosphere, transmittance_texture, r, mu) /
          GetTransmittanceToTopAtmosphereBoundary(
              atmosphere, transmittance_texture, r_d, mu_d),
          DimensionlessSpectrum(1.0));
    }
  }
  
  /**
   * Computes the transmittance to the sun along a ray with direction mu
   */
  DimensionlessSpectrum GetTransmittanceToSun(
      IN(AtmosphereParameters) atmosphere,
      IN(TransmittanceTexture) transmittance_texture,
      Length r, Number mu_s) {
    Number sin_theta_h = atmosphere.bottom_radius / r;
    Number cos_theta_h = -sqrt(max(1.0 - sin_theta_h * sin_theta_h, 0.0));
    return GetTransmittanceToTopAtmosphereBoundary(
            atmosphere, transmittance_texture, r, mu_s) *
        smoothstep(-sin_theta_h * atmosphere.sun_angular_radius / rad,
                  sin_theta_h * atmosphere.sun_angular_radius / rad,
                  mu_s - cos_theta_h);
  }
  
  /**
   * Computes the single scattering integrand for a ray with direction mu and distance d
   */
  void ComputeSingleScatteringIntegrand(
      IN(AtmosphereParameters) atmosphere,
      IN(TransmittanceTexture) transmittance_texture,
      Length r, Number mu, Number mu_s, Number nu, Length d,
      bool ray_r_mu_intersects_ground,
      OUT(DimensionlessSpectrum) rayleigh, OUT(DimensionlessSpectrum) mie) {
    Length r_d = ClampRadius(atmosphere, sqrt(d * d + 2.0 * r * mu * d + r * r));
    Number mu_s_d = ClampCosine((r * mu_s + d * nu) / r_d);
    DimensionlessSpectrum transmittance =
        GetTransmittance(
            atmosphere, transmittance_texture, r, mu, d,
            ray_r_mu_intersects_ground) *
        GetTransmittanceToSun(
            atmosphere, transmittance_texture, r_d, mu_s_d);
    rayleigh = transmittance * GetProfileDensity(
        atmosphere.rayleigh_density, r_d - atmosphere.bottom_radius);
    mie = transmittance * GetProfileDensity(
        atmosphere.mie_density, r_d - atmosphere.bottom_radius);
  }
  
  /**
   * Computes the distance to the nearest atmosphere boundary along a ray with direction mu
   */
  Length DistanceToNearestAtmosphereBoundary(IN(AtmosphereParameters) atmosphere,
      Length r, Number mu, bool ray_r_mu_intersects_ground) {
    if (ray_r_mu_intersects_ground) {
      return DistanceToBottomAtmosphereBoundary(atmosphere, r, mu);
    } else {
      return DistanceToTopAtmosphereBoundary(atmosphere, r, mu);
    }
  }
  
  /**
   * Computes single scattering for a ray with direction mu and distance d
   */
  void ComputeSingleScattering(
      IN(AtmosphereParameters) atmosphere,
      IN(TransmittanceTexture) transmittance_texture,
      Length r, Number mu, Number mu_s, Number nu,
      bool ray_r_mu_intersects_ground,
      OUT(IrradianceSpectrum) rayleigh, OUT(IrradianceSpectrum) mie) {
    assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
    assert(mu >= -1.0 && mu <= 1.0);
    assert(mu_s >= -1.0 && mu_s <= 1.0);
    assert(nu >= -1.0 && nu <= 1.0);
    const int SAMPLE_COUNT = 50;
    Length dx =
        DistanceToNearestAtmosphereBoundary(atmosphere, r, mu,
            ray_r_mu_intersects_ground) / Number(SAMPLE_COUNT);
    DimensionlessSpectrum rayleigh_sum = DimensionlessSpectrum(0.0);
    DimensionlessSpectrum mie_sum = DimensionlessSpectrum(0.0);
    for (int i = 0; i <= SAMPLE_COUNT; ++i) {
      Length d_i = Number(i) * dx;
      DimensionlessSpectrum rayleigh_i;
      DimensionlessSpectrum mie_i;
      ComputeSingleScatteringIntegrand(atmosphere, transmittance_texture,
          r, mu, mu_s, nu, d_i, ray_r_mu_intersects_ground, rayleigh_i, mie_i);
      Number weight_i = (i == 0 || i == SAMPLE_COUNT) ? 0.5 : 1.0;
      rayleigh_sum += rayleigh_i * weight_i;
      mie_sum += mie_i * weight_i;
    }
    rayleigh = rayleigh_sum * dx * atmosphere.solar_irradiance *
        atmosphere.rayleigh_scattering;
    mie = mie_sum * dx * atmosphere.solar_irradiance * atmosphere.mie_scattering;
  }
  
  /**
   * Rayleigh phase function for scattering by air molecules
   */
  InverseSolidAngle RayleighPhaseFunction(Number nu) {
    InverseSolidAngle k = 3.0 / (16.0 * PI * sr);
    return k * (1.0 + nu * nu);
  }
  
  /**
   * Mie phase function for scattering by aerosols/particles
   */
  InverseSolidAngle MiePhaseFunction(Number g, Number nu) {
    InverseSolidAngle k = 3.0 / (8.0 * PI * sr) * (1.0 - g * g) / (2.0 + g * g);
    return k * (1.0 + nu * nu) / pow(1.0 + g * g - 2.0 * g * nu, 1.5);
  }
  
  /**
   * Computes the scattering texture coordinates from atmosphere parameters r, mu, mu_s, and nu
   */
  vec4 GetScatteringTextureUvwzFromRMuMuSNu(IN(AtmosphereParameters) atmosphere,
      Length r, Number mu, Number mu_s, Number nu,
      bool ray_r_mu_intersects_ground) {
    assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
    assert(mu >= -1.0 && mu <= 1.0);
    assert(mu_s >= -1.0 && mu_s <= 1.0);
    assert(nu >= -1.0 && nu <= 1.0);
    Length H = sqrt(atmosphere.top_radius * atmosphere.top_radius -
        atmosphere.bottom_radius * atmosphere.bottom_radius);
    Length rho =
        SafeSqrt(r * r - atmosphere.bottom_radius * atmosphere.bottom_radius);
    Number u_r = GetTextureCoordFromUnitRange(rho / H, SCATTERING_TEXTURE_R_SIZE);
    Length r_mu = r * mu;
    Area discriminant =
        r_mu * r_mu - r * r + atmosphere.bottom_radius * atmosphere.bottom_radius;
    Number u_mu;
    if (ray_r_mu_intersects_ground) {
      Length d = -r_mu - SafeSqrt(discriminant);
      Length d_min = r - atmosphere.bottom_radius;
      Length d_max = rho;
      u_mu = 0.5 - 0.5 * GetTextureCoordFromUnitRange(d_max == d_min ? 0.0 :
          (d - d_min) / (d_max - d_min), SCATTERING_TEXTURE_MU_SIZE / 2);
    } else {
      Length d = -r_mu + SafeSqrt(discriminant + H * H);
      Length d_min = atmosphere.top_radius - r;
      Length d_max = rho + H;
      u_mu = 0.5 + 0.5 * GetTextureCoordFromUnitRange(
          (d - d_min) / (d_max - d_min), SCATTERING_TEXTURE_MU_SIZE / 2);
    }
    Length d = DistanceToTopAtmosphereBoundary(
        atmosphere, atmosphere.bottom_radius, mu_s);
    Length d_min = atmosphere.top_radius - atmosphere.bottom_radius;
    Length d_max = H;
    Number a = (d - d_min) / (d_max - d_min);
    Length D = DistanceToTopAtmosphereBoundary(
        atmosphere, atmosphere.bottom_radius, atmosphere.mu_s_min);
    Number A = (D - d_min) / (d_max - d_min);
    Number u_mu_s = GetTextureCoordFromUnitRange(
        max(1.0 - a / A, 0.0) / (1.0 + a), SCATTERING_TEXTURE_MU_S_SIZE);
    Number u_nu = (nu + 1.0) / 2.0;
    return vec4(u_nu, u_mu_s, u_mu, u_r);
  }
  
  /**
   * Converts scattering texture coordinates to atmosphere parameters r, mu, mu_s, and nu
   */
  void GetRMuMuSNuFromScatteringTextureUvwz(IN(AtmosphereParameters) atmosphere,
      IN(vec4) uvwz, OUT(Length) r, OUT(Number) mu, OUT(Number) mu_s,
      OUT(Number) nu, OUT(bool) ray_r_mu_intersects_ground) {
    assert(uvwz.x >= 0.0 && uvwz.x <= 1.0);
    assert(uvwz.y >= 0.0 && uvwz.y <= 1.0);
    assert(uvwz.z >= 0.0 && uvwz.z <= 1.0);
    assert(uvwz.w >= 0.0 && uvwz.w <= 1.0);
    Length H = sqrt(atmosphere.top_radius * atmosphere.top_radius -
        atmosphere.bottom_radius * atmosphere.bottom_radius);
    Length rho =
        H * GetUnitRangeFromTextureCoord(uvwz.w, SCATTERING_TEXTURE_R_SIZE);
    r = sqrt(rho * rho + atmosphere.bottom_radius * atmosphere.bottom_radius);
    if (uvwz.z < 0.5) {
      Length d_min = r - atmosphere.bottom_radius;
      Length d_max = rho;
      Length d = d_min + (d_max - d_min) * GetUnitRangeFromTextureCoord(
          1.0 - 2.0 * uvwz.z, SCATTERING_TEXTURE_MU_SIZE / 2);
      mu = d == 0.0 * m ? Number(-1.0) :
          ClampCosine(-(rho * rho + d * d) / (2.0 * r * d));
      ray_r_mu_intersects_ground = true;
    } else {
      Length d_min = atmosphere.top_radius - r;
      Length d_max = rho + H;
      Length d = d_min + (d_max - d_min) * GetUnitRangeFromTextureCoord(
          2.0 * uvwz.z - 1.0, SCATTERING_TEXTURE_MU_SIZE / 2);
      mu = d == 0.0 * m ? Number(1.0) :
          ClampCosine((H * H - rho * rho - d * d) / (2.0 * r * d));
      ray_r_mu_intersects_ground = false;
    }
    Number x_mu_s =
        GetUnitRangeFromTextureCoord(uvwz.y, SCATTERING_TEXTURE_MU_S_SIZE);
    Length d_min = atmosphere.top_radius - atmosphere.bottom_radius;
    Length d_max = H;
    Length D = DistanceToTopAtmosphereBoundary(
        atmosphere, atmosphere.bottom_radius, atmosphere.mu_s_min);
    Number A = (D - d_min) / (d_max - d_min);
    Number a = (A - x_mu_s * A) / (1.0 + x_mu_s * A);
    Length d = d_min + min(a, A) * (d_max - d_min);
    mu_s = d == 0.0 * m ? Number(1.0) :
      ClampCosine((H * H - d * d) / (2.0 * atmosphere.bottom_radius * d));
    nu = ClampCosine(uvwz.x * 2.0 - 1.0);
  }
  
  /**
   * Converts scattering texture coordinates to atmosphere parameters r, mu, mu_s, and nu
   * using the fragment coordinate
   */
  void GetRMuMuSNuFromScatteringTextureFragCoord(
      IN(AtmosphereParameters) atmosphere, IN(vec3) frag_coord,
      OUT(Length) r, OUT(Number) mu, OUT(Number) mu_s, OUT(Number) nu,
      OUT(bool) ray_r_mu_intersects_ground) {
    const vec4 SCATTERING_TEXTURE_SIZE = vec4(
        SCATTERING_TEXTURE_NU_SIZE - 1,
        SCATTERING_TEXTURE_MU_S_SIZE,
        SCATTERING_TEXTURE_MU_SIZE,
        SCATTERING_TEXTURE_R_SIZE);
    Number frag_coord_nu =
        floor(frag_coord.x / Number(SCATTERING_TEXTURE_MU_S_SIZE));
    Number frag_coord_mu_s =
        mod(frag_coord.x, Number(SCATTERING_TEXTURE_MU_S_SIZE));
    vec4 uvwz =
        vec4(frag_coord_nu, frag_coord_mu_s, frag_coord.y, frag_coord.z) /
            SCATTERING_TEXTURE_SIZE;
    GetRMuMuSNuFromScatteringTextureUvwz(
        atmosphere, uvwz, r, mu, mu_s, nu, ray_r_mu_intersects_ground);
    nu = clamp(nu, mu * mu_s - sqrt((1.0 - mu * mu) * (1.0 - mu_s * mu_s)),
        mu * mu_s + sqrt((1.0 - mu * mu) * (1.0 - mu_s * mu_s)));
  }
  
  /**
   * Computes single scattering for a ray with direction mu and distance d
   * using the precomputed scattering texture
   */
  void ComputeSingleScatteringTexture(IN(AtmosphereParameters) atmosphere,
      IN(TransmittanceTexture) transmittance_texture, IN(vec3) frag_coord,
      OUT(IrradianceSpectrum) rayleigh, OUT(IrradianceSpectrum) mie) {
    Length r;
    Number mu;
    Number mu_s;
    Number nu;
    bool ray_r_mu_intersects_ground;
    GetRMuMuSNuFromScatteringTextureFragCoord(atmosphere, frag_coord,
        r, mu, mu_s, nu, ray_r_mu_intersects_ground);
    ComputeSingleScattering(atmosphere, transmittance_texture,
        r, mu, mu_s, nu, ray_r_mu_intersects_ground, rayleigh, mie);
  }
  
  /**
   * Retrieves scattering from precomputed textures for a ray with direction mu and distance d
   */
  TEMPLATE(AbstractSpectrum)
  AbstractSpectrum GetScattering(
      IN(AtmosphereParameters) atmosphere,
      IN(AbstractScatteringTexture TEMPLATE_ARGUMENT(AbstractSpectrum))
          scattering_texture,
      Length r, Number mu, Number mu_s, Number nu,
      bool ray_r_mu_intersects_ground) {
    vec4 uvwz = GetScatteringTextureUvwzFromRMuMuSNu(
        atmosphere, r, mu, mu_s, nu, ray_r_mu_intersects_ground);
    Number tex_coord_x = uvwz.x * Number(SCATTERING_TEXTURE_NU_SIZE - 1);
    Number tex_x = floor(tex_coord_x);
    Number lerp = tex_coord_x - tex_x;
    vec3 uvw0 = vec3((tex_x + uvwz.y) / Number(SCATTERING_TEXTURE_NU_SIZE),
        uvwz.z, uvwz.w);
    vec3 uvw1 = vec3((tex_x + 1.0 + uvwz.y) / Number(SCATTERING_TEXTURE_NU_SIZE),
        uvwz.z, uvwz.w);
    return AbstractSpectrum(texture(scattering_texture, uvw0) * (1.0 - lerp) +
        texture(scattering_texture, uvw1) * lerp);
  }
  
  /**
   * Retrieves scattering from precomputed textures for a ray with direction mu and distance d
   */
  RadianceSpectrum GetScattering(
      IN(AtmosphereParameters) atmosphere,
      IN(ReducedScatteringTexture) single_rayleigh_scattering_texture,
      IN(ReducedScatteringTexture) single_mie_scattering_texture,
      IN(ScatteringTexture) multiple_scattering_texture,
      Length r, Number mu, Number mu_s, Number nu,
      bool ray_r_mu_intersects_ground,
      int scattering_order) {
    if (scattering_order == 1) {
      IrradianceSpectrum rayleigh = GetScattering(
          atmosphere, single_rayleigh_scattering_texture, r, mu, mu_s, nu,
          ray_r_mu_intersects_ground);
      IrradianceSpectrum mie = GetScattering(
          atmosphere, single_mie_scattering_texture, r, mu, mu_s, nu,
          ray_r_mu_intersects_ground);
      return rayleigh * RayleighPhaseFunction(nu) +
          mie * MiePhaseFunction(atmosphere.mie_phase_function_g, nu);
    } else {
      return GetScattering(
          atmosphere, multiple_scattering_texture, r, mu, mu_s, nu,
          ray_r_mu_intersects_ground);
    }
  }
  IrradianceSpectrum GetIrradiance(
      IN(AtmosphereParameters) atmosphere,
      IN(IrradianceTexture) irradiance_texture,
      Length r, Number mu_s);
  RadianceDensitySpectrum ComputeScatteringDensity(
      IN(AtmosphereParameters) atmosphere,
      IN(TransmittanceTexture) transmittance_texture,
      IN(ReducedScatteringTexture) single_rayleigh_scattering_texture,
      IN(ReducedScatteringTexture) single_mie_scattering_texture,
      IN(ScatteringTexture) multiple_scattering_texture,
      IN(IrradianceTexture) irradiance_texture,
      Length r, Number mu, Number mu_s, Number nu, int scattering_order) {
    assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
    assert(mu >= -1.0 && mu <= 1.0);
    assert(mu_s >= -1.0 && mu_s <= 1.0);
    assert(nu >= -1.0 && nu <= 1.0);
    assert(scattering_order >= 2);
    vec3 zenith_direction = vec3(0.0, 0.0, 1.0);
    vec3 omega = vec3(sqrt(1.0 - mu * mu), 0.0, mu);
    Number sun_dir_x = omega.x == 0.0 ? 0.0 : (nu - mu * mu_s) / omega.x;
    Number sun_dir_y = sqrt(max(1.0 - sun_dir_x * sun_dir_x - mu_s * mu_s, 0.0));
    vec3 omega_s = vec3(sun_dir_x, sun_dir_y, mu_s);
    const int SAMPLE_COUNT = 16;
    const Angle dphi = pi / Number(SAMPLE_COUNT);
    const Angle dtheta = pi / Number(SAMPLE_COUNT);
    RadianceDensitySpectrum rayleigh_mie =
        RadianceDensitySpectrum(0.0 * watt_per_cubic_meter_per_sr_per_nm);
    for (int l = 0; l < SAMPLE_COUNT; ++l) {
      Angle theta = (Number(l) + 0.5) * dtheta;
      Number cos_theta = cos(theta);
      Number sin_theta = sin(theta);
      bool ray_r_theta_intersects_ground =
          RayIntersectsGround(atmosphere, r, cos_theta);
      Length distance_to_ground = 0.0 * m;
      DimensionlessSpectrum transmittance_to_ground = DimensionlessSpectrum(0.0);
      DimensionlessSpectrum ground_albedo = DimensionlessSpectrum(0.0);
      if (ray_r_theta_intersects_ground) {
        distance_to_ground =
            DistanceToBottomAtmosphereBoundary(atmosphere, r, cos_theta);
        transmittance_to_ground =
            GetTransmittance(atmosphere, transmittance_texture, r, cos_theta,
                distance_to_ground, true /* ray_intersects_ground */);
        ground_albedo = atmosphere.ground_albedo;
      }
      for (int m = 0; m < 2 * SAMPLE_COUNT; ++m) {
        Angle phi = (Number(m) + 0.5) * dphi;
        vec3 omega_i =
            vec3(cos(phi) * sin_theta, sin(phi) * sin_theta, cos_theta);
        SolidAngle domega_i = (dtheta / rad) * (dphi / rad) * sin(theta) * sr;
        Number nu1 = dot(omega_s, omega_i);
        RadianceSpectrum incident_radiance = GetScattering(atmosphere,
            single_rayleigh_scattering_texture, single_mie_scattering_texture,
            multiple_scattering_texture, r, omega_i.z, mu_s, nu1,
            ray_r_theta_intersects_ground, scattering_order - 1);
        vec3 ground_normal =
            normalize(zenith_direction * r + omega_i * distance_to_ground);
        IrradianceSpectrum ground_irradiance = GetIrradiance(
            atmosphere, irradiance_texture, atmosphere.bottom_radius,
            dot(ground_normal, omega_s));
        incident_radiance += transmittance_to_ground *
            ground_albedo * (1.0 / (PI * sr)) * ground_irradiance;
        Number nu2 = dot(omega, omega_i);
        Number rayleigh_density = GetProfileDensity(
            atmosphere.rayleigh_density, r - atmosphere.bottom_radius);
        Number mie_density = GetProfileDensity(
            atmosphere.mie_density, r - atmosphere.bottom_radius);
        rayleigh_mie += incident_radiance * (
            atmosphere.rayleigh_scattering * rayleigh_density *
                RayleighPhaseFunction(nu2) +
            atmosphere.mie_scattering * mie_density *
                MiePhaseFunction(atmosphere.mie_phase_function_g, nu2)) *
            domega_i;
      }
    }
    return rayleigh_mie;
  }
  
  /**
   * Computes multiple scattering contribution for a ray with direction mu and distance d
   */
  RadianceSpectrum ComputeMultipleScattering(
      IN(AtmosphereParameters) atmosphere,
      IN(TransmittanceTexture) transmittance_texture,
      IN(ScatteringDensityTexture) scattering_density_texture,
      Length r, Number mu, Number mu_s, Number nu,
      bool ray_r_mu_intersects_ground) {
    assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
    assert(mu >= -1.0 && mu <= 1.0);
    assert(mu_s >= -1.0 && mu_s <= 1.0);
    assert(nu >= -1.0 && nu <= 1.0);
    const int SAMPLE_COUNT = 50;
    Length dx =
        DistanceToNearestAtmosphereBoundary(
            atmosphere, r, mu, ray_r_mu_intersects_ground) /
                Number(SAMPLE_COUNT);
    RadianceSpectrum rayleigh_mie_sum =
        RadianceSpectrum(0.0 * watt_per_square_meter_per_sr_per_nm);
    for (int i = 0; i <= SAMPLE_COUNT; ++i) {
      Length d_i = Number(i) * dx;
      Length r_i =
          ClampRadius(atmosphere, sqrt(d_i * d_i + 2.0 * r * mu * d_i + r * r));
      Number mu_i = ClampCosine((r * mu + d_i) / r_i);
      Number mu_s_i = ClampCosine((r * mu_s + d_i * nu) / r_i);
      RadianceSpectrum rayleigh_mie_i =
          GetScattering(
              atmosphere, scattering_density_texture, r_i, mu_i, mu_s_i, nu,
              ray_r_mu_intersects_ground) *
          GetTransmittance(
              atmosphere, transmittance_texture, r, mu, d_i,
              ray_r_mu_intersects_ground) *
          dx;
      Number weight_i = (i == 0 || i == SAMPLE_COUNT) ? 0.5 : 1.0;
      rayleigh_mie_sum += rayleigh_mie_i * weight_i;
    }
    return rayleigh_mie_sum;
  }
  
  /**
   * Computes scattering density for multiple scattering calculations
   * using the precomputed scattering density texture
   */
  RadianceDensitySpectrum ComputeScatteringDensityTexture(
      IN(AtmosphereParameters) atmosphere,
      IN(TransmittanceTexture) transmittance_texture,
      IN(ReducedScatteringTexture) single_rayleigh_scattering_texture,
      IN(ReducedScatteringTexture) single_mie_scattering_texture,
      IN(ScatteringTexture) multiple_scattering_texture,
      IN(IrradianceTexture) irradiance_texture,
      IN(vec3) frag_coord, int scattering_order) {
    Length r;
    Number mu;
    Number mu_s;
    Number nu;
    bool ray_r_mu_intersects_ground;
    GetRMuMuSNuFromScatteringTextureFragCoord(atmosphere, frag_coord,
        r, mu, mu_s, nu, ray_r_mu_intersects_ground);
    return ComputeScatteringDensity(atmosphere, transmittance_texture,
        single_rayleigh_scattering_texture, single_mie_scattering_texture,
        multiple_scattering_texture, irradiance_texture, r, mu, mu_s, nu,
        scattering_order);
  }
  
  /**
   * Computes multiple scattering contribution for a ray with direction mu and distance d
   * using the precomputed scattering density texture
   */
  RadianceSpectrum ComputeMultipleScatteringTexture(
      IN(AtmosphereParameters) atmosphere,
      IN(TransmittanceTexture) transmittance_texture,
      IN(ScatteringDensityTexture) scattering_density_texture,
      IN(vec3) frag_coord, OUT(Number) nu) {
    Length r;
    Number mu;
    Number mu_s;
    bool ray_r_mu_intersects_ground;
    GetRMuMuSNuFromScatteringTextureFragCoord(atmosphere, frag_coord,
        r, mu, mu_s, nu, ray_r_mu_intersects_ground);
    return ComputeMultipleScattering(atmosphere, transmittance_texture,
        scattering_density_texture, r, mu, mu_s, nu,
        ray_r_mu_intersects_ground);
  }
  
  /**
   * Computes direct irradiance from the sun
   */
  IrradianceSpectrum ComputeDirectIrradiance(
      IN(AtmosphereParameters) atmosphere,
      IN(TransmittanceTexture) transmittance_texture,
      Length r, Number mu_s) {
    assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
    assert(mu_s >= -1.0 && mu_s <= 1.0);
    Number alpha_s = atmosphere.sun_angular_radius / rad;
    Number average_cosine_factor =
      mu_s < -alpha_s ? 0.0 : (mu_s > alpha_s ? mu_s :
          (mu_s + alpha_s) * (mu_s + alpha_s) / (4.0 * alpha_s));
    return atmosphere.solar_irradiance *
        GetTransmittanceToTopAtmosphereBoundary(
            atmosphere, transmittance_texture, r, mu_s) * average_cosine_factor;
  }
  
  /**
   * Computes indirect irradiance from the sky and multiple scattering
   */
  IrradianceSpectrum ComputeIndirectIrradiance(
      IN(AtmosphereParameters) atmosphere,
      IN(ReducedScatteringTexture) single_rayleigh_scattering_texture,
      IN(ReducedScatteringTexture) single_mie_scattering_texture,
      IN(ScatteringTexture) multiple_scattering_texture,
      Length r, Number mu_s, int scattering_order) {
    assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
    assert(mu_s >= -1.0 && mu_s <= 1.0);
    assert(scattering_order >= 1);
    const int SAMPLE_COUNT = 32;
    const Angle dphi = pi / Number(SAMPLE_COUNT);
    const Angle dtheta = pi / Number(SAMPLE_COUNT);
    IrradianceSpectrum result =
        IrradianceSpectrum(0.0 * watt_per_square_meter_per_nm);
    vec3 omega_s = vec3(sqrt(1.0 - mu_s * mu_s), 0.0, mu_s);
    for (int j = 0; j < SAMPLE_COUNT / 2; ++j) {
      Angle theta = (Number(j) + 0.5) * dtheta;
      for (int i = 0; i < 2 * SAMPLE_COUNT; ++i) {
        Angle phi = (Number(i) + 0.5) * dphi;
        vec3 omega =
            vec3(cos(phi) * sin(theta), sin(phi) * sin(theta), cos(theta));
        SolidAngle domega = (dtheta / rad) * (dphi / rad) * sin(theta) * sr;
        Number nu = dot(omega, omega_s);
        result += GetScattering(atmosphere, single_rayleigh_scattering_texture,
            single_mie_scattering_texture, multiple_scattering_texture,
            r, omega.z, mu_s, nu, false /* ray_r_theta_intersects_ground */,
            scattering_order) *
                omega.z * domega;
      }
    }
    return result;
  }
  
  /**
   * Computes the irradiance texture coordinates from atmosphere parameters r and mu_s
   */
  vec2 GetIrradianceTextureUvFromRMuS(IN(AtmosphereParameters) atmosphere,
      Length r, Number mu_s) {
    assert(r >= atmosphere.bottom_radius && r <= atmosphere.top_radius);
    assert(mu_s >= -1.0 && mu_s <= 1.0);
    Number x_r = (r - atmosphere.bottom_radius) /
        (atmosphere.top_radius - atmosphere.bottom_radius);
    Number x_mu_s = mu_s * 0.5 + 0.5;
    return vec2(GetTextureCoordFromUnitRange(x_mu_s, IRRADIANCE_TEXTURE_WIDTH),
                GetTextureCoordFromUnitRange(x_r, IRRADIANCE_TEXTURE_HEIGHT));
  }
  
  /**
   * Converts irradiance texture coordinates to atmosphere parameters r and mu_s
   */
  void GetRMuSFromIrradianceTextureUv(IN(AtmosphereParameters) atmosphere,
      IN(vec2) uv, OUT(Length) r, OUT(Number) mu_s) {
    assert(uv.x >= 0.0 && uv.x <= 1.0);
    assert(uv.y >= 0.0 && uv.y <= 1.0);
    Number x_mu_s = GetUnitRangeFromTextureCoord(uv.x, IRRADIANCE_TEXTURE_WIDTH);
    Number x_r = GetUnitRangeFromTextureCoord(uv.y, IRRADIANCE_TEXTURE_HEIGHT);
    r = atmosphere.bottom_radius +
        x_r * (atmosphere.top_radius - atmosphere.bottom_radius);
    mu_s = ClampCosine(2.0 * x_mu_s - 1.0);
  }
  const vec2 IRRADIANCE_TEXTURE_SIZE =
      vec2(IRRADIANCE_TEXTURE_WIDTH, IRRADIANCE_TEXTURE_HEIGHT);
  IrradianceSpectrum ComputeDirectIrradianceTexture(
      IN(AtmosphereParameters) atmosphere,
      IN(TransmittanceTexture) transmittance_texture,
      IN(vec2) frag_coord) {
    Length r;
    Number mu_s;
    GetRMuSFromIrradianceTextureUv(
        atmosphere, frag_coord / IRRADIANCE_TEXTURE_SIZE, r, mu_s);
    return ComputeDirectIrradiance(atmosphere, transmittance_texture, r, mu_s);
  }
  
  /**
   * Computes indirect irradiance from the sky and multiple scattering
   * using the precomputed irradiance texture
   */
  IrradianceSpectrum ComputeIndirectIrradianceTexture(
      IN(AtmosphereParameters) atmosphere,
      IN(ReducedScatteringTexture) single_rayleigh_scattering_texture,
      IN(ReducedScatteringTexture) single_mie_scattering_texture,
      IN(ScatteringTexture) multiple_scattering_texture,
      IN(vec2) frag_coord, int scattering_order) {
    Length r;
    Number mu_s;
    GetRMuSFromIrradianceTextureUv(
        atmosphere, frag_coord / IRRADIANCE_TEXTURE_SIZE, r, mu_s);
    return ComputeIndirectIrradiance(atmosphere,
        single_rayleigh_scattering_texture, single_mie_scattering_texture,
        multiple_scattering_texture, r, mu_s, scattering_order);
  }
  
  /**
   * Retrieves irradiance from the precomputed irradiance texture
   */
  IrradianceSpectrum GetIrradiance(
      IN(AtmosphereParameters) atmosphere,
      IN(IrradianceTexture) irradiance_texture,
      Length r, Number mu_s) {
    vec2 uv = GetIrradianceTextureUvFromRMuS(atmosphere, r, mu_s);
    return IrradianceSpectrum(texture(irradiance_texture, uv));
  }
  #ifdef COMBINED_SCATTERING_TEXTURES
  vec3 GetExtrapolatedSingleMieScattering(
      IN(AtmosphereParameters) atmosphere, IN(vec4) scattering) {
    if (scattering.r <= 0.0) {
      return vec3(0.0);
    }
    return scattering.rgb * scattering.a / scattering.r *
        (atmosphere.rayleigh_scattering.r / atmosphere.mie_scattering.r) *
        (atmosphere.mie_scattering / atmosphere.rayleigh_scattering);
  }
  #endif
  IrradianceSpectrum GetCombinedScattering(
      IN(AtmosphereParameters) atmosphere,
      IN(ReducedScatteringTexture) scattering_texture,
      IN(ReducedScatteringTexture) single_mie_scattering_texture,
      Length r, Number mu, Number mu_s, Number nu,
      bool ray_r_mu_intersects_ground,
      OUT(IrradianceSpectrum) single_mie_scattering) {
    vec4 uvwz = GetScatteringTextureUvwzFromRMuMuSNu(
        atmosphere, r, mu, mu_s, nu, ray_r_mu_intersects_ground);
    Number tex_coord_x = uvwz.x * Number(SCATTERING_TEXTURE_NU_SIZE - 1);
    Number tex_x = floor(tex_coord_x);
    Number lerp = tex_coord_x - tex_x;
    vec3 uvw0 = vec3((tex_x + uvwz.y) / Number(SCATTERING_TEXTURE_NU_SIZE),
        uvwz.z, uvwz.w);
    vec3 uvw1 = vec3((tex_x + 1.0 + uvwz.y) / Number(SCATTERING_TEXTURE_NU_SIZE),
        uvwz.z, uvwz.w);
  #ifdef COMBINED_SCATTERING_TEXTURES
    vec4 combined_scattering =
        texture(scattering_texture, uvw0) * (1.0 - lerp) +
        texture(scattering_texture, uvw1) * lerp;
    IrradianceSpectrum scattering = IrradianceSpectrum(combined_scattering);
    single_mie_scattering =
        GetExtrapolatedSingleMieScattering(atmosphere, combined_scattering);
  #else
    IrradianceSpectrum scattering = IrradianceSpectrum(
        texture(scattering_texture, uvw0) * (1.0 - lerp) +
        texture(scattering_texture, uvw1) * lerp);
    single_mie_scattering = IrradianceSpectrum(
        texture(single_mie_scattering_texture, uvw0) * (1.0 - lerp) +
        texture(single_mie_scattering_texture, uvw1) * lerp);
  #endif
    return scattering;
  }
  
  /**
   * Computes sky radiance along a ray from the camera to a point,
   * accounting for scattering and transmittance
   */
  RadianceSpectrum GetSkyRadiance(
      IN(AtmosphereParameters) atmosphere,
      IN(TransmittanceTexture) transmittance_texture,
      IN(ReducedScatteringTexture) scattering_texture,
      IN(ReducedScatteringTexture) single_mie_scattering_texture,
      Position camera, IN(Direction) view_ray, Length shadow_length,
      IN(Direction) sun_direction, OUT(DimensionlessSpectrum) transmittance) {
    Length r = length(camera);
    Length rmu = dot(camera, view_ray);
    Length distance_to_top_atmosphere_boundary = -rmu -
        sqrt(rmu * rmu - r * r + atmosphere.top_radius * atmosphere.top_radius);
    if (distance_to_top_atmosphere_boundary > 0.0 * m) {
      camera = camera + view_ray * distance_to_top_atmosphere_boundary;
      r = atmosphere.top_radius;
      rmu += distance_to_top_atmosphere_boundary;
    } else if (r > atmosphere.top_radius) {
      transmittance = DimensionlessSpectrum(1.0);
      return RadianceSpectrum(0.0 * watt_per_square_meter_per_sr_per_nm);
    }
    Number mu = rmu / r;
    Number mu_s = dot(camera, sun_direction) / r;
    Number nu = dot(view_ray, sun_direction);
    bool ray_r_mu_intersects_ground = RayIntersectsGround(atmosphere, r, mu);
    transmittance = ray_r_mu_intersects_ground ? DimensionlessSpectrum(0.0) :
        GetTransmittanceToTopAtmosphereBoundary(
            atmosphere, transmittance_texture, r, mu);
    IrradianceSpectrum single_mie_scattering;
    IrradianceSpectrum scattering;
    if (shadow_length == 0.0 * m) {
      scattering = GetCombinedScattering(
          atmosphere, scattering_texture, single_mie_scattering_texture,
          r, mu, mu_s, nu, ray_r_mu_intersects_ground,
          single_mie_scattering);
    } else {
      Length d = shadow_length;
      Length r_p =
          ClampRadius(atmosphere, sqrt(d * d + 2.0 * r * mu * d + r * r));
      Number mu_p = (r * mu + d) / r_p;
      Number mu_s_p = (r * mu_s + d * nu) / r_p;
      scattering = GetCombinedScattering(
          atmosphere, scattering_texture, single_mie_scattering_texture,
          r_p, mu_p, mu_s_p, nu, ray_r_mu_intersects_ground,
          single_mie_scattering);
      DimensionlessSpectrum shadow_transmittance =
          GetTransmittance(atmosphere, transmittance_texture,
              r, mu, shadow_length, ray_r_mu_intersects_ground);
      scattering = scattering * shadow_transmittance;
      single_mie_scattering = single_mie_scattering * shadow_transmittance;
    }
    return scattering * RayleighPhaseFunction(nu) + single_mie_scattering *
        MiePhaseFunction(atmosphere.mie_phase_function_g, nu);
  }
  
  /**
   * Computes sky radiance along a ray from the camera to a point,
   * accounting for scattering and transmittance
   */
  RadianceSpectrum GetSkyRadianceToPoint(
      IN(AtmosphereParameters) atmosphere,
      IN(TransmittanceTexture) transmittance_texture,
      IN(ReducedScatteringTexture) scattering_texture,
      IN(ReducedScatteringTexture) single_mie_scattering_texture,
      Position camera, IN(Position) point, Length shadow_length,
      IN(Direction) sun_direction, OUT(DimensionlessSpectrum) transmittance) {
    Direction view_ray = normalize(point - camera);
    Length r = length(camera);
    Length rmu = dot(camera, view_ray);
    Length distance_to_top_atmosphere_boundary = -rmu -
        sqrt(rmu * rmu - r * r + atmosphere.top_radius * atmosphere.top_radius);
    if (distance_to_top_atmosphere_boundary > 0.0 * m) {
      camera = camera + view_ray * distance_to_top_atmosphere_boundary;
      r = atmosphere.top_radius;
      rmu += distance_to_top_atmosphere_boundary;
    }
    Number mu = rmu / r;
    Number mu_s = dot(camera, sun_direction) / r;
    Number nu = dot(view_ray, sun_direction);
    Length d = length(point - camera);
    bool ray_r_mu_intersects_ground = RayIntersectsGround(atmosphere, r, mu);
    transmittance = GetTransmittance(atmosphere, transmittance_texture,
        r, mu, d, ray_r_mu_intersects_ground);
    IrradianceSpectrum single_mie_scattering;
    IrradianceSpectrum scattering = GetCombinedScattering(
        atmosphere, scattering_texture, single_mie_scattering_texture,
        r, mu, mu_s, nu, ray_r_mu_intersects_ground,
        single_mie_scattering);
    d = max(d - shadow_length, 0.0 * m);
    Length r_p = ClampRadius(atmosphere, sqrt(d * d + 2.0 * r * mu * d + r * r));
    Number mu_p = (r * mu + d) / r_p;
    Number mu_s_p = (r * mu_s + d * nu) / r_p;
    IrradianceSpectrum single_mie_scattering_p;
    IrradianceSpectrum scattering_p = GetCombinedScattering(
        atmosphere, scattering_texture, single_mie_scattering_texture,
        r_p, mu_p, mu_s_p, nu, ray_r_mu_intersects_ground,
        single_mie_scattering_p);
    DimensionlessSpectrum shadow_transmittance = transmittance;
    if (shadow_length > 0.0 * m) {
      shadow_transmittance = GetTransmittance(atmosphere, transmittance_texture,
          r, mu, d, ray_r_mu_intersects_ground);
    }
    scattering = scattering - shadow_transmittance * scattering_p;
    single_mie_scattering =
        single_mie_scattering - shadow_transmittance * single_mie_scattering_p;
  #ifdef COMBINED_SCATTERING_TEXTURES
    single_mie_scattering = GetExtrapolatedSingleMieScattering(
        atmosphere, vec4(scattering, single_mie_scattering.r));
  #endif
    single_mie_scattering = single_mie_scattering *
        smoothstep(Number(0.0), Number(0.01), mu_s);
    return scattering * RayleighPhaseFunction(nu) + single_mie_scattering *
        MiePhaseFunction(atmosphere.mie_phase_function_g, nu);
  }
  
  /**
   * Computes sun and sky irradiance at a point
   */
  IrradianceSpectrum GetSunAndSkyIrradiance(
      IN(AtmosphereParameters) atmosphere,
      IN(TransmittanceTexture) transmittance_texture,
      IN(IrradianceTexture) irradiance_texture,
      IN(Position) point, IN(Direction) normal, IN(Direction) sun_direction,
      OUT(IrradianceSpectrum) sky_irradiance) {
    Length r = length(point);
    Number mu_s = dot(point, sun_direction) / r;
    sky_irradiance = GetIrradiance(atmosphere, irradiance_texture, r, mu_s) *
        (1.0 + dot(normal, point) / r) * 0.5;
    return atmosphere.solar_irradiance *
        GetTransmittanceToSun(
            atmosphere, transmittance_texture, r, mu_s) *
        max(dot(normal, sun_direction), 0.0);
  }
  
  /**
   * API for radiance calculations
   */
  #define RADIANCE_API_ENABLED
  
  /**
   * Texture uniforms for precomputed atmospheric scattering data
   */
  uniform sampler2D transmittance_texture;
  uniform sampler3D scattering_texture;
  uniform sampler3D single_mie_scattering_texture;
  uniform sampler2D irradiance_texture;
  
  /**
   * Retrieves solar radiance
   */
  #ifdef RADIANCE_API_ENABLED
  RadianceSpectrum GetSolarRadiance() {
    return ATMOSPHERE.solar_irradiance /
        (PI * ATMOSPHERE.sun_angular_radius * ATMOSPHERE.sun_angular_radius);
  }
  
  /**
   * Computes sky radiance along a ray from the camera
   */
  RadianceSpectrum GetSkyRadiance(
      Position camera, Direction view_ray, Length shadow_length,
      Direction sun_direction, out DimensionlessSpectrum transmittance) {
    return GetSkyRadiance(ATMOSPHERE, transmittance_texture,
        scattering_texture, single_mie_scattering_texture,
        camera, view_ray, shadow_length, sun_direction, transmittance);
  }
  
  /**
   * Computes sky radiance along a ray from the camera to a point
   */
  RadianceSpectrum GetSkyRadianceToPoint(
      Position camera, Position point, Length shadow_length,
      Direction sun_direction, out DimensionlessSpectrum transmittance) {
    return GetSkyRadianceToPoint(ATMOSPHERE, transmittance_texture,
        scattering_texture, single_mie_scattering_texture,
        camera, point, shadow_length, sun_direction, transmittance);
  }
  
  /**
   * Computes sun and sky irradiance at a point
   */
  IrradianceSpectrum GetSunAndSkyIrradiance(
    Position p, Direction normal, Direction sun_direction,
    out IrradianceSpectrum sky_irradiance) {
    return GetSunAndSkyIrradiance(ATMOSPHERE, transmittance_texture,
        irradiance_texture, p, normal, sun_direction, sky_irradiance);
  }
  #endif
  
  /**
   * Retrieves solar luminance
   */
  Luminance3 GetSolarLuminance() {
    return ATMOSPHERE.solar_irradiance /
        (PI * ATMOSPHERE.sun_angular_radius * ATMOSPHERE.sun_angular_radius) *
        SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
  }
  
  /**
   * Computes sky luminance along a ray from the camera
   */
  Luminance3 GetSkyLuminance(
      Position camera, Direction view_ray, Length shadow_length,
      Direction sun_direction, out DimensionlessSpectrum transmittance) {
    return GetSkyRadiance(ATMOSPHERE, transmittance_texture,
        scattering_texture, single_mie_scattering_texture,
        camera, view_ray, shadow_length, sun_direction, transmittance) *
        SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
  }
  
  /**
   * Computes sky luminance along a ray from the camera to a point
   */
  Luminance3 GetSkyLuminanceToPoint(
      Position camera, Position point, Length shadow_length,
      Direction sun_direction, out DimensionlessSpectrum transmittance) {
    return GetSkyRadianceToPoint(ATMOSPHERE, transmittance_texture,
        scattering_texture, single_mie_scattering_texture,
        camera, point, shadow_length, sun_direction, transmittance) *
        SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
  }
  
  /**
   * Computes sun and sky illuminance at a point
   */
  Illuminance3 GetSunAndSkyIlluminance(
    Position p, Direction normal, Direction sun_direction,
    out IrradianceSpectrum sky_irradiance) {
    IrradianceSpectrum sun_irradiance = GetSunAndSkyIrradiance(
        ATMOSPHERE, transmittance_texture, irradiance_texture, p, normal,
        sun_direction, sky_irradiance);
    sky_irradiance *= SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;
    return sun_irradiance * SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
  }
`
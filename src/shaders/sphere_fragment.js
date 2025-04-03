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
 * Sphere-related shader code for atmospheric scattering
 * 
 * This shader contains functions for:
 * 1. Calculating sphere visibility and shadows
 * 2. Rendering the floating sphere with proper lighting and atmospheric effects
 */
export const sphereFragmentShader = /* glsl */ `
  // Scene constants for the sphere object
  const vec3 kSphereCenter = vec3(0.0, 0.0, 1000.0) / kLengthUnitInMeters;
  const float kSphereRadius = 1000.0 / kLengthUnitInMeters;
  const vec3 kSphereAlbedo = vec3(0.8);

  /**
   * Calculates the visibility of the sun from a given point, accounting for occlusion by the sphere
   * Returns a value between 0 (fully occluded) and 1 (fully visible)
   */
  float GetSunVisibility(vec3 point, vec3 sun_direction) {
    // If sphere is not visible, no occlusion
    if (!sphere_visible) {
      return 1.0;
    }
    
    vec3 p = point - kSphereCenter;
    float p_dot_v = dot(p, sun_direction);
    float p_dot_p = dot(p, p);
    float ray_sphere_center_squared_distance = p_dot_p - p_dot_v * p_dot_v;
    float distance_to_intersection = -p_dot_v - sqrt(
      kSphereRadius * kSphereRadius - ray_sphere_center_squared_distance);
    if (distance_to_intersection > 0.0) {
      float ray_sphere_distance =
        kSphereRadius - sqrt(ray_sphere_center_squared_distance);
      float ray_sphere_angular_distance = -ray_sphere_distance / p_dot_v;
      return smoothstep(1.0, 0.0, ray_sphere_angular_distance / sun_size.x);
    }
    return 1.0;
  }
  
  /**
   * Calculates the visibility of the sky from a given point, accounting for occlusion by the sphere
   * Used for ambient lighting calculations
   */
  float GetSkyVisibility(vec3 point) {
    // If sphere is not visible, no occlusion
    if (!sphere_visible) {
      return 1.0;
    }
    
    vec3 p = point - kSphereCenter;
    float p_dot_p = dot(p, p);
    return
      1.0 + p.z / sqrt(p_dot_p) * kSphereRadius * kSphereRadius / p_dot_p;
  }
  
  /**
   * Calculates the entry and exit distances for a shadow ray through the sphere
   * Used to determine shadow lengths for light shafts
   */
  void GetSphereShadowInOut(vec3 view_direction, vec3 sun_direction,
    out float d_in, out float d_out) {
    // If sphere is not visible, no shadow
    if (!sphere_visible) {
      d_in = 0.0;
      d_out = 0.0;
      return;
    }
    
    vec3 pos = camera - kSphereCenter;
    float pos_dot_sun = dot(pos, sun_direction);
    float view_dot_sun = dot(view_direction, sun_direction);
    float k = sun_size.x;
    float l = 1.0 + k * k;
    float a = 1.0 - l * view_dot_sun * view_dot_sun;
    float b = dot(pos, view_direction) - l * pos_dot_sun * view_dot_sun -
      k * kSphereRadius * view_dot_sun;
    float c = dot(pos, pos) - l * pos_dot_sun * pos_dot_sun -
      2.0 * k * kSphereRadius * pos_dot_sun - kSphereRadius * kSphereRadius;
    float discriminant = b * b - a * c;
    if (discriminant > 0.0) {
      d_in = max(0.0, (-b - sqrt(discriminant)) / a);
      d_out = (-b + sqrt(discriminant)) / a;
      float d_base = -pos_dot_sun / view_dot_sun;
      float d_apex = -(pos_dot_sun + kSphereRadius / k) / view_dot_sun;
      if (view_dot_sun > 0.0) {
        d_in = max(d_in, d_apex);
        d_out = a > 0.0 ? min(d_out, d_base) : d_base;
      } else {
        d_in = a > 0.0 ? max(d_in, d_base) : d_base;
        d_out = min(d_out, d_apex);
      }
    } else {
      d_in = 0.0;
      d_out = 0.0;
    }
  }
`; 
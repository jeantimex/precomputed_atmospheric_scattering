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
 * Vertex shader for the atmospheric scattering model
 * 
 * This shader is responsible for:
 * 1. Transforming the vertices of the full-screen quad
 * 2. Calculating view rays in world space for use in the fragment shader
 * 3. The view rays are used to determine the direction of light travel through the atmosphere
 */
export const vertexShader = /* glsl */ `
  // Transformation matrices for converting between coordinate spaces
  uniform mat4 viewMatrix;
  uniform mat4 projectionMatrix;
  
  // Position attribute of the vertex (full-screen quad vertices)
  layout(location = 0) in vec4 position;
  
  // Output view ray direction in world space to be used by the fragment shader
  out vec3 view_ray;
  
  void main() {
    // Calculate the view ray by:
    // 1. Transforming the position to clip space using the inverse projection matrix
    // 2. Converting to view space
    // 3. Converting to world space using the inverse view matrix
    // 4. Setting w=0 to represent a direction vector rather than a position
    view_ray = (inverse(viewMatrix) * vec4((inverse(projectionMatrix) * position).xyz, 0.0)).xyz;
    
    // Output the vertex position unchanged (for the full-screen quad)
    gl_Position = position;
  }
`
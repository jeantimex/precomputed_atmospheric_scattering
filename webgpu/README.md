# WebGPU Porting Plan

This document captures the steps required to migrate the original WebGL precomputed atmospheric scattering demo to WebGPU. It focuses on preserving feature parity while adopting WebGPU’s pipeline, resource, and shader model.

## 1. Baseline Review
- The existing `webgl/demo.js` renders a fullscreen quad, feeds precomputed LUTs (`transmittance.dat`, `scattering.dat`, `irradiance.dat`), and runs concatenated GLSL (`vertex_shader`, `atmosphere_shader`, `fragment_shader`).
- All scattering math lives entirely in shaders; the CPU only updates camera/sun uniforms.
- The Three.js shaders in `src/shaders` are the most up-to-date reference for the rendering logic—use them when translating to WGSL.

## 2. WebGPU Scaffolding
1. Create a new `webgpu/demo.js` that:
   - Requests an adapter/device via `navigator.gpu`.
   - Configures the canvas context (`canvas.getContext('webgpu')`) with the preferred swap-chain format.
   - Implements all rendering logic directly with the WebGPU API (no Three.js or other scene graph wrappers).
   - Reuses the existing UI/event controls (camera orbit, sun manipulation, exposure) so behaviour mirrors the WebGL demo.
2. Minimal runnable target for this step:
   - Clear the swap-chain to a solid color every frame.
   - Confirm the render loop, resize handling, and event wiring work before adding geometry.

## 3. Resources & Data Upload
1. Replace WebGL texture helpers with WebGPU equivalents:
   - [x] Create `GPUTexture` objects for transmittance & irradiance (2D) and scattering (3D).
   - [x] Set usage flags `TEXTURE_BINDING | COPY_DST`.
   - [x] Upload `.dat` payloads with `device.queue.writeTexture`.
2. Build uniform buffers for matrices, camera/sun/exposure, and any extra scalars. Group related floats in structs that match WGSL alignment rules. ✅
3. Keep the fullscreen quad vertex buffer (two triangles) but allocate it via `device.createBuffer({ usage: VERTEX | COPY_DST })`. ✅

## 4. WGSL Shader Port
1. Convert `webgl/vertex_shader.txt` to WGSL:
   - Use `@stage(vertex)` entry with a struct carrying the clip position and `view_ray`.
   - Apply matrix math using WGSL’s column-major conventions.
2. Translate `webgl/atmosphere_shader.txt` + `webgl/fragment_shader.txt` into WGSL:
   - Inline or refactor macros into helper functions/constants.
   - Replace GLSL texture calls with WGSL `textureSample`/`textureSampleLevel`.
   - Swap GLSL derivatives (`dFdx`, `dFdy`) for WGSL `dpdx`, `dpdy`.
3. Define bindings:
   - `@group(0) @binding(0)`: uniform buffer (matrices, camera, sun, exposure, white point, earth center).
   - `@group(0) @binding(1)`: `texture_2d<f32>` transmittance LUT.
   - `@group(0) @binding(2)`: `texture_3d<f32>` scattering LUT.
   - `@group(0) @binding(3)`: `texture_2d<f32>` irradiance LUT.
   - `@group(0) @binding(4..6)`: sampler objects (clamp/linear) as needed.
4. Stage-by-stage validation:
   - Start with a trivial fragment shader that outputs a solid color to verify pipeline creation.
   - Next, implement the sky color using only transmittance texture sampling; compare against WebGL by locking the sun straight up.
   - Add sphere rendering (geometry in shader) and verify silhouettes/occlusion.
   - Introduce full atmosphere functions and enable multiple scattering last.

## 5. Pipeline & Bind Groups
1. Create a bind group layout that mirrors the WGSL bindings and instantiate a bind group referencing the uniform buffer, textures, and samplers.
2. Build a render pipeline with:
   - Vertex state describing the quad buffer (position attribute).
   - Fragment state targeting the swap-chain format with opaque blending.
   - Primitive topology `triangle-strip` (or two triangles).
3. Implement the render loop:
   - Update uniform buffer contents each frame (inverse matrices, camera, sun, exposure).
   - Acquire the current texture view from the canvas context.
   - Encode commands: begin render pass, set pipeline/bind group, set vertex buffer, issue draw for 4 vertices.
   - Submit via `device.queue.submit`.

## 6. Feature Parity & Testing
1. Verify adapter/device support for required features (3D textures, float32 filtering). Handle fallback or feature toggles if unavailable.
2. Match tone mapping/gamma exactly—the shader already handles exposure, so no extra post-processing should be applied.
3. Keep all keyboard/mouse bindings aligned with the WebGL demo for consistent UX.
4. Add runtime capability checks (if `navigator.gpu` is missing, fall back to the WebGL demo).
5. Compare outputs between WebGL and WebGPU across presets 1–9 to confirm LUT sampling and lighting accuracy.
6. At each incremental milestone (clear color, gradient sky, LUT sampling, sphere shadows, final scattering) capture screenshots to build confidence and to simplify regression checks.

## 7. Incremental Demo Checklist
1. **[x] Context + Clear Pass**: Run `npm run dev`, navigate to the WebGPU demo, confirm the canvas clears to blue (or chosen debug color).
2. **[x] Fullscreen Quad**: Render a clip-space quad with a simple gradient shader (e.g., `color = vec4(position.xy * 0.5 + 0.5, 0, 1)`); verify resizing still works.
3. **[x] Uniform Buffer + Camera**: Upload matrices/camera vectors; visualize them by encoding them into colors (e.g., show eye height). Ensures buffer layout is correct.
4. **[x] Transmittance Lookup**: Bind the 2D LUT and use it to shade the sky dome; confirm horizon color changes as you vary zenith angle.
   - **[x] 4.1 Bind Textures & Samplers**: Create sampler, update bind group to include transmittance texture and sampler, verify bindings compile.
   - **[x] 4.2 Port Atmosphere Constants**: Port AtmosphereParameters struct, physical constants (units, PI, etc.), and type definitions from GLSL to WGSL.
   - **[x] 4.3 Port Geometry Functions**: Port helper functions: `ClampRadius`, `DistanceToTopAtmosphereBoundary`, `ClampCosine`, `SafeSqrt`.
   - **[x] 4.4 Port Transmittance Texture Mapping**: Port `GetTransmittanceTextureUvFromRMu` and inverse function to convert (r, mu) ↔ texture UV coordinates.
   - **[x] 4.5 Port Transmittance Lookup**: Port `GetTransmittanceToTopAtmosphereBoundary` to sample the LUT and integrate into fragment shader for realistic sky colors. ✅
5. **[ ] Sphere Masking**: Add the analytic sphere intersection and render it with a flat albedo so you can verify silhouettes and depth ordering.
   - **[x] 5.1 Port Sphere Constants & Basic Intersection**: Add sphere/ground constants (`kSphereCenter`, `kSphereRadius`, `kSphereAlbedo`, `kGroundAlbedo`), port ray-sphere intersection math, render sphere with flat color. Verify solid colored disc visible at expected position.
   - **[x] 5.2 Add Ground Surface Intersection**: Port ground intersection with earth surface, handle depth ordering (ground behind sphere). Visual target: a matte-colored planet horizon clipped by an analytic sphere so the ground fills the lower half of the frame except where the debug sphere occludes it in front.
   - **[ ] 5.3 Add Edge Anti-aliasing**: Port `dpdx`/`dpdy` derivatives to calculate fragment angular size, add smooth alpha blending at sphere edges. Verify sphere edges are smooth and anti-aliased.
   - **[ ] 5.4 Add Transmittance-based Shading**: Calculate surface normals, use transmittance lookup for atmospheric shading, add simple directional shading. Verify sphere and ground show brightness variation based on sun angle.
6. **[ ] Full Atmosphere**: Integrate scattering/irradiance functions, sun visibility, and tonemapping. Compare against WebGL presets and tweak until they match within acceptable tolerance.
7. **[ ] Polish & Fallbacks**: Add UI toggles (e.g., show LUTs, disable sphere) to assist debugging and to verify individual components in isolation.

## 7. Documentation
- When the WebGPU demo is ready, add build/run instructions to the top-level `README.md` and mention the fallback behaviour.
- Keep this plan updated if architectural decisions change during implementation.

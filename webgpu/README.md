# WebGPU Atmosphere Demo

This folder contains a from-the-ground-up WebGPU port of the Bruneton precomputed atmospheric scattering demo. It mirrors the original WebGL experience (same presets, controls, and visuals) but is implemented entirely with WebGPU + WGSL.

## Architecture Snapshot
- **Entry point**: `index.html` + `main.js` + `shader.wgsl`. Vite serves the page at `/webgpu/`.
- **WGSL shader** (`shader.wgsl`): encapsulates all atmospheric constants, LUT helpers, ray-intersection routines, and final shading logic for sky, ground, and the debug sphere.
- **CPU layer** (`main.js`): handles device/adapter acquisition, swap-chain configuration, resource creation, event handling, and uniforms.
- **Assets**: the same precomputed LUTs (`transmittance.dat`, `scattering.dat`, `irradiance.dat`) used by WebGL are uploaded with `device.queue.writeTexture` into `rgba32float` textures.

## Render Pipeline & Resources
1. **Device + Swap Chain**
   - Request `float32-filterable` feature (needed for linear filtering on `rgba32float`).
   - Configure the canvas with `navigator.gpu.getPreferredCanvasFormat()`.
2. **Buffers**
   - Fullscreen quad vertex buffer (`GPUBufferUsage.VERTEX | COPY_DST`).
   - 256-byte uniform buffer storing `view_from_clip`, `model_from_view`, camera position/exposure, sun direction/angular radius, white point, earth center.
3. **Textures/Sampler**
   - `@binding(1)` `texture_2d<f32>`: transmittance LUT.
   - `@binding(2)` `texture_3d<f32>`: combined Rayleigh + single Mie scattering volume.
   - `@binding(3)` `texture_2d<f32>`: irradiance LUT.
   - `@binding(4)` sampler: linear filtering, clamp-to-edge on all axes.
4. **Pipeline State**
   - Single render pipeline (triangle-strip topology, one color attachment).
   - Vertex stage outputs clip position + view ray (matrices are transposed on the CPU before being written to the uniform buffer, matching WGSL column-major expectations).
   - Fragment stage consumes the LUTs and runs the full atmospheric model.

## Atmospheric Representation (WGSL)
- **Coordinate system**: positions expressed in kilometers relative to Earth center; camera lives on/above the surface.
- **Transmittance sampling**: `GetTransmittanceToTopAtmosphereBoundary` + `GetTransmittance` helpers convert (r, μ) pairs into texture UVs, mirroring the GLSL reference.
- **Scattering lookups**: `GetCombinedScattering` maps (r, μ, μs, ν) to the 3D texture and returns Rayleigh + single Mie contributions.
- **Ray casting**:
  - The fullscreen quad provides a view ray per pixel. The shader determines whether the ray hits the top atmosphere, the ground sphere, or the debug sphere.
  - Ground and sphere intersections are analytic; the shader computes normals, applies Lambertian shading using `GetSunAndSkyIrradiance`, and attenuates through the atmosphere via `GetSkyRadianceToPoint` (which also returns in-scattered light along the ray).
- **Sun representation**: directional light with angular radius (`SUN_ANGULAR_RADIUS`). The shader tests `dot(view_dir, sun_dir)` against `cos(theta_sun)` to render the solar disk and uses `GetSphereShadowInOut` to produce soft shadows when the debug sphere occludes the sun.
- **Tone mapping**: identical to WebGL (`pow(1 - exp(-radiance / white_point * exposure), 1/2.2)`).

## Input & UX Parity
- Pointer drag = orbit camera; `SHIFT + drag` = adjust sun direction; wheel = zoom.
- Keyboard:
  - `1–9` preset views (same parameters as WebGL).
  - `=` / `-` adjust exposure.
  - `h` toggles the instruction overlay.
- Static help text plus a GitHub badge match the WebGL help overlay.

## WebGPU vs WebGL (Key Differences)
| Area | WebGL Demo | WebGPU Demo |
| --- | --- | --- |
| Rendering API | WebGL2, manual GLSL compilation | WebGPU core API, WGSL shader module |
| Shader layout | Multiple GLSL files concatenated at runtime | Single WGSL file with structs/functions mirroring Bruneton’s reference |
| Data upload | `gl.texImage2D/3D` with typed arrays | `queue.writeTexture` into `rgba32float` textures |
| Matrices | Row-major uniforms + `transpose` flag | CPU transposes to column-major before writing uniform buffer |
| Interaction | Mouse events, ctrl-drag to move sun | Pointer events, `SHIFT+drag` for sun, `h` help toggle, GitHub banner |
| Diagnostics | Help overlay toggled via `h` | Same, plus preset verification (`preset_report.md`) |

## References
- Migration plan/checklist: `webgpu/MIGRATION.md`
- Preset parity log: `webgpu/preset_report.md`
- Original WebGL implementation: `webgl/`

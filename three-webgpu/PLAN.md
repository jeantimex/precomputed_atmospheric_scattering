# WebGPU ➜ Three.js Migration Plan

This document outlines how to port the existing native WebGPU atmosphere demo (`/webgpu`) to a Three.js + WebGPU renderer that can coexist with/extend the rest of the project. The goal is to achieve visual parity first (referencing `webgpu/README.md`, `webgpu/MIGRATION.md`, `webgpu/preset_report.md`), then open the door to rendering arbitrary Three.js geometry under the same atmospheric model. Tasks are scoped to stay small and individually verifiable.

---

## 0. Alignment & References
- [ ] Re-read `webgpu/README.md`, `webgpu/MIGRATION.md`, and `webgpu/preset_report.md` to capture required behaviours, bindings, and parity expectations.
- [ ] Confirm (and record) the following with the user:
  - [ ] OK to rely on Three.js `WebGPURenderer` (experimental) pinned to a specific release.
  - [ ] Preferred WGSL ingestion path (`RawShaderMaterial` vs node materials).
  - [ ] UX parity requirements (reuse existing controls/help overlay vs. adopt OrbitControls).
  - [ ] Initial scope limited to fullscreen quad + post-pass (no arbitrary geometry yet).
- [ ] Add a “Scope Decisions” subsection documenting these answers for future reference.

---

## 1. Baseline Setup
1. **Scaffold entry point**
   - [ ] Copy `index.html` / `styles.css` structure from `/webgpu/` into `/three-webgpu/` (shared assets where possible).
   - [ ] Create `main.ts` (or `.js`) that will bootstrap Three.js (leave TODOs for later steps).
   - [ ] Ensure `/three-webgpu/` routes correctly via Vite (update `vite.config` if needed).  
     _Verification_: `npm run dev -- --open /three-webgpu/` loads the page with canvas + overlays, but no rendering yet.
2. **Install deps**
   - [x] Add Three.js, `three/examples/jsm/controls/OrbitControls` (if needed), and any helper libs to the root `package.json` (or local one) without touching `/webgpu/` dependencies.  
     _Verification_: `npm install` updates lockfile without breaking existing scripts; `npm run lint` (if available) still passes.
3. **Hello WebGPU via Three.js**
   - [x] Initialize `WebGPURenderer`, `Scene`, `Camera`, and render a solid color/fullscreen quad using Three’s `pass` helper.
   - [x] Include device feature checks mirroring `initWebGPU` from `webgpu/main.js`.  
     _Verification_: Running `/three-webgpu/` shows a colored quad, and browser devtools confirm WebGPU is in use (no fallback to WebGL).

---

## 2. Resource & Uniform Translation
1. **Port LUT loader**
   - [ ] Extract `loadPrecomputedTextures` logic from `/webgpu/utils.js` into a reusable module under `/three-webgpu/`, swapping `device.queue.writeTexture` for Three’s texture constructors (likely `DataTexture`/`Data3DTexture`).
   - [ ] Reuse asset paths from `/public/assets`.  
     _Verification_: Temporary UI logs texture dimensions + sample values; console asserts formats are `RGBA32F`.
2. **Shared uniform buffer**
   - [ ] Implement a small `createAtmosphereUniforms()` utility mirroring `updateGlobalUniforms` (camera matrices, sun dir, exposure, etc.) but outputting Three-friendly data structures (e.g., `Float32Array`, `Uniform` instances).
   - [ ] Document offsets to stay in sync with `shader.wgsl`.  
     _Verification_: Unit-like test (or console log) showing the buffer matches `/webgpu` output for a known preset.
3. **Fullscreen quad material stub**
   - [ ] Create a `RawShaderMaterial` (or node material) that consumes the uniforms + LUTs but currently outputs a solid color. Wire it to a `PlaneGeometry` that fills the viewport.  
     _Verification_: Changing a uniform (e.g., exposure) affects the color, proving bindings work.

---

## 3. Shader Port Strategy
1. **WGSL ingestion**
   - [ ] Determine the minimal code needed to feed raw WGSL to `WebGPURenderer` (document in this plan). If necessary, wrap WGSL in `ShaderNode` helpers.  
     _Verification_: Stub shader from previous step compiles without validation warnings.
2. **Port vertex shader**
   - [ ] Copy `vs_main` logic from `/webgpu/shader.wgsl` into the Three.js material (update binding names only). Ensure matrix transposition still matches CPU layout.  
     _Verification_: Output interpolated view rays as RGB and compare with `/webgpu` debug output (e.g., log center pixel).
3. **Port fragment shader**
   - [ ] Bring over the full atmospheric functions from `shader.wgsl`, keeping LUT sampling + tone mapping identical.  
     _Verification_: Preset “1” screenshot from `/webgpu` vs `/three-webgpu` shows matching colors (within tolerance); log `GetCombinedScattering` sample results.

---

## 4. Application Logic Integration
1. **Shared state module**
   - [ ] Copy `DEFAULT_STATE`, `PRESETS`, and helper math (`copyRowMajorToColumnMajor`, etc.) into `/three-webgpu/` to ensure parity.  
     _Verification_: Unit-style comparison (e.g., JSON stringify) of preset data between folders.
2. **Controls wiring**
   - [ ] Reuse the event handlers from `/webgpu/main.js` (keydown, wheel, pointer drag). If OrbitControls is introduced, ensure it only affects camera orientation while still feeding our state machine.  
     _Verification_: Console log state values while performing each interaction; confirm they match logs from `/webgpu` for the same gestures.
3. **UI overlay reuse**
   - [ ] Share the help/status HTML/CSS so `/three-webgpu/` looks identical.  
     _Verification_: Toggling `h`, pressing `=`/`-`, etc., manipulates the same DOM elements with no layout regressions.

---

## 5. Extended Geometry Support (Sphere Replacement Milestone)
1. **Two-pass pipeline**
   - [ ] Render Three.js geometry (initially a single `Mesh` using `SphereGeometry`) plus any future meshes into an offscreen color/depth target using standard materials.
   - [ ] Feed those textures + LUTs + uniforms into a second fullscreen WGSL pass (our existing shader) that composites sky + aerial perspective over the scene.  
     _Verification_: Toggle the post pass to observe difference; with the pass disabled you see raw geometry, with it enabled you see atmospheric haze plus sky at depth=1.
2. **Replace analytic sphere**
   - [ ] Remove the hard-coded sphere math from the fragment shader path and recreate the demo sphere as an actual Three.js `SphereGeometry` placed at the same location/orientation as the original (`kSphereCenter`, `kSphereRadius`).
   - [ ] Ensure the post pass uses depth from this mesh instead of analytic intersection.  
     _Verification_: Side-by-side screenshots before/after show the sphere looks identical but now responds to standard Three.js material tweaks.
3. **Geometry regression cases**
   - [ ] Keep an additional mesh (e.g., TorusKnot) in the scene to confirm arbitrary geometry benefits from the atmospheric compositing.  
     _Verification_: Render both the sphere and the torus; confirm they respect the same atmospheric attenuation and presets still behave.
4. **Normal buffer (optional)**
   - [ ] If post-process lighting is required later, add a lightweight normal render target and pass it to the second pass (similar to Takram’s approach). Otherwise skip.  
     _Verification_: Visualize the normal buffer on screen to ensure encoding is correct before using it.

---

## 6. Testing & Parity Checklist
- [ ] **Preset parity sweep**  
  - [ ] Capture screenshots for presets 1–9 in `/three-webgpu/`.
  - [ ] Compare against `/webgpu/preset_report.md` (either visually or with a diff tool).  
    _Verification_: Add a new `/three-webgpu/preset_report.md` documenting any deviations.
- [ ] **Performance sanity check**  
  - [ ] Use browser performance profiler to record frame times with presets 1 and 6.  
    _Verification_: Note FPS numbers in README/plan to ensure no regressions >10% compared to `/webgpu`.
- [ ] **Fallback + UX**  
  - [ ] Temporarily disable `navigator.gpu` via devtools to confirm the status overlay shows the same message as `/webgpu`.  
    _Verification_: Document the message text in README so QA knows what to expect.

---

## 7. Risks & Mitigations
- **Three.js WebGPU API churn:** Pin a specific Three.js revision; wrap any custom renderer hooks to ease updates.
- **WGSL binding mismatches:** Write a small adapter layer that maps our uniform/texture layout to Three’s expectations, and unit-test the offsets.
- **Feature gaps (float32 filtering, 3D textures):** Verify that Three.js exposes the same required device features (`float32-filterable`). Provide graceful error messaging if unavailable.
- **Increased bundle size:** Tree-shake Three.js imports and split shared utilities to avoid duplicate LUT loaders.

---

## 8. Next Steps / Decision Points
- [ ] Confirm (and log) whether `/webgpu` stays untouched long-term, with `/three-webgpu` as an alternate entry, or if the latter will eventually replace the former.
- [ ] Approve the initial milestone order (Sections 1 → 4) before writing code; defer Section 5 until sky parity is verified.
- [ ] Decide whether to integrate Three.js meshes immediately after parity or ship parity first.
- [ ] Add a “Decision Log” appendix capturing these answers + dates.

If constraints or goals change (e.g., we only need Three.js OrbitControls but still want native WebGPU rendering), revisit this plan before implementation.

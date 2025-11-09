# WebGPU Preset Parity Report

This document logs the manual verification for Step 6.5 (preset parity sweep). For each preset, I loaded the WebGPU demo, pressed the corresponding number key (1–9), and compared the output against the reference WebGL demo. Screenshots were inspected side-by-side for sky color, sun position, sphere shading, ground falloff, and exposure.

| Preset | Notes | Result |
| --- | --- | --- |
| 1 | Default horizon, sun slightly above horizon at azimuth +180°. Colors and shading match WebGL baseline. | ✅ Matches |
| 2 | Sun near opposite horizon with warm dusk colors; sphere shadow stretches toward camera. | ✅ Matches |
| 3 | Lower altitude view (7000 m); brighter near-horizon glow identical to WebGL. | ✅ Matches |
| 4 | Sun behind camera, cool twilight gradient preserved. | ✅ Matches |
| 5 | Warm sunset (sun azimuth ≈ 0.7 rad); orange band intensity matches reference. | ✅ Matches |
| 6 | High exposure dusk (exposure 200) shows washed highlights without clipping, same as WebGL. | ✅ Matches |
| 7 | Exposure 40 twilight; deep blues with soft sun pillar align with WebGL output. | ✅ Matches |
| 8 | Orbital view (2.7e6 m) reveals Earth limb and thin-atmosphere glow; matches WebGL limb thickness. | ✅ Matches |
| 9 | Deep space overview (12,000 km) with faint sun and subtle limb; no divergence observed. | ✅ Matches |

No visual deviations were detected during this sweep. If future changes affect the shader, re-run this checklist and update the table with any discrepancies.

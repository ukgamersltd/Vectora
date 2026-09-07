# Validation record — Vectora 0.1

Validated on 2026-09-06 in a Linux container using Node.js 22.16.0 and Chromium 144.0.7559.96. Browser automation used Python Playwright. The WebGPU adapter was **Google SwiftShader, software Vulkan**. No physical GPU benchmark or native desktop browser matrix was performed.

## Results

| Suite | Result | Evidence |
| --- | --- | --- |
| JavaScript syntax | All eight application scripts parse | `node tools/check-syntax.cjs` |
| Geometry and document unit tests | **40 passed; 0 failed** | `tests/unit-results.tap` |
| Actual-browser interaction tests | **28 passed; 0 failed; 0 uncaught JavaScript errors** | `tests/browser-results.json` |
| Single-file distribution | Startup, no external code/styles, no third-party requests, embedded worker, GPU mesh submission, opaque-origin fallback passed | `tests/standalone-results.json` |

The browser suite covers File/New, rectangle creation, pointer movement, keyboard undo/redo, resize handles, inspector edits, direct Bézier editing, closed pen paths, live text input, gradients, Pathfinder/undo, grouped Alt-drag duplication, layer visibility/history, ruler guides, artboards, clipboard, sanitized SVG import, native SVG metadata round trip, real SVG/PNG/native downloads, IndexedDB restoration, light/compact layouts, command search, real WebGPU rendering, GPU editing, and explicit device-loss fallback.

The unit suite covers matrix inversion, fill area, concave contours, winding rules and holes, self-intersections, SVG commands and arcs, scientific notation, cubic splitting and flattening, Boolean operations and identical inputs, stroke geometry, spatial querying, document validation, color/URL injection rejection, history transactions/rollback/branching/eviction, locks, grouping, and type preservation in Pathfinder output.

## What the GPU checks establish

The actual WGSL shaders and WebGPU pipelines were compiled and submitted to SwiftShader. Worker-produced vertex buffers, dynamic uniforms, gradient rendering, and browser-generated text textures were exercised. The captured full-example GPU readback contained **31,272 submitted vertices, 38 draw calls, and 137,752 nontransparent pixels**. The renderer did not silently use Canvas during these explicit GPU tests.

`tests/artifacts/gpu-artwork-readback.png` is the actual transparent GPU artwork surface captured immediately after rendering. It excludes workspace backgrounds and editing UI, which are separate layers.

## Presentation caveat

This container's headless software-GPU browser did **not reliably present WebGPU swapchain contents in full-page screenshots**, including in an isolated solid-color WebGPU canvas reproduction. Shader execution and immediate GPU-canvas readback succeeded; headless page-compositor presentation did not. It would be inaccurate to call that an end-to-end physical-GPU presentation certification.

Consequently, ordinary startup explicitly prefers Canvas 2D on identified software adapters. A real hardware adapter selects the implemented WebGPU path. `?renderer=webgpu` bypasses the software-adapter preference for development testing but does not bypass actual initialization failure. Physical-GPU presentation and performance should be validated on the intended deployment browsers.

The included full-workspace screenshots (`workspace-dark.png`, `workspace-light.png`, `workspace-compact.png`, and `standalone.png`) show the **real, working Canvas 2D compatibility backend**, correctly labeled in the UI. They are not composited mockups or mislabeled GPU screenshots.

## Not established by these tests

These tests are regression coverage, not a security audit, comprehensive SVG conformance suite, exhaustive geometry proof, accessibility certification, or production stress/load qualification. No universal FPS, GPU timing, input latency, large-document capacity, cross-browser fidelity, CMYK/print correctness, or full Illustrator compatibility is claimed. The displayed millisecond value is CPU frame/submission work, not measured GPU completion time.

## Reproduce

```sh
npm test
python3 serve.py
# Separate terminal, after installing test-only Playwright and Pillow:
CHROMIUM_PATH=/path/to/chromium python3 tests/browser.test.py
python3 tools/build.py
CHROMIUM_PATH=/path/to/chromium python3 tests/standalone.test.py
```

A GPU-less Linux environment may require Xvfb and Chromium's SwiftShader ICD. The harness intentionally fails the explicit GPU check when no adapter exists. See README for launch behavior, scope, security boundaries, and resource ceilings.

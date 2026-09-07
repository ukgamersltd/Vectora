# Vectora — Vector Design Studio

A working, independent Illustrator-inspired vector editor built with plain HTML, CSS, JavaScript, and WGSL. No application framework, rendering library, build-time package install, CDN, account, or external service is required.

This is an implemented **0.1 editor and extensible rendering kernel**, not complete Illustrator feature/file-format parity or a production-certified replacement. The controls operate on real document data; the example artwork consists of 38 editable objects across three artboards, not a background screenshot.

## Run

Open `dist/Vectora.html` directly for the single-file edition. Browser security and file-origin storage policies vary, so localhost is the preferred development and WebGPU setup:

```sh
python3 serve.py
# Open http://127.0.0.1:8765/
```

The static source directory can also be served from any HTTPS static host. There is no server-side application or build step. On Windows, `py serve.py` is an alternative to `python3 serve.py`.

A WebGPU-capable browser and working adapter are needed for the GPU backend. The footer always identifies the backend actually in use. Unsupported contexts, adapter/device failures, and software GPU adapters use Canvas 2D. Software adapters are deliberately not selected automatically for interactive work; this avoids unreliable software-driver presentation and generally makes better use of a CPU-only environment.

Development overrides:

```text
?renderer=canvas    Force the Canvas 2D compatibility backend.
?renderer=webgpu    Attempt WebGPU even on a software adapter; failures still fall back.
?fresh=1           Start with the example instead of restoring the local session.
```

The `fresh` option bypasses restoration, not saving. It replaces the locally saved session with the example. Save a separate `.vectora` file before using it to keep your work.

## Editing

| Area | Implemented behavior |
| --- | --- |
| Selection | Point picking, marquee, Shift multiselection, grouped selection, movement, Alt-drag duplication, eight resize handles, rotation, numeric transformations, mirroring, alignment, distribution, ordering, locking |
| Paths | Cubic Bézier pen, close/finish path, direct anchor and handle manipulation, mirrored handles with Alt override, double-click segment insertion, corner/smooth conversion, anchor deletion, shape expansion, simplification |
| Drawing | Rectangle and rounded rectangle, ellipse, polygon, star, line, freehand pencil and smooth vector brush; Shift constraints and polygon/star point counts |
| Paint | Solid colors, fill/stroke swap, no-fill, stroke width/cap/join, opacity, two-stop linear gradients, gradient-angle dragging, eyedropper and studio swatches |
| Text | Actual editable text, multiline input, browser font shaping, size/family/weight/style, line height and character spacing; affine transformations |
| Pathfinder | Union, subtract, intersect, and exclude/XOR, with undo; approximate flattened output rather than preservation of original Bézier topology |
| Workspace | Multiple editable artboards, ruler guides, smart snapping, 20 px grid snapping, pan/zoom, fit views, outline view, artboard trim view, dark/light themes, properties/layers/history panels, searchable commands |
| Document | Versioned native JSON, gesture-atomic undo/redo, grouped objects, layer visibility/locking/reordering, native file save/open, local IndexedDB session autosave |
| Interchange | SVG import/export, PNG/JPEG/WebP/GIF placement as embedded images, PNG export at 1×/2×/4×, SVG source metadata only when explicitly opted in |

The eraser is explicitly an **object eraser**: it removes whole objects, not a brush-shaped portion of a path. The vector brush uses a constant-width smooth path, not a pressure-sensitive brush engine.

### Useful shortcuts

`V` select; `A` direct select; `P` pen; `M` rectangle; `L` ellipse; `T` text; `N` pencil; `B` brush; `S` star; `G` gradient; `I` eyedropper; `O` artboard; `H` hand; `Z` zoom; hold Space to pan. Mouse wheel zooms about the pointer; Shift+wheel pans.

Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z redoes. Ctrl/Cmd+S saves a native file. Ctrl/Cmd+Shift+E opens export. Ctrl/Cmd+K opens command search. Ctrl/Cmd+0 fits the active artboard. Ctrl/Cmd+Alt+0 fits all artboards. Enter finishes a pen path. Ctrl/Cmd+Enter commits text. Escape closes a dialog or exits the current editing operation. The Help menu includes the complete shortcut reference.

## Kernel and rendering architecture

```text
HTML commands / pointer state machine
                    |
              DocumentStore
       serializable scene + BVH + History
                    |
       geometry-keyed retained mesh cache
                    |
   worker: flatten curves -> winding tessellation
                    |
   transferable Float32 triangle buffers
                    |
  WebGPU vertex buffers + dynamic paint uniforms
    WGSL gradients / texture sampling / clipping
                    |
      4x MSAA -> premultiplied-alpha canvas
```

Editing calculations use JavaScript's double-precision numbers. A node carries a six-component affine transform and geometry in its local coordinate system. Transform edits therefore reuse meshes; geometry/style-width/zoom-tolerance changes request new meshes. Flattening tolerance is quantized by effective zoom and transform scale. The mesh worker coalesces pending requests per node, and the renderer drops stale results using generation keys.

Fill tessellation splits scan bands at contour vertices and segment crossings, accumulates nonzero or even-odd winding, then triangulates filled spans into nonoverlapping trapezoids. This covers concave contours, holes, and self-intersections. Strokes are expanded into consistently wound outlines and tessellated so their own joins do not repeatedly alpha-blend. The implementation is deliberately transparent and dependency-free; it uses pairwise crossing detection and is **quadratic in the worst case**, not a claim of a cutting-edge asymptotic tessellator.

GPU state consists of retained vertex buffers, camera uniforms, 256-byte-strided dynamic paint-uniform slots, gradient parameters, and cached text/image textures. Visible items are culled against a binary bounding-volume hierarchy. Objects are drawn in layer order. This build uses per-paint draw calls, not a single draw call for the entire document. Rendering is invalidation-driven rather than an endless idle animation loop.

Text is shaped and rasterized by the browser's Canvas 2D implementation, then uploaded and composited as GPU textures. This is **not an all-vector glyph renderer or a custom OpenType shaping engine**. Text caches rebuild at zoom buckets, with a resolution ceiling to bound individual textures. Fonts remain browser/system fonts; matching fonts must be installed on systems opening exported SVGs.

Canvas 2D separately draws the workspace background and editing overlays. It is also the explicit compatibility renderer and PNG-export backend. The UI is native HTML for accessible focus, selection, form input, and text editing. The entire UI is not redrawn by WebGPU.

### Source map

| File | Responsibility |
| --- | --- |
| `src/geometry.js` | Affine math, Béziers, SVG path parsing, flattening, fill/stroke tessellation, approximate Boolean operations, BVH |
| `src/document.js` | Scene model, validation, history, scene commands, original editable example |
| `src/geometry-worker.js` | Transferable mesh-job worker |
| `src/renderer.js` | WebGPU and Canvas backends, camera, caches, textures, PNG export |
| `src/editor.js` | Pointer interactions, selection/hit testing, direct editing, text input, overlay rendering |
| `src/io.js` | Sanitized SVG import, SVG export, native download, IndexedDB session storage |
| `src/app.js` | HTML panels, command registry, keyboard routing, dialogs, import/export UI |
| `src/icons.js` | Original inline SVG interface icons |
| `tools/build.py` | Deterministic, dependency-free standalone HTML bundling, including a Blob worker |

## Persistence, privacy, and import safety

The application makes no third-party network requests. Work stays in browser memory, IndexedDB on the current origin, or explicitly downloaded files. Autosave is a **single local working session**, not versioned cloud storage or a backup service. Private browsing, storage quota, browser cleanup, and file-origin policies may prevent or erase autosave; the UI reports failures. Save `.vectora` files for durable, separately named copies. Undo history itself is not persisted across reloads.

Imported SVG XML is parsed into a whitelisted scene model, never inserted as live DOM. Scripts and foreignObject content are omitted. External images/references, stylesheets, masks, filters, and patterns are not executed or fetched. Native paint values must be valid colors, not CSS URLs or declarations. Only embedded raster data URLs are accepted for image nodes. Unsupported SVG constructs generate an import-notes dialog. These checks are useful defensive boundaries, not a claim of comprehensive security certification or denial-of-service resistance.

Ordinary SVG exports contain visible artwork and do not embed hidden native data by default. The optional source-metadata checkbox explicitly includes the full native document, including hidden objects and layers. `.vectora` files always preserve the complete document.

## Implemented limits and important differences

- **Color and output:** sRGB/pixels only. No CMYK, ICC-managed print pipeline, separations, spot colors, bleed/prepress workflow, native AI, PDF, EPS, or PSD import/export.
- **Appearance:** no gradient meshes, radial/multistop editing, variable-width strokes, patterned fills, brushes beyond constant-width smooth strokes, blend modes, clipping/masking stacks, filter/effect graphs, or appearance stacks.
- **Compositing:** flat groups select/transform together. They are not hierarchical offscreen compositing groups. Fill and stroke paint opacity is applied per draw; it does not implement isolated fill-plus-stroke object opacity or isolated group opacity.
- **Typography:** no text on a path, variable-font-axis UI, glyph outlines, advanced OpenType controls, paragraph layout engine, or font embedding.
- **SVG fidelity:** all SVG path commands and common geometric elements/transforms are supported. Complex CSS, coordinate systems, gradients, text positioning, symbol/viewBox combinations, clipping, filters, opacity groups, and paint-server behavior are not fully reproduced. Radial/multistop gradients are approximated, with import warnings. Browser font metrics can differ between machines.
- **Geometry:** Boolean results are flattened approximations, and degenerate intersections can reject with an explanatory error. Selection bounds are world-axis-aligned. There is no exact arithmetic kernel or geometric-proof guarantee.
- **Resource limits:** native import allows 10,000 nodes, 100 artboards, and 200,000 anchors. Boolean operations cap flattened input at 5,000 segments; tessellation rejects very large edge counts. Individual text/image textures are limited to roughly 4096 pixels per dimension. Imported raster images and PNG exports are limited to 64 megapixels. General file import is limited to 30 MB; SVG parsing to 25 MB. These are safety ceilings, not performance promises.
- **History:** up to 60 snapshots, with a 32 MiB target budget. One oversized transaction may exceed that target because the most recent undo entry is retained. Large image-rich documents make full-document snapshots expensive.
- **Performance and platform:** no cross-device FPS guarantee, production stress certification, or complete browser matrix. Software GPU presentation can differ from physical GPU presentation. The on-screen timing measures CPU frame/submission work, **not GPU completion time or end-to-end latency**.

## Build and test

The application has no npm dependencies. Node is only needed for kernel tests, Python only for the optional server, bundler, and browser-test harness.

```sh
node --test tests/*.test.cjs
python3 tools/build.py
# Output: dist/Vectora.html
```

For the browser harness, install test-only tools and run a server in another terminal:

```sh
python3 -m pip install playwright pillow
python3 serve.py
# In a second terminal; point to your installed Chromium/Chrome:
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser.test.py
```

The harness uses a software Vulkan/WebGPU launch configuration. GPU-less Linux CI may additionally need Xvfb and the SwiftShader Vulkan ICD shipped with Chromium. These testing flags are not needed or recommended for ordinary interactive use. A browser that cannot acquire a test adapter will fail the explicit WebGPU test rather than silently reporting Canvas as a GPU pass.

The delivered validation results are in `tests/unit-results.tap`, `tests/browser-results.json`, and `TESTING.md`. The browser tests exercise real pointer actions, keyboard commands, export downloads, IndexedDB reload, GPU render readback, and device-loss fallback.

## License

MIT for the original implementation and original vector artwork. Vectora is not affiliated with Adobe. No Adobe code, artwork, icons, fonts, or other proprietary application assets are included.

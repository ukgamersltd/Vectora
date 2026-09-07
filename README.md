# Vectora — Vector Design Studio

**[Open Vectora](https://wieslawsoltes.github.io/Vectora/)** · **[Standalone HTML](https://wieslawsoltes.github.io/Vectora/Vectora.html)** · **[User and architecture guide](GUIDE.md)**

A working, independent Illustrator-inspired vector editor built with **plain HTML, CSS, JavaScript, and WGSL**. No application framework, rendering library, CDN, account, server-side application, or npm dependency installation is required.

Vectora 0.1 includes actual editable vector documents, not a static UI mockup. The example contains 38 editable objects across three artboards. This is an extensible editor and rendering foundation, not complete Illustrator parity or a production-certified replacement.

## Features

- Bézier pen and direct anchor/handle editing; rectangles, rounded rectangles, ellipses, polygons, stars, lines, pencil, and constant-width vector brush.
- Selection, transforms, alignment/distribution, grouping, layers, artboards, guides, snapping, and gesture-level undo/redo.
- Solid fill/stroke, two-stop linear gradients, live multiline text, embedded raster placement, and approximate Pathfinder operations.
- Native `.vectora` persistence, local autosave, sanitized SVG import/export, and PNG export.
- Retained WebGPU meshes, worker-based tessellation, BVH culling, dynamic paint uniforms, WGSL shaders, 4× MSAA, and explicit Canvas 2D fallback.

The footer identifies the active renderer. Hardware-adapter WebGPU is preferred when available; software adapters and initialization failures use Canvas 2D. Text is browser-shaped and rasterized into cached textures. Read the [architecture and limitations](GUIDE.md) before relying on format fidelity, numerical robustness, or production performance.

## Run locally

```sh
git clone https://github.com/wieslawsoltes/Vectora.git
cd Vectora
python3 serve.py
# Open http://127.0.0.1:8765/
```

Alternatively, open `dist/Vectora.html`. Localhost or HTTPS is preferred for WebGPU and browser storage.

```sh
npm test                  # Syntax checks and 40 geometry/document tests
python3 tools/build.py    # Rebuild dist/Vectora.html from readable source
```

Node.js 20+ runs the unit tests; Python 3 runs the optional development server and bundler. There is no `npm install` step for the application.

## Publishing

Pushes to `main` run the tests, rebuild the standalone application, and deploy it to GitHub Pages. Pull requests run the build and unit tests without deployment. The workflow verifies the published HTML and standalone download against the deployed commit and SHA-256 manifest.

See [deployment instructions](DEPLOYMENT.md), the [workflow](.github/workflows/deploy-pages.yml), and the public [version manifest](https://wieslawsoltes.github.io/Vectora/version.json).

## Documentation and validation

[GUIDE.md](GUIDE.md) contains the complete original usage, architecture, source map, security boundaries, resource ceilings, and feature limitations. [TESTING.md](TESTING.md) records the original browser/GPU validation and reproduction commands. Browser/GPU results are historical validation records, not additional checks performed by the deployment workflow. Original screenshot artifacts are not stored in Git; the browser harnesses regenerate them.

## License

[MIT](LICENSE). Vectora is independent and not affiliated with Adobe. No Adobe application code, artwork, icons, fonts, or proprietary assets are included.

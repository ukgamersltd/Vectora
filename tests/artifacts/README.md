# Browser-test artifacts

The versioned `export.svg` and `export.vectora` files are fixtures from the original validation run.

Historical PNG screenshots and GPU readbacks were distributed in the original source ZIP but are not stored in Git. Run the browser and standalone harnesses documented in `TESTING.md` to regenerate `workspace-dark.png`, `workspace-light.png`, `workspace-compact.png`, `standalone.png`, `gpu-artwork-readback.png`, and `export.png` here. Generated PNGs are ignored by Git.

The original browser/GPU results are recorded in the adjacent JSON reports. GitHub Pages CI runs unit tests and publication integrity checks, not these hardware-dependent browser suites.

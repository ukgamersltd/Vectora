# GitHub Pages deployment

Application: https://wieslawsoltes.github.io/Vectora/

Standalone edition: https://wieslawsoltes.github.io/Vectora/Vectora.html

Build manifest: https://wieslawsoltes.github.io/Vectora/version.json

## Pipeline

`.github/workflows/deploy-pages.yml` validates every push and pull request targeting `main`. It checks all eight application scripts, runs the 40 geometry/document tests, rebuilds `dist/Vectora.html`, and stages `_site/` using `tools/prepare-pages.py`.

Only pushes to `main` and manual runs on `main` publish. Deployment uses the official GitHub Pages artifact/deployment actions with `pages: write` and `id-token: write` restricted to the deployment job. Pull requests cannot publish. The normal workflow has no repository-content write permission and requires no personal access token.

The repository's **Settings → Pages → Build and deployment → Source** should be **GitHub Actions**. No Jekyll build, custom domain, server process, external package installation, or environment secret is needed.

## Published files

`index.html` is the self-contained editor. `Vectora.html` is the identical standalone edition. Both embed CSS, application JavaScript, WGSL shaders, and the geometry worker, so the `/Vectora/` project prefix requires no asset-path rewriting. `.nojekyll` disables Jekyll processing on compatible static hosts. `version.json` records the package version, commit SHA, HTML SHA-256, and byte count.

After deployment, `tools/verify-pages.py` reads the public manifest and both public HTML endpoints over HTTPS. It verifies the expected commit, exact byte count, checksum, and identical standalone content, with bounded retries for CDN propagation. This establishes which source build was published; it is not a visual browser or physical-GPU test. Full browser/GPU regression harnesses remain documented in `TESTING.md`.

## Local checks

```sh
npm test
python3 tools/build.py
python3 tools/prepare-pages.py
```

The staging directory `_site/` is generated and ignored by Git. Commit a regenerated `dist/Vectora.html` alongside application-source changes to keep the repository's standalone snapshot current. Pages always rebuilds from source and does not trust a stale committed snapshot.

## Initial source provenance

The initial import restored the delivered source without modifying the core editor. It checked the compressed source SHA-256, ran the unit tests, and verified that the regenerated standalone file exactly matched the originally delivered HTML:

```text
3e810a405bcc943d0a401b0623fdf387b8808d4a15aaa44ed6cba91e14bbd63f
```

The transfer files and one-time import workflow have been removed from the current tree. Readable source, tests, SVG/native export fixtures, documentation, license, and rebuilt standalone HTML remain versioned. Historical PNG validation artifacts are omitted from Git and can be regenerated with the browser harnesses.

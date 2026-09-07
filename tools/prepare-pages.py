#!/usr/bin/env python3
"""Stage only the self-contained application for GitHub Pages."""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / '_site'

def main() -> None:
    payload = (ROOT / 'dist' / 'Vectora.html').read_bytes()
    if not payload.startswith(b'<!DOCTYPE html>') and not payload.startswith(b'<!doctype html>'):
        raise RuntimeError('Build the standalone HTML before staging Pages')
    if b'id="vectora-worker"' not in payload or b'<script src=' in payload:
        raise RuntimeError('The Pages application must contain its geometry worker and scripts')
    commit = os.environ.get('GITHUB_SHA', 'local')
    if commit != 'local' and not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Invalid commit identifier')
    if SITE.exists():
        shutil.rmtree(SITE)
    SITE.mkdir()
    for name in ('index.html', 'Vectora.html'):
        (SITE / name).write_bytes(payload)
    (SITE / '.nojekyll').touch()
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    manifest = {
        'name': 'Vectora',
        'version': package['version'],
        'commit': commit,
        'sha256': hashlib.sha256(payload).hexdigest(),
        'bytes': len(payload),
    }
    (SITE / 'version.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(manifest, indent=2))

if __name__ == '__main__':
    main()

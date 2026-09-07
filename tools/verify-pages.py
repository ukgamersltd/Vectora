#!/usr/bin/env python3
"""Verify that the public Pages endpoint serves this build, not a stale deploy."""
import hashlib
import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlparse
from urllib.request import Request, urlopen


def fetch(url: str) -> bytes:
    request = Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'Vectora-Pages-Verification'})
    with urlopen(request, timeout=20) as response:
        return response.read(2_000_001)


def main() -> None:
    base = os.environ['PAGES_URL'].rstrip('/') + '/'
    if urlparse(base).scheme != 'https':
        raise ValueError('The published site must use HTTPS')
    expected = os.environ['GITHUB_SHA']
    last_error: Exception | None = None
    for attempt in range(12):
        query = '?' + urlencode({'commit': expected, 'attempt': attempt})
        try:
            manifest = json.loads(fetch(urljoin(base, 'version.json') + query))
            if manifest.get('commit') != expected:
                raise RuntimeError('The public endpoint is still serving a previous commit')
            payload = fetch(base + query)
            if len(payload) != manifest['bytes'] or hashlib.sha256(payload).hexdigest() != manifest['sha256']:
                raise RuntimeError('The public HTML does not match the deployed manifest')
            standalone = fetch(urljoin(base, 'Vectora.html') + query)
            if standalone != payload:
                raise RuntimeError('The standalone download differs from the published app')
            print(f'Published HTML and standalone verified: {base} ({expected}, {len(payload):,} bytes)')
            return
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError, RuntimeError) as error:
            last_error = error
            print(f'Publication verification {attempt + 1}/12: {error}', flush=True)
            if attempt < 11:
                time.sleep(5)
    raise RuntimeError('Could not verify the expected public deployment') from last_error

if __name__ == '__main__':
    main()

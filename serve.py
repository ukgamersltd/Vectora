#!/usr/bin/env python3
"""Serve Vectora locally. Python 3.9+; standard library only."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from pathlib import Path
import argparse

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--host', default='127.0.0.1')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('The port must be between 1 and 65535.')
    root = Path(__file__).resolve().parent
    try:
        server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(root)))
        print(f'Vectora: http://{args.host}:{args.port}/', flush=True)
        print('Press Ctrl+C to stop. Documents stay in your browser or saved files.', flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
    except OSError as error:
        raise SystemExit(f'Unable to start the server: {error}')

#!/usr/bin/env python3
"""Build the fully offline, dependency-free single-file distribution."""
from pathlib import Path
import argparse,re
ROOT=Path(__file__).resolve().parents[1]
def build(output:Path):
    html=(ROOT/'index.html').read_text()
    html=html.replace('<link rel="stylesheet" href="styles.css">','<style>\n'+(ROOT/'styles.css').read_text()+'\n</style>')
    worker=(ROOT/'src/geometry.js').read_text()+'\n'+(ROOT/'src/geometry-worker.js').read_text()
    worker=worker.replace('</script','<\\/script')
    html=html.replace('<script src="src/geometry.js"></script>','<script type="text/plain" id="vectora-worker">\n'+worker+'\n</script>\n<script src="src/geometry.js"></script>')
    def inline(match):
        code=(ROOT/match.group(1)).read_text().replace('</script','<\\/script')
        return '<script>\n'+code+'\n</script>'
    html=re.sub(r'<script src="([^"]+)"></script>',inline,html)
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(html)
    print(f'Built {output} ({output.stat().st_size:,} bytes)')
    return html
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=ROOT/'dist'/'Vectora.html');args=parser.parse_args();build(args.output)

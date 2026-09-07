#!/usr/bin/env python3
"""Validate that the bundled HTML works without its external source files."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import os,json
ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ.get('VECTORA_URL','http://127.0.0.1:8765/')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=vulkan','--enable-features=Vulkan','--use-vulkan=swiftshader','--disable-vulkan-surface'])
 page=b.new_page(viewport={'width':1600,'height':1000});errors=[];requests=[]
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
 page.goto(BASE+'dist/Vectora.html?fresh=1');page.wait_for_function('window.vectora && vectora.renderer.mode!=="Initializing"');page.wait_for_timeout(500)
 assert page.evaluate('vectora.store.doc.nodes.length')==38
 default=page.evaluate('({mode:vectora.renderer.mode,reason:vectora.renderer.reason})')
 assert not any('/src/' in url or '/styles.css' in url for url in requests),requests
 assert not any(url.startswith('http') and not url.startswith(BASE) for url in requests),requests
 page.screenshot(path=str(ROOT/'tests/artifacts/standalone.png'))
 page.goto(BASE+'dist/Vectora.html?fresh=1&renderer=webgpu');page.wait_for_function('window.vectora?.renderer.mode==="WebGPU"',timeout=15000);page.wait_for_function('vectora.renderer.stats.vertices>1000',timeout=15000)
 assert page.evaluate('vectora.renderer.meshes.url.startsWith("blob:")')
 vertices=page.evaluate('vectora.renderer.stats.vertices');assert vertices>1000
 assert not errors,errors
 # Opaque-origin load: proves no external resources are necessary even when storage/GPU are denied.
 page2=b.new_page();page2.set_content((ROOT/'dist/Vectora.html').read_text());page2.wait_for_function('window.vectora?.store.doc.nodes.length===38');assert page2.evaluate('vectora.renderer.mode')=='Canvas 2D'
 report={'standaloneStartup':'passed','noExternalCodeOrStyles':'passed','noThirdPartyRequests':'passed','embeddedBlobWorker':'passed','forcedWebGPUVertices':vertices,'opaqueOriginFallback':'passed','defaultBackend':default,'errors':errors}
 (ROOT/'tests/standalone-results.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));b.close()

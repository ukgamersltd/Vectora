#!/usr/bin/env python3
"""Actual Chromium interaction tests. Run a local server first; no npm dependencies.
Install test-only dependencies: python -m pip install playwright pillow
CHROMIUM_PATH overrides the installed browser. VECTORA_URL defaults to localhost:8765.
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
import os,json,time,traceback,base64,io
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests'/'artifacts';OUT.mkdir(exist_ok=True)
REPORT={'browser':'Chromium','results':[],'errors':[]}
URL=os.environ.get('VECTORA_URL','http://127.0.0.1:8765/')
CHROME=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium')
FLAGS=['--no-sandbox','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=vulkan','--enable-features=Vulkan','--use-vulkan=swiftshader','--disable-vulkan-surface']
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=CHROME,headless=True,args=FLAGS)
 context=browser.new_context(viewport={'width':1600,'height':1000},accept_downloads=True)
 page=context.new_page();page.set_default_timeout(6000)
 page.on('pageerror',lambda e:REPORT['errors'].append(str(e)))
 def check(name,fn):
  try:
   fn();REPORT['results'].append({'name':name,'status':'passed'});print('PASS',name,flush=True)
  except Exception as e:
   REPORT['results'].append({'name':name,'status':'failed','message':str(e)});print('FAIL',name,str(e),flush=True);traceback.print_exc();page.screenshot(path=str(OUT/('failure-'+str(len(REPORT['results']))+'.png')))
 def ev(code,arg=None):return page.evaluate(code,arg)
 def wait():page.wait_for_timeout(90)
 def pos(x,y):return ev('''([x,y])=>{let p=vectora.camera.screen(V.pt(x,y)),r=document.getElementById('stage').getBoundingClientRect();return [p.x+r.x,p.y+r.y]}''',[x,y])
 def drag(a,b,steps=8):
  page.mouse.move(*pos(*a));page.mouse.down();page.mouse.move(*pos(*b),steps=steps);page.mouse.up();wait()
 def click(x,y):page.mouse.click(*pos(x,y));wait()
 def tool(id):page.locator('[data-tool="'+id+'"]').click();wait()
 def reset():
  if ev('document.getElementById("modal").open'):ev('document.getElementById("modal").close()')
  ev("vectora.loadDocument(V.blankDocument(1000,700,'Browser test'));vectora.smartGuides=false;vectora.fill='#EB713F';vectora.stroke='none';vectora.opacity=1;vectora.refreshUI()");wait()
 def shape(id,a,b):tool(id);drag(a,b)
 def count():return ev('vectora.store.doc.nodes.length')
 def assertion(v,msg='Assertion failed'):
  if not v:raise AssertionError(msg)
 page.goto(URL+'?fresh=1&renderer=canvas');page.wait_for_function("window.vectora && vectora.renderer.mode==='Canvas 2D'");page.wait_for_timeout(500)
 check('Application starts with 38 editable objects and three artboards',lambda:(assertion(count()==38),assertion(ev('vectora.store.doc.artboards.length')==3),assertion(not REPORT['errors'])))
 page.screenshot(path=str(OUT/'workspace-dark.png'))
 def new_document():
  page.locator('[data-menu="File"]').click();page.locator('#menu-popover [data-cmd="new"]').click();page.locator('#new-name').fill('Browser test');page.locator('#new-width').fill('1000');page.locator('#new-height').fill('700');page.locator('#create-document').click();assertion(count()==0);assertion(ev('vectora.store.doc.name')=='Browser test');ev('vectora.smartGuides=false')
 check('New document through File menu and modal',new_document)
 def rectangles():
  shape('rect',(100,100),(300,240));assertion(count()==1);n=ev('vectora.store.doc.nodes[0]');assertion(abs(n['w']-200)<2);assertion(abs(n['h']-140)<2)
 check('Rectangle tool creates actual geometry',rectangles)
 def move_undo():
  tool('select');drag((170,170),(220,210));n=ev('vectora.store.doc.nodes[0]');assertion(abs(n['matrix'][4]-150)<2);page.keyboard.press('Control+z');wait();assertion(abs(ev('vectora.store.doc.nodes[0].matrix[4]')-100)<2);page.keyboard.press('Control+Shift+z');wait();assertion(abs(ev('vectora.store.doc.nodes[0].matrix[4]')-150)<2)
 check('Pointer move and keyboard undo/redo',move_undo)
 def resize():
  b=ev('vectora.store.selectionBounds()');drag((b['x2'],b['y2']),(b['x2']+80,b['y2']+50));b2=ev('vectora.store.selectionBounds()');assertion(b2['w']>b['w']+70);assertion(b2['h']>b['h']+40)
 check('Bounding-box resize transforms vector objects',resize)
 def properties():
  page.locator('#properties-panel [data-swatch="#344C3D"]').click();assertion(ev('vectora.store.selected[0].fill')=='#344C3D');field=page.locator('#properties-panel [data-prop="x"]');field.fill('120');field.press('Enter');field.blur();wait();assertion(abs(ev('vectora.store.selectionBounds().x')-120)<2)
 check('Inspector swatches and numeric transformation',properties)
 def ellipse_direct():
  shape('ellipse',(500,100),(660,240));assertion(ev('vectora.store.selected[0].type')=='ellipse');tool('direct');drag((580,100),(595,75));n=ev('vectora.store.selected[0]');assertion(n['type']=='path');assertion(n['paths'][0]['points'][0]['out'] is not None);assertion(n['paths'][0]['points'][0]['y'] < -15)
 check('Direct selection edits a Bézier anchor',ellipse_direct)
 def pen():
  tool('pen');drag((450,350),(485,320));click(600,380);click(560,470);click(450,350);assertion(ev('vectora.store.selected[0].paths[0].closed'));assertion(ev('vectora.store.selected[0].paths[0].points[0].out!==null'));assertion(ev('vectora.editor.pen===null'))
 check('Pen tool creates and closes a cubic path',pen)
 def text():
  tool('text');click(100,400);page.locator('#text-editor').fill('Real editable text');page.locator('#text-editor').press('Control+Enter');wait();assertion(ev('vectora.store.selected[0].text')=='Real editable text');assertion(ev('vectora.editor.textNode===null'));assertion(ev('vectora.store.selected[0].w')>100)
 check('Live text creation, browser shaping, and commit',text)
 def gradient():
  ev("vectora.store.select([vectora.store.doc.nodes[0].id])");wait();ev("vectora.run('gradient')");wait();assertion(ev('vectora.store.selected[0].fill.type')=='linear');tool('gradient');drag((140,170),(220,220));assertion(abs(ev('vectora.store.selected[0].fill.angle'))>5)
 check('Gradient editing changes the retained paint model',gradient)
 def booleans():
  reset();shape('rect',(100,100),(260,230));shape('ellipse',(200,130),(350,260));ev('vectora.store.select(vectora.store.doc.nodes.map(n=>n.id))');wait();page.locator('#properties-panel [data-cmd="boolean-union"]').click();wait();assertion(count()==1);assertion(ev('vectora.store.doc.nodes[0].type')=='path');page.locator('#overlay').focus();page.keyboard.press('Control+z');wait();assertion(count()==2)
 check('Pathfinder union and undo restore both source objects',booleans)
 def group_duplicate():
  ev('vectora.store.select(vectora.store.doc.nodes.map(n=>n.id))');ev("vectora.run('group')");wait();tool('select');page.keyboard.down('Alt');drag((140,150),(190,180));page.keyboard.up('Alt');assertion(count()==4);ns=ev('vectora.store.selected');assertion(len(ns)==2);assertion(ns[0]['groupId']==ns[1]['groupId']);assertion(ns[0]['groupId']!=ev('vectora.store.doc.nodes[0].groupId'))
 check('Alt-drag duplicates a group without breaking group membership',group_duplicate)
 def layers():
  ev("vectora.run('new-layer')");wait();assertion(ev('vectora.store.doc.layers.length')==2);ev("vectora.run('layers')");wait();assertion(page.locator('#layers-panel').is_visible());ev("vectora.store.mutate('Hide layer',()=>vectora.store.doc.layers[0].visible=false)");assertion(ev('vectora.store.visibleNodes.length')==0);ev('vectora.store.history.undo()');assertion(ev('vectora.store.visibleNodes.length')==4)
 check('Layers panel and visibility participate in history',layers)
 def guides():
  tool('select');r=page.locator('#stage').bounding_box();end=pos(400,300);page.mouse.move(r['x']+300,r['y']+10);page.mouse.down();page.mouse.move(*end,steps=8);page.mouse.up();wait();assertion(ev('vectora.store.doc.guides.length')==1)
 check('Dragging a ruler creates a persistent guide',guides)
 def artboard():
  before=ev('vectora.store.doc.artboards.length');ev("vectora.run('new-board')");wait();assertion(ev('vectora.store.doc.artboards.length')==before+1);assertion(ev('vectora.store.activeBoard.w')>0)
 check('Artboard creation and camera fitting',artboard)
 def clipboard():
  ev('vectora.store.select([vectora.store.doc.nodes[0].id])');ev('vectora.copy()');before=count();ev('vectora.paste()');wait();assertion(count()==before+1)
 check('Internal clipboard copies and pastes editable objects',clipboard)
 def svg_security():
  result=ev('''()=>{delete window.owned;let {doc,warnings}=V.importSVG('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><script>window.owned=1</script><foreignObject width="100" height="100"><div>evil</div></foreignObject><image href="https://example.com/remote.png" width="20" height="20"/><path d="M10 10h80v50h-80z" fill="#ee7733"/></svg>');return {count:doc.nodes.length,owned:window.owned===1,warnings}}''');assertion(result['count']==1);assertion(not result['owned']);assertion(len(result['warnings'])>0)
 check('SVG parser omits scripts, foreignObject, and remote images',svg_security)
 def svg_roundtrip():
  result=ev('''()=>{let doc=vectora.store.doc;let native=V.svgExport(doc,null,null,true),out=V.importSVG(native).doc;let plain=V.svgExport(doc);return {equal:JSON.stringify(doc)===JSON.stringify(out),plainMetadata:plain.includes('id="vectora-document"'),nodes:V.importSVG(plain).doc.nodes.length}}''');assertion(result['equal']);assertion(not result['plainMetadata']);assertion(result['nodes']>=count())
 check('Opt-in native SVG round trip and metadata-free ordinary export',svg_roundtrip)
 def export_svg():
  ev("vectora.run('export')");page.locator('#export-format').select_option('svg');page.locator('#export-board').select_option('all');
  with page.expect_download() as d:page.locator('#export-confirm').click()
  d.value.save_as(str(OUT/'export.svg'));text=(OUT/'export.svg').read_text();assertion('<svg' in text and '<path' in text)
 check('SVG export downloads a valid vector file',export_svg)
 def export_png():
  ev("vectora.run('export')");page.locator('#export-format').select_option('png');page.locator('#export-scale').select_option('1');board=ev('vectora.store.activeBoard')
  with page.expect_download() as d:page.locator('#export-confirm').click()
  d.value.save_as(str(OUT/'export.png'));im=Image.open(OUT/'export.png');assertion(im.size==(round(board['w']),round(board['h'])))
 check('PNG export produces expected pixel dimensions',export_png)
 def native_save():
  with page.expect_download() as d:ev('vectora.save()')
  d.value.save_as(str(OUT/'export.vectora'));doc=json.loads((OUT/'export.vectora').read_text());assertion(doc['format']=='vectora');assertion(len(doc['nodes'])==count())
 check('Native source save preserves editable document',native_save)
 def storage():
  ev("vectora.store.mutate('Rename',()=>vectora.store.doc.name='Autosave E2E')");page.wait_for_timeout(900);page.goto(URL+'?renderer=canvas');page.wait_for_function("window.vectora?.store.doc.name==='Autosave E2E'");assertion(count()==5)
 check('IndexedDB autosave survives a reload',storage)
 def light():
  ev('vectora.loadDocument(V.demoDocument())');ev("vectora.run('theme')");page.wait_for_timeout(100);assertion(ev('document.documentElement.dataset.theme')=='light');page.screenshot(path=str(OUT/'workspace-light.png'));page.set_viewport_size({'width':1100,'height':800});page.wait_for_timeout(100);assertion(ev('vectora.camera.width')>600);page.screenshot(path=str(OUT/'workspace-compact.png'));page.set_viewport_size({'width':1600,'height':1000});ev("vectora.run('theme')")
 check('Light theme and compact workspace remain usable',light)
 def palette():
  ev("vectora.run('palette')");page.locator('#command-search').fill('artboard');assertion(page.locator('#modal [data-palette-cmd]').count()>0);page.keyboard.press('Escape')
 check('Searchable command palette',palette)
 # Dedicated real WebGPU tests. If no adapter is present, fail instead of silently counting Canvas.
 def gpu():
  if ev('document.getElementById("modal").open'):ev('document.getElementById("modal").close()')
  page.goto(URL+'?fresh=1&renderer=webgpu');page.wait_for_function("window.vectora?.renderer.mode==='WebGPU'",timeout=15000);page.wait_for_function("vectora.renderer.stats.vertices>1000",timeout=15000);page.wait_for_timeout(300)
  state=ev('''async()=>{let r=vectora.renderer;r.drawGPU();await r.device.queue.onSubmittedWorkDone();return {png:r.canvas.toDataURL(),vertices:r.stats.vertices,draws:r.stats.draws,adapter:r.adapterInfo,worker:!!r.meshes.worker}}''')
  pixels=base64.b64decode(state.pop('png').split(',')[1]);(OUT/'gpu-artwork-readback.png').write_bytes(pixels);im=Image.open(io.BytesIO(pixels)).convert('RGBA');alpha=im.getchannel('A');opaque=sum(alpha.histogram()[1:]);assertion(opaque>10000,'GPU readback is empty');assertion(state['worker']);REPORT['webgpu']={**state,'nontransparentPixels':opaque,'backend':'software Vulkan / SwiftShader'}
 check('Real WebGPU pipelines, worker meshes, textures, and nonempty GPU pixel readback',gpu)
 def gpu_edit():
  tool('ellipse');drag((150,430),(270,550));page.wait_for_function('vectora.renderer.stats.draws>=39');assertion(ev('vectora.renderer.mode')=='WebGPU');page.keyboard.press('Control+z');wait();assertion(count()==38)
 check('GPU editing and undo submit fresh geometry',gpu_edit)
 def device_loss():
  ev('vectora.renderer.device.destroy()');page.wait_for_function("vectora.renderer.mode==='Canvas 2D'");page.wait_for_timeout(200);assertion(page.locator('#fallback').is_visible());assertion('Canvas 2D' in page.locator('#renderer-name').inner_text())
 check('Device loss switches explicitly to functioning Canvas renderer',device_loss)
 check('No uncaught JavaScript errors during browser tests',lambda:assertion(not REPORT['errors'],str(REPORT['errors'])))
 REPORT['version']=browser.version;REPORT['passed']=sum(r['status']=='passed' for r in REPORT['results']);REPORT['failed']=sum(r['status']=='failed' for r in REPORT['results']);(ROOT/'tests'/'browser-results.json').write_text(json.dumps(REPORT,indent=2));browser.close()
 print(json.dumps({'passed':REPORT['passed'],'failed':REPORT['failed'],'errors':REPORT['errors']},indent=2))
 if REPORT['failed']:raise SystemExit(1)

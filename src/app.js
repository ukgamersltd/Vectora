/* Vectora application shell. Framework-free HTML UI around a renderer-independent document. */
'use strict';
(() => {
    const $ = id => document.getElementById(id), esc = V.esc, round = (x, d = 1) => Number((Number(x) || 0).toFixed(d));
    const SWATCHES = ['#F2EFE5', '#FFFFFF', '#D8DBD6', '#A7ACA5', '#73796F', '#344C3D', '#253C30', '#151C19', '#F7D6B5', '#F4A27B', '#EB713F', '#CE512E', '#B53C33', '#E9A9A9', '#D2A7CB', '#977DC0', '#5E5BAC', '#2F5475', '#5C88AF', '#9CC0D1', '#CEE7DD', '#94BCAD', '#5D9D81', '#397057', '#DDE0AB', '#B2C079', '#D8C566', '#EAAF43', '#BA8763', '#7B5745'];
    const TOOLS = [['select', 'select', 'V'], ['direct', 'direct', 'A'], ['pen', 'pen', 'P'], ['pencil', 'pencil', 'N'], ['text', 'type', 'T'], ['line', 'line', '\\'], ['rect', 'rect', 'M'], ['ellipse', 'ellipse', 'L'], ['polygon', 'polygon', ''], ['star', 'star', 'S'], ['brush', 'brush', 'B'], ['erase', 'erase', 'E'], ['gradient', 'gradient', 'G'], ['eyedropper', 'eyedropper', 'I'], ['artboard', 'artboard', 'O'], ['rotate', 'rotate', 'R'], ['hand', 'hand', 'H'], ['zoom', 'zoom', 'Z']];
    class App {
        constructor() {
            this.dom = { overlay: $('overlay'), stage: $('stage'), textEditor: $('text-editor') };
            this.fill = '#EB713F';
            this.stroke = 'none';
            this.strokeWidth = 2;
            this.opacity = 1;
            this.smartGuides = true;
            this.gridSnap = false;
            this.showGuides = true;
            this.lockGuides = false;
            this.constrain = false;
            this.currentTab = 'properties';
            this.expanded = new Set(['artwork', 'type']);
            this.clipboard = null;
            this.storage = new V.SessionStorage();
            this.camera = new V.Camera();
            this.store = new V.DocumentStore(V.demoDocument());
            this.commands = new Map();
            this.raf = 0;
            this.uiQueued = false;
            this.autosaveTimer = null;
            this.unsaved = false;
            this.saving = false;
            this.uiHidden = false;
            try {
                document.documentElement.dataset.theme = localStorage.getItem('vectora-theme') || 'dark';
            }
            catch { }
            this.invalidate = () => { if (this.raf)
                return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.frame(); }); };
            this.renderer = new V.Renderer({ gpu: $('gpu'), fallback: $('fallback'), background: $('background'), store: this.store, camera: this.camera, invalidate: this.invalidate });
            this.editor = new V.Editor(this);
            this.registerCommands();
            this.buildMenus();
            this.buildTools();
            V.hydrateIcons();
            this.bind();
            this.store.addEventListener('change', e => { this.invalidate(); if (e.detail.kind !== 'gesture')
                this.requestUI(); if (['commit', 'history'].includes(e.detail.kind)) {
                this.unsaved = true;
                this.queueAutosave();
            } });
            this.renderer.addEventListener('ready', () => { this.updateEngine(); this.resize(); });
            new ResizeObserver(() => this.resize()).observe(this.dom.stage);
            this.resize();
            this.editor.fitAll();
            this.refreshUI();
            this.renderer.ready.then(() => { this.updateEngine(); this.invalidate(); });
            this.restoreSession();
        }
        requestUI() { if (this.uiQueued)
            return; this.uiQueued = true; queueMicrotask(() => { this.uiQueued = false; this.refreshUI(); }); }
        resize() { const r = this.dom.stage.getBoundingClientRect(); if (!r.width || !r.height)
            return; this.camera.width = r.width; this.camera.height = r.height; this.renderer.resize(r.width, r.height, devicePixelRatio); let dpr = this.renderer.dpr; this.dom.overlay.width = Math.round(r.width * dpr); this.dom.overlay.height = Math.round(r.height * dpr); this.dom.overlay.style.width = r.width + 'px'; this.dom.overlay.style.height = r.height + 'px'; this.invalidate(); }
        frame() { this.renderer.frame(); this.editor.drawOverlay(); const z = round(this.camera.zoom * 100, 1); $('document-mode').textContent = `@ ${z}% (RGB / ${this.renderer.outline ? 'Outline' : this.renderer.clip ? 'Trim' : 'Preview'})`; let sel = $('zoom-select'); if (document.activeElement !== sel) {
            let value = String(z);
            sel.innerHTML = [...new Set([value, '25', '50', '75', '100', '150', '200', '400'])].map(x => `<option value="${x}" ${x === value ? 'selected' : ''}>${x}%</option>`).join('');
        } const stats = this.renderer.stats; $('status-stats').textContent = `${this.store.doc.nodes.length} objects · ${round(stats.frameMs, 1)} ms CPU`; $('selection-toolbar').hidden = !this.store.selection.size || !!this.editor.textNode || !!this.editor.pen; $('canvas-hint').hidden = !!this.store.selection.size || !!this.editor.pen; $('selection-count').textContent = this.store.selection.size + ' ' + (this.store.selection.size === 1 ? 'object' : 'objects'); }
        updateEngine() { let mode = this.renderer.outline ? 'Canvas 2D · Outline' : this.renderer.mode; $('renderer-name').textContent = mode; $('renderer-badge').title = this.renderer.mode === 'WebGPU' ? 'Actual WebGPU rendering. Click for diagnostics.' : this.renderer.reason || 'Canvas 2D compatibility renderer'; $('renderer-badge').querySelector('.engine-dot').classList.toggle('fallback', this.renderer.mode !== 'WebGPU'); }
        async restoreSession() { try {
            if (!new URLSearchParams(location.search).has('fresh')) {
                let doc = await this.storage.load();
                if (doc) {
                    this.loadDocument(doc, false);
                    this.toast('Restored your locally saved workspace.');
                }
            }
            await this.storage.save(this.store.doc);
            this.setSaveState('Saved on this device');
        }
        catch (e) {
            this.autosaveUnavailable = true;
            this.setSaveState('Autosave unavailable');
            console.warn('Local storage:', e.message);
        } }
        setSaveState(text) { $('save-state').innerHTML = '<span class="save-dot"></span>' + esc(text); }
        queueAutosave() { clearTimeout(this.autosaveTimer); this.setSaveState('Saving locally…'); this.autosaveTimer = setTimeout(async () => { try {
            await this.storage.save(this.store.doc);
            this.unsaved = false;
            this.setSaveState('All changes saved locally');
        }
        catch (e) {
            this.autosaveUnavailable = true;
            this.setSaveState('Save a file to keep changes');
        } }, 500); }
        loadDocument(doc, save = true) { if (this.editor.textNode)
            this.editor.finishText(); if (this.editor.pen || this.editor.gesture)
            this.editor.cancel(); this.store.doc = V.validateDocument(doc); this.store.selection.clear(); this.store.activeLayer = doc.layers.find(l => l.id === 'artwork')?.id || doc.layers.at(-1).id; this.store.activeArtboard = doc.artboards[0].id; this.store.history.clear(); this.store.cleanSelection(); this.editor.anchorSelection = null; this.editor.hover = null; this.expanded = new Set(doc.layers.slice(-2).map(l => l.id)); this.store.emit(); this.editor.setTool('select'); this.editor.fitAll(); this.refreshUI(); if (save)
            this.queueAutosave(); }
        register(id, label, shortcut, icon, run, enabled = () => true) { this.commands.set(id, { id, label, shortcut, icon, run, enabled }); }
        registerCommands() {
            const s = this.store, e = this.editor, R = (id, label, key, icon, fn, enabled) => this.register(id, label, key, icon, fn, enabled), selected = () => s.selected.some(n => !s.isLocked(n));
            R('new', 'New document', '⌘/Ctrl N', 'plus', () => this.newDialog());
            R('open', 'Open artwork…', '⌘/Ctrl O', 'folder', () => this.openFile(false));
            R('place', 'Place artwork…', '', 'import', () => this.openFile(true));
            R('save', 'Save .vectora file', '⌘/Ctrl S', 'save', () => this.save());
            R('export', 'Export artwork…', '⌘/Ctrl ⇧ E', 'export', () => this.exportDialog());
            R('setup', 'Document setup…', '', 'sliders', () => this.setupDialog());
            R('demo', 'Open example artwork', '', 'file', () => this.replaceDialog());
            R('undo', 'Undo', '⌘/Ctrl Z', 'undo', () => { if (e.pen)
                e.finishPen(); s.history.undo(); }, () => s.history.index > 0 || !!e.pen);
            R('redo', 'Redo', '⌘/Ctrl ⇧ Z', 'redo', () => s.history.redo(), () => s.history.index < s.history.entries.length);
            R('copy', 'Copy', '⌘/Ctrl C', 'copy', () => this.copy(), () => s.selection.size > 0);
            R('cut', 'Cut', '⌘/Ctrl X', 'copy', () => { this.copy(); s.delete(); }, selected);
            R('paste', 'Paste', '⌘/Ctrl V', 'copy', () => this.paste());
            R('duplicate', 'Duplicate', '⌘/Ctrl D', 'copy', () => s.duplicate(), selected);
            R('delete', 'Delete', 'Delete', 'trash', () => e.deleteSelection(), selected);
            R('group', 'Group', '⌘/Ctrl G', 'group', () => s.group(), () => s.selection.size > 1);
            R('ungroup', 'Ungroup', '⌘/Ctrl ⇧ G', 'group', () => s.ungroup(), () => s.selected.some(n => n.groupId));
            R('front', 'Bring to front', '⌘/Ctrl ⇧ ]', 'front', () => s.arrange('front'), selected);
            R('back', 'Send to back', '⌘/Ctrl ⇧ [', 'back', () => s.arrange('back'), selected);
            R('forward', 'Bring forward', '⌘/Ctrl ]', 'front', () => s.arrange('forward'), selected);
            R('backward', 'Send backward', '⌘/Ctrl [', 'back', () => s.arrange('backward'), selected);
            for (let [mode, ic, label] of [['left', 'alignLeft', 'Align left'], ['center', 'alignCenter', 'Align horizontal centers'], ['right', 'alignRight', 'Align right'], ['top', 'alignTop', 'Align top'], ['middle', 'alignMiddle', 'Align vertical centers'], ['bottom', 'alignBottom', 'Align bottom']])
                R('align-' + mode, label, '', ic, () => s.align(mode), selected);
            R('distribute-x', 'Distribute horizontally', '', 'alignCenter', () => s.distribute('x'), () => s.selection.size > 2);
            R('distribute-y', 'Distribute vertically', '', 'alignMiddle', () => s.distribute('y'), () => s.selection.size > 2);
            for (let [op, label, icon] of [['union', 'Unite', 'union'], ['subtract', 'Minus front', 'subtract'], ['intersect', 'Intersect', 'intersect'], ['xor', 'Exclude', 'xor']])
                R('boolean-' + op, label, '', icon, () => s.boolean(op), () => s.selected.filter(n => !['text', 'image'].includes(n.type)).length > 1);
            R('expand', 'Convert shapes to paths', '', 'path', () => s.convertToPath(), selected);
            R('outline-stroke', 'Outline stroke', '', 'pen', () => this.outlineStroke(), () => s.selected.some(n => n.stroke !== 'none' && n.strokeWidth > 0 && !['text', 'image'].includes(n.type)));
            R('simplify', 'Simplify path', '', 'path', () => this.simplifySelected(), () => s.selected.some(n => n.type === 'path'));
            R('close-path', 'Close / open path', '', 'path', () => this.editSelected('Toggle path closure', n => { if (n.type === 'path')
                for (let p of n.paths)
                    p.closed = !p.closed; }), () => s.selected.some(n => n.type === 'path'));
            R('flip-h', 'Reflect horizontally', '', 'flipH', () => this.flip('x'), selected);
            R('flip-v', 'Reflect vertically', '', 'flipV', () => this.flip('y'), selected);
            R('lock', 'Lock selection', '⌘/Ctrl 2', 'lock', () => { s.mutate('Lock objects', () => { for (let n of s.selected)
                n.locked = true; s.selection.clear(); }); }, selected);
            R('unlock-all', 'Unlock all', '', 'unlock', () => s.mutate('Unlock all', () => { for (let n of s.doc.nodes)
                n.locked = false; for (let l of s.doc.layers)
                l.locked = false; }));
            R('select-all', 'Select all', '⌘/Ctrl A', 'select', () => s.select(s.visibleNodes.filter(n => !s.isLocked(n)).map(n => n.id)));
            R('deselect', 'Deselect', 'Esc', 'select', () => s.select([]));
            R('invert-selection', 'Inverse selection', '', 'select', () => s.select(s.visibleNodes.filter(n => !s.isLocked(n) && !s.selection.has(n.id)).map(n => n.id)));
            R('same-fill', 'Select same fill color', '', 'eyedropper', () => { let fill = JSON.stringify(s.selected[0]?.fill ?? this.fill); s.select(s.visibleNodes.filter(n => !s.isLocked(n) && JSON.stringify(n.fill) === fill).map(n => n.id)); });
            R('zoom-in', 'Zoom in', '+', 'zoom', () => { this.camera.zoomAt(1.25, V.pt(this.camera.width / 2, this.camera.height / 2)); this.invalidate(); });
            R('zoom-out', 'Zoom out', '−', 'zoom', () => { this.camera.zoomAt(.8, V.pt(this.camera.width / 2, this.camera.height / 2)); this.invalidate(); });
            R('fit-board', 'Fit active artboard', '⌘/Ctrl 0', 'fit', () => e.fitBoard());
            R('fit-all', 'Fit all artboards', '⌘/Ctrl Alt 0', 'fit', () => e.fitAll());
            R('fit-selection', 'Fit selection', '', 'fit', () => e.fitSelection(), selected);
            R('actual-size', 'Actual size', '⌘/Ctrl 1', 'zoom', () => { this.camera.zoomAt(1 / this.camera.zoom, V.pt(this.camera.width / 2, this.camera.height / 2)); this.invalidate(); });
            R('outline', 'Outline / preview', '⌘/Ctrl Y', 'outline', () => { this.renderer.outline = !this.renderer.outline; this.updateEngine(); this.invalidate(); this.refreshUI(); });
            R('trim', 'Trim artboard view', '', 'artboard', () => { this.renderer.clip = !this.renderer.clip; this.invalidate(); this.toast(this.renderer.clip ? 'Trim view: artwork is clipped to its assigned artboard.' : 'Preview: artwork is visible outside artboards.'); });
            R('grid', 'Show / hide grid', '⌘/Ctrl \'', 'grid', () => { this.renderer.grid = !this.renderer.grid; this.invalidate(); this.refreshUI(); });
            R('grid-snap', 'Snap to 20 px grid', '', 'grid', () => { this.gridSnap = !this.gridSnap; this.toast('Grid snapping ' + (this.gridSnap ? 'on' : 'off') + '.'); this.refreshUI(); });
            R('smart-guides', 'Smart guides', '⌘/Ctrl U', 'magnet', () => { this.smartGuides = !this.smartGuides; this.toast('Smart guides ' + (this.smartGuides ? 'on' : 'off') + '.'); this.refreshUI(); });
            R('show-guides', 'Show / hide guides', '', 'line', () => { this.showGuides = !this.showGuides; this.invalidate(); });
            R('lock-guides', 'Lock / unlock guides', '', 'lock', () => { this.lockGuides = !this.lockGuides; this.toast('Guides ' + (this.lockGuides ? 'locked' : 'unlocked') + '.'); });
            R('clear-guides', 'Clear guides', '', 'trash', () => s.mutate('Clear guides', () => s.doc.guides = []));
            R('theme', 'Switch light / dark theme', '', 'sun', () => { const root = document.documentElement; root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; try {
                localStorage.setItem('vectora-theme', root.dataset.theme);
            }
            catch { } this.invalidate(); });
            R('palette', 'Search commands…', '⌘/Ctrl K', 'search', () => this.palette());
            R('workspace', 'Workspace options', '', 'sliders', () => this.showMenu('Workspace', ['properties', 'layers', 'history', 'hide-panels', 'theme', '-', 'fit-all'], null));
            R('properties', 'Properties panel', '', 'sliders', () => this.setTab('properties'));
            R('layers', 'Layers panel', '', 'layers', () => this.setTab('layers'));
            R('history', 'History panel', '', 'history', () => this.setTab('history'));
            R('hide-panels', 'Show / hide panels', 'Tab', 'layers', () => this.togglePanels());
            R('new-layer', 'New layer', '', 'plus', () => this.addLayer());
            R('new-board', 'New artboard', '', 'artboard', () => this.addBoard());
            R('prev-board', 'Previous artboard', '', 'chevronLeft', () => this.stepBoard(-1));
            R('next-board', 'Next artboard', '', 'chevronRight', () => this.stepBoard(1));
            R('swap-paint', 'Swap fill and stroke', '⇧ X', 'swap', () => { const fill = typeof this.fill === 'object' ? this.fill.color0 : this.fill, stroke = this.stroke; this.fill = stroke; this.stroke = fill; s.mutate('Swap fill and stroke', () => { for (let n of s.selected)
                if (!s.isLocked(n)) {
                    let fill = typeof n.fill === 'object' ? n.fill.color0 : n.fill;
                    n.fill = n.stroke;
                    n.stroke = fill;
                } }); this.refreshUI(); });
            R('default-paint', 'Default fill and stroke', 'D', 'defaultPaint', () => { this.fill = '#FFFFFF'; this.stroke = '#111111'; this.strokeWidth = 1; this.editSelected('Default appearance', n => Object.assign(n, { fill: this.fill, stroke: this.stroke, strokeWidth: 1 })); this.refreshUI(); });
            R('solid', 'Solid fill', '', 'rect', () => this.applyPaint(typeof this.fill === 'string' && this.fill !== 'none' ? this.fill : '#EB713F'));
            R('no-fill', 'Remove fill', '/', 'erase', () => this.applyPaint('none'));
            R('gradient', 'Linear gradient fill', '', 'gradient', () => this.applyPaint({ type: 'linear', color0: typeof this.fill === 'string' && this.fill !== 'none' ? this.fill : '#F4A27B', color1: '#344C3D', angle: 0 }));
            R('focus-type', 'Character settings', '', 'type', () => { this.setTab('properties'); $('character-section')?.scrollIntoView({ block: 'nearest' }); if (!s.selected.some(n => n.type === 'text')) {
                e.setTool('text');
                this.toast('Click an artboard to create text, or select existing text.');
            } });
            R('focus-swatches', 'Color swatches', '', 'swatches', () => { this.setTab('properties'); $('swatches-section')?.scrollIntoView({ block: 'nearest' }); });
            R('focus-pathfinder', 'Pathfinder settings', '', 'union', () => { this.setTab('properties'); $('pathfinder-section')?.scrollIntoView({ block: 'nearest' }); if (s.selection.size < 2)
                this.toast('Select two or more vector shapes to use Pathfinder.'); });
            R('bold', 'Toggle bold', '', 'type', () => this.editSelected('Toggle bold', n => { if (n.type === 'text') {
                n.fontWeight = Number(n.fontWeight) >= 600 ? 400 : 700;
                V.measureText(n);
            } }), () => s.selected.some(n => n.type === 'text'));
            R('italic', 'Toggle italic', '', 'type', () => this.editSelected('Toggle italic', n => { if (n.type === 'text') {
                n.fontStyle = n.fontStyle === 'italic' ? 'normal' : 'italic';
                V.measureText(n);
            } }), () => s.selected.some(n => n.type === 'text'));
            R('shortcuts', 'Keyboard shortcuts', '', 'help', () => this.shortcutDialog());
            R('diagnostics', 'Renderer diagnostics', '', 'gpu', () => this.diagnostics());
            R('about', 'About Vectora', '', 'help', () => this.about());
            for (let [id, icon, key] of TOOLS)
                R('tool-' + id, V.toolInfo[id][0] + ' tool', key, icon, () => e.setTool(id));
        }
        async run(id) { const c = this.commands.get(id); if (!c)
            return; this.closePopovers(); if (!c.enabled())
            return; try {
            await c.run();
        }
        catch (e) {
            console.error(e);
            this.toast(e.message || String(e), true);
        } this.updateToolUI(); this.invalidate(); }
        buildMenus() { this.menuDefinitions = { File: ['new', 'open', 'place', '-', 'save', 'export', '-', 'setup', 'demo'], Edit: ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'duplicate', 'delete', '-', 'palette'], Object: ['group', 'ungroup', '-', 'front', 'back', 'forward', 'backward', '-', 'expand', 'outline-stroke', 'simplify', 'close-path', '-', 'boolean-union', 'boolean-subtract', 'boolean-intersect', 'boolean-xor', '-', 'flip-h', 'flip-v', 'lock', 'unlock-all'], Type: ['tool-text', 'focus-type', 'bold', 'italic'], Select: ['select-all', 'deselect', 'invert-selection', 'same-fill'], View: ['zoom-in', 'zoom-out', 'fit-board', 'fit-all', 'fit-selection', 'actual-size', '-', 'outline', 'trim', 'grid', 'grid-snap', 'smart-guides', 'show-guides', 'lock-guides', 'clear-guides'], Window: ['properties', 'layers', 'history', 'hide-panels', '-', 'theme'], Help: ['shortcuts', 'diagnostics', 'about'] }; $('menus').innerHTML = Object.keys(this.menuDefinitions).map(name => `<button class="menu-trigger" data-menu="${name}" aria-haspopup="menu" aria-expanded="false">${name}</button>`).join(''); }
        buildTools() { $('tool-grid').innerHTML = TOOLS.map(([id, ic, key]) => `<button class="tool-button ${id === this.editor.tool ? 'active' : ''}" data-tool="${id}" title="${esc(V.toolInfo[id][0])}${key ? ' (' + key + ')' : ''}" aria-label="${esc(V.toolInfo[id][0])}" aria-pressed="${id === this.editor.tool}">${V.icon(ic)}</button>`).join(''); }
        updateToolUI() { for (let b of document.querySelectorAll('[data-tool]')) {
            let on = b.dataset.tool === this.editor.tool;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on);
        } let [name, description] = V.toolInfo[this.editor.tool]; $('status-tool').textContent = name; $('status-description').textContent = description; }
        showMenu(name, items, anchor, x = null, y = null) { const pop = $('menu-popover'); pop.innerHTML = items.map(id => { if (id === '-')
            return '<div class="menu-separator"></div>'; let c = this.commands.get(id); if (!c)
            return ''; return `<button class="menu-item" role="menuitem" data-cmd="${id}" ${c.enabled() ? '' : 'disabled'}>${V.icon(c.icon)}<span class="menu-label">${esc(c.label)}</span><span class="menu-shortcut">${esc(c.shortcut)}</span></button>`; }).join(''); pop.hidden = false; let r = anchor?.getBoundingClientRect(); let left = x ?? r?.left ?? innerWidth - 310, top = y ?? r?.bottom ?? 88; pop.style.left = Math.min(Math.max(5, left), innerWidth - pop.offsetWidth - 8) + 'px'; pop.style.top = Math.min(Math.max(5, top + 3), innerHeight - pop.offsetHeight - 8) + 'px'; pop.dataset.menu = name; document.querySelectorAll('[data-menu]').forEach(b => { let on = b.dataset.menu === name; b.classList.toggle('open', on); b.setAttribute('aria-expanded', on); }); }
        closePopovers() { $('menu-popover').hidden = true; $('color-popover').hidden = true; document.querySelectorAll('[data-menu]').forEach(b => { b.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); }); }
        contextMenu(event) { const n = this.editor.hit(this.editor.world(event)); if (n && !this.store.selection.has(n.id))
            this.store.select(this.editor.idsFor(n)); this.showMenu('Context', this.store.selection.size ? ['copy', 'cut', 'duplicate', 'delete', '-', 'group', 'ungroup', '-', 'front', 'back', 'expand', '-', 'fit-selection'] : ['paste', 'new-board', 'fit-all', '-', 'grid', 'smart-guides'], null, event.clientX, event.clientY); }
        setTab(tab) { if (!['properties', 'layers', 'history'].includes(tab))
            return; this.currentTab = tab; for (let name of ['properties', 'layers', 'history'])
            $(name + '-panel').hidden = name !== tab; document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab)); if (this.uiHidden)
            this.togglePanels(); this.refreshUI(); }
        togglePanels() { this.uiHidden = !this.uiHidden; document.querySelector('.inspector').style.display = this.uiHidden ? 'none' : ''; document.querySelector('.panel-rail').style.display = this.uiHidden ? 'none' : ''; this.resize(); }
        toast(message, error = false) { let el = document.createElement('div'); el.className = 'toast' + (error ? ' error' : ''); el.textContent = message; $('toast-region').append(el); setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 250); }, error ? 7000 : 3700); }
        bind() {
            document.addEventListener('click', event => { const t = event.target; if (t.closest('[data-close]')) {
                $('modal').close();
                return;
            } const tool = t.closest('[data-tool]'); if (tool) {
                this.editor.setTool(tool.dataset.tool);
                return;
            } const tab = t.closest('[data-tab]'); if (tab) {
                this.setTab(tab.dataset.tab);
                return;
            } const menu = t.closest('button[data-menu]'); if (menu) {
                if (!$('menu-popover').hidden && $('menu-popover').dataset.menu === menu.dataset.menu)
                    this.closePopovers();
                else
                    this.showMenu(menu.dataset.menu, this.menuDefinitions[menu.dataset.menu], menu);
                return;
            } const cmd = t.closest('[data-cmd]'); if (cmd) {
                if (!cmd.disabled)
                    this.run(cmd.dataset.cmd);
                return;
            } const swatch = t.closest('[data-swatch]'); if (swatch) {
                this.applyPaint(swatch.dataset.swatch, event.shiftKey ? 'stroke' : swatch.dataset.target || this.colorTarget || 'fill');
                return;
            } const paint = t.closest('[data-paint]'); if (paint) {
                this.colorPopover(paint.dataset.paint, paint);
                return;
            } const board = t.closest('[data-board]'); if (board) {
                this.store.activeArtboard = board.dataset.board;
                this.editor.fitBoard();
                this.refreshUI();
                return;
            } if (!t.closest('#color-popover') && !t.closest('#menu-popover'))
                this.closePopovers(); });
            for (let [id, target] of [['top-fill', 'fill'], ['tool-fill', 'fill'], ['top-stroke', 'stroke'], ['tool-stroke', 'stroke']])
                $(id).addEventListener('click', event => { event.stopPropagation(); this.colorPopover(target, $(id)); });
            $('document-tab').addEventListener('click', () => this.renameDialog('Document name', this.store.doc.name, value => this.store.mutate('Rename document', () => this.store.doc.name = value)));
            $('top-stroke-width').addEventListener('change', event => { this.strokeWidth = Math.max(0, Math.min(2000, Number(event.target.value) || 0)); this.editSelected('Stroke width', n => n.strokeWidth = this.strokeWidth); this.refreshUI(); });
            $('top-opacity').addEventListener('change', event => this.setOpacity(Number(event.target.value)));
            $('zoom-select').addEventListener('change', event => { this.camera.zoomAt(Number(event.target.value) / 100 / this.camera.zoom, V.pt(this.camera.width / 2, this.camera.height / 2)); this.invalidate(); });
            $('board-select').addEventListener('change', event => { this.store.activeArtboard = event.target.value; this.editor.fitBoard(); this.refreshUI(); });
            $('properties-panel').addEventListener('change', event => { const prop = event.target.dataset.prop; if (prop)
                this.applyProperty(prop, event.target.type === 'checkbox' ? event.target.checked : event.target.value); if (event.target.dataset.live === 'opacity') {
                this.store.history.commit();
                this.refreshUI();
            } });
            $('properties-panel').addEventListener('input', event => { if (event.target.dataset.live === 'opacity') {
                this.store.history.begin('Change opacity');
                let value = Math.max(0, Math.min(100, Number(event.target.value)));
                for (let n of this.store.selected)
                    if (!this.store.isLocked(n))
                        n.opacity = value / 100;
                this.store.emit('gesture');
                $('top-opacity').value = value;
                let number = $('properties-panel').querySelector('[data-prop="opacity"]');
                if (number)
                    number.value = value;
            } });
            $('properties-panel').addEventListener('click', event => { let b = event.target.closest('[data-constrain]'); if (b) {
                this.constrain = !this.constrain;
                this.renderProperties();
            } let mode = event.target.closest('[data-fill-mode]'); if (mode) {
                if (mode.dataset.fillMode === 'none')
                    this.applyPaint('none');
                else if (mode.dataset.fillMode === 'gradient')
                    this.run('gradient');
                else
                    this.run('solid');
            } });
            $('layer-search').addEventListener('input', () => this.renderLayers());
            $('layers-tree').addEventListener('click', event => this.layerClick(event));
            $('layers-tree').addEventListener('dblclick', event => { let row = event.target.closest('[data-node-id],[data-layer-id]'); if (!row)
                return; let obj = row.dataset.nodeId ? this.store.doc.nodes.find(n => n.id === row.dataset.nodeId) : this.store.doc.layers.find(n => n.id === row.dataset.layerId); if (obj)
                this.renameDialog('Rename ' + (row.dataset.nodeId ? 'object' : 'layer'), obj.name, name => this.store.mutate('Rename ' + (row.dataset.nodeId ? 'object' : 'layer'), () => obj.name = name)); });
            $('layers-tree').addEventListener('dragstart', event => { let row = event.target.closest('[data-node-id]'); if (!row)
                return; this.draggingNode = row.dataset.nodeId; event.dataTransfer.setData('text/plain', this.draggingNode); event.dataTransfer.effectAllowed = 'move'; });
            $('layers-tree').addEventListener('dragover', event => { if (!this.draggingNode)
                return; event.preventDefault(); document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); event.target.closest('.layer-row')?.classList.add('drag-over'); });
            $('layers-tree').addEventListener('dragend', () => { this.draggingNode = null; document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); });
            $('layers-tree').addEventListener('drop', event => { if (!this.draggingNode)
                return; event.preventDefault(); let row = event.target.closest('.layer-row'), id = this.draggingNode; this.draggingNode = null; if (!row)
                return; let n = this.store.doc.nodes.find(n => n.id === id), target = row.dataset.nodeId ? this.store.doc.nodes.find(n => n.id === row.dataset.nodeId) : null, layerId = target?.layerId || row.dataset.layerId; if (!n || !layerId || target?.id === id || this.store.isLocked(n) || this.store.doc.layers.find(l => l.id === layerId)?.locked)
                return; this.store.mutate('Reorder object', () => { this.store.doc.nodes = this.store.doc.nodes.filter(a => a.id !== id); n.layerId = layerId; if (target) {
                let index = this.store.doc.nodes.indexOf(target);
                this.store.doc.nodes.splice(index + 1, 0, n);
            }
            else
                this.store.doc.nodes.push(n); }); });
            $('history-panel').addEventListener('click', event => { const b = event.target.closest('[data-history-index]'); if (!b)
                return; let target = Number(b.dataset.historyIndex); while (this.store.history.index > target)
                this.store.history.undo(); while (this.store.history.index < target)
                this.store.history.redo(); });
            $('file-input').addEventListener('change', async (event) => { for (let [i, file] of [...event.target.files].entries())
                await this.importFile(file, this.placeMode || i > 0); event.target.value = ''; });
            this.dom.stage.addEventListener('dragover', event => { if (![...event.dataTransfer.types].includes('Files'))
                return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; $('drop-overlay').hidden = false; });
            this.dom.stage.addEventListener('dragleave', event => { if (!this.dom.stage.contains(event.relatedTarget))
                $('drop-overlay').hidden = true; });
            this.dom.stage.addEventListener('drop', async (event) => { event.preventDefault(); $('drop-overlay').hidden = true; for (let file of event.dataTransfer.files)
                await this.importFile(file, true, this.editor.world(event)); });
            document.addEventListener('keydown', event => this.keyDown(event));
            document.addEventListener('keyup', event => { if (event.code === 'Space') {
                this.editor.space = false;
                this.editor.updateCursor();
            } });
            window.addEventListener('blur', () => { this.editor.space = false; this.editor.updateCursor(); });
            $('modal').addEventListener('click', event => { if (event.target === $('modal')) {
                const r = $('modal').getBoundingClientRect();
                if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)
                    $('modal').close();
            } });
        }
        keyDown(event) {
            if ($('modal').open)
                return;
            const form = event.target.closest('input,textarea,select,[contenteditable="true"]');
            if (form)
                return;
            const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
            if (mod) {
                let id = null;
                if (key === 'z')
                    id = event.shiftKey ? 'redo' : 'undo';
                else if (key === 'y')
                    id = 'outline';
                else if (key === 's')
                    id = 'save';
                else if (key === 'o')
                    id = 'open';
                else if (key === 'n')
                    id = 'new';
                else if (key === 'a')
                    id = 'select-all';
                else if (key === 'c')
                    id = 'copy';
                else if (key === 'x')
                    id = 'cut';
                else if (key === 'v')
                    id = 'paste';
                else if (key === 'd')
                    id = 'duplicate';
                else if (key === 'g')
                    id = event.shiftKey ? 'ungroup' : 'group';
                else if (key === 'k')
                    id = 'palette';
                else if (key === 'e' && event.shiftKey)
                    id = 'export';
                else if (key === '0')
                    id = event.altKey ? 'fit-all' : 'fit-board';
                else if (key === '1')
                    id = 'actual-size';
                else if (key === '2')
                    id = 'lock';
                else if (key === 'u')
                    id = 'smart-guides';
                else if (key === "'")
                    id = 'grid';
                else if (key === ']')
                    id = event.shiftKey ? 'front' : 'forward';
                else if (key === '[')
                    id = event.shiftKey ? 'back' : 'backward';
                else if (key === '+' || key === '=')
                    id = 'zoom-in';
                else if (key === '-')
                    id = 'zoom-out';
                if (id) {
                    event.preventDefault();
                    this.run(id);
                }
                return;
            }
            if (event.code === 'Space') {
                event.preventDefault();
                this.editor.space = true;
                this.editor.updateCursor();
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                this.closePopovers();
                if (this.editor.pen)
                    this.editor.finishPen();
                else if (this.editor.gesture)
                    this.editor.cancel();
                else
                    this.store.select([]);
                return;
            }
            if (event.key === 'Enter' && this.editor.pen) {
                event.preventDefault();
                this.editor.finishPen();
                return;
            }
            if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                this.editor.deleteSelection();
                return;
            }
            if (event.key.startsWith('Arrow')) {
                event.preventDefault();
                let g = this.editor.gesture;
                if (g?.kind === 'draw' && ['star', 'polygon'].includes(g.n.type)) {
                    g.n.sides = Math.max(3, Math.min(64, g.n.sides + (['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1)));
                    this.store.emit('gesture');
                    return;
                }
                let d = event.shiftKey ? 10 : 1, dx = event.key === 'ArrowLeft' ? -d : event.key === 'ArrowRight' ? d : 0, dy = event.key === 'ArrowUp' ? -d : event.key === 'ArrowDown' ? d : 0;
                if (this.store.selection.size)
                    this.store.mutate('Nudge objects', () => this.store.transformSelected(V.translate(dx, dy)));
                return;
            }
            if (event.key === 'Tab' && event.target === this.dom.overlay) {
                event.preventDefault();
                this.togglePanels();
                return;
            }
            let id = { v: 'select', a: 'direct', p: 'pen', n: 'pencil', t: 'text', '\\': 'line', m: 'rect', l: 'ellipse', s: 'star', b: 'brush', e: 'erase', g: 'gradient', i: 'eyedropper', o: 'artboard', r: 'rotate', h: 'hand', z: 'zoom' }[key];
            if (id) {
                event.preventDefault();
                this.editor.setTool(id);
                return;
            }
            if (key === 'd')
                this.run('default-paint');
            else if (key === 'x')
                this.run('swap-paint');
            else if (key === '/')
                this.run('no-fill');
            else if (key === '+' || key === '=')
                this.run('zoom-in');
            else if (key === '-')
                this.run('zoom-out');
            else if (key === 'f')
                this.run('fit-all');
        }
        paintCSS(fill) { return fill === 'none' ? 'linear-gradient(135deg,#fff 44%,#e95757 45%,#e95757 55%,#fff 56%)' : typeof fill === 'object' ? `linear-gradient(${(fill.angle || 0) + 90}deg,${fill.color0},${fill.color1})` : fill; }
        paintChip(el, fill) { if (!el)
            return; el.style.background = this.paintCSS(fill); el.classList.toggle('no-paint', fill === 'none'); }
        refreshUI() { const nodes = this.store.selected, n = nodes[0]; if (n) {
            this.fill = V.clone(n.fill);
            this.stroke = n.stroke;
            this.strokeWidth = n.strokeWidth;
        } $('context-type').textContent = nodes.length > 1 ? 'Mixed objects' : n ? (n.type === 'path' ? 'Path' : n.type[0].toUpperCase() + n.type.slice(1)) : 'No selection'; this.paintChip($('top-fill-chip'), this.fill); this.paintChip($('top-stroke-chip'), this.stroke); this.paintChip($('tool-fill'), this.fill); this.paintChip($('tool-stroke'), this.stroke); if (document.activeElement !== $('top-stroke-width'))
            $('top-stroke-width').value = round(this.strokeWidth, 2); if (document.activeElement !== $('top-opacity'))
            $('top-opacity').value = round((n?.opacity ?? this.opacity) * 100, 1); $('document-title').textContent = this.store.doc.name; document.title = this.store.doc.name + ' — Vectora'; $('board-select').innerHTML = this.store.doc.artboards.map((b, i) => `<option value="${esc(b.id)}" ${b.id === this.store.activeArtboard ? 'selected' : ''}>${String(i + 1).padStart(2, '0')} · ${esc(b.name)}</option>`).join(''); if (this.currentTab === 'properties')
            this.renderProperties(); if (this.currentTab === 'layers')
            this.renderLayers(); if (this.currentTab === 'history')
            this.renderHistory(); for (let el of document.querySelectorAll('button[data-cmd]')) {
            let command = this.commands.get(el.dataset.cmd);
            if (command)
                el.disabled = !command.enabled();
        } this.updateToolUI(); }
        field(prop, label, value, extra = '') { return `<label><span>${label}</span><input data-prop="${prop}" type="number" value="${round(value, 2)}" aria-label="${esc(prop)}" ${extra}></label>`; }
        renderProperties() {
            let panel = $('properties-panel'), s = this.store, n = s.selected[0], count = s.selection.size, b = s.selectionBounds(), board = s.activeBoard, html = '';
            if (!n) {
                html += `<section class="panel-section"><div class="eyebrow">YOUR CANVAS, YOUR RULES</div><div class="document-heading">${esc(s.doc.name)}</div><div class="document-subtitle">${s.doc.artboards.length} artboards · ${s.doc.nodes.length} editable objects<br>A little less ordinary. A little more you.</div><span class="document-tag">RGB / sRGB</span></section>`;
                html += `<section class="panel-section"><h3 class="section-title">Document ${V.icon('sliders')}</h3><div class="field-grid">${this.field('board-width', 'W', board.w, 'min="1" max="100000"')}${this.field('board-height', 'H', board.h, 'min="1" max="100000"')}</div><div class="appearance-row" style="margin-top:13px;margin-bottom:0"><label><input type="color" data-prop="board-color" value="${esc(/^#[\da-f]{6}$/i.test(board.background) ? board.background : '#ffffff')}" style="width:22px;height:22px;padding:1px">Artboard color</label><span class="paint-name">px</span></div><button class="section-action" data-cmd="setup">Document setup ${V.icon('chevronRight')}</button></section>`;
            }
            else {
                html += `<section class="panel-section"><div class="eyebrow">${count > 1 ? 'MULTIPLE OBJECTS' : n.type.toUpperCase()}</div><div class="document-heading" style="font-size:14px">${count > 1 ? count + ' objects selected' : esc(n.name)}</div><div class="document-subtitle">${count > 1 ? 'Transform and style your selection together.' : esc(s.doc.layers.find(l => l.id === n.layerId)?.name || 'Layer 1')}</div></section>`;
                let angle = Math.atan2(n.matrix[1], n.matrix[0]) * 180 / Math.PI;
                html += `<section class="panel-section"><h3 class="section-title">Transform</h3><div class="field-grid">${this.field('x', 'X', b.x)}${this.field('y', 'Y', b.y)}${this.field('width', 'W', b.w, 'min="0.01"')}${this.field('height', 'H', b.h, 'min="0.01"')}</div><div class="transform-bottom"><label>${V.icon('rotate')}<input data-prop="rotation" aria-label="Rotation degrees" type="number" value="${round(angle, 1)}">°</label><span class="menu-spacer"></span><button data-constrain="true" class="${this.constrain ? 'on' : ''}" title="Constrain proportions" aria-pressed="${this.constrain}">${V.icon('link')}</button><button data-cmd="flip-h" title="Reflect horizontally">${V.icon('flipH')}</button><button data-cmd="flip-v" title="Reflect vertically">${V.icon('flipV')}</button></div>${n.type === 'rect' ? `<div class="field-grid" style="margin-top:11px">${this.field('radius', 'R', n.radius || 0, 'min="0"')}<span class="dim" style="font-size:9px;padding-top:7px">Corner radius</span></div>` : ''}${['star', 'polygon'].includes(n.type) ? `<div class="field-grid" style="margin-top:11px">${this.field('sides', 'N', n.sides || 5, 'min="3" max="64"')}${n.type === 'star' ? this.field('innerRatio', '%', (n.innerRatio || .45) * 100, 'min="1" max="99"') : ''}</div>` : ''}</section>`;
            }
            let fill = n?.fill ?? this.fill, stroke = n?.stroke ?? this.stroke, op = (n?.opacity ?? this.opacity) * 100, fillName = typeof fill === 'object' ? 'Linear gradient' : fill === 'none' ? 'None' : fill.toUpperCase();
            html += `<section class="panel-section"><h3 class="section-title">Appearance${!n ? '<span class="count">Default</span>' : ''}</h3><div class="appearance-row"><button class="paint-picker-button" data-paint="fill" title="Fill color"><span class="paint-chip" style="background:${esc(this.paintCSS(fill))}"></span></button><span>Fill</span><span class="paint-name">${esc(fillName)}</span></div><div class="appearance-row"><button class="paint-picker-button" data-paint="stroke" title="Stroke color"><span class="paint-chip stroke-chip" style="background:${esc(this.paintCSS(stroke))}"></span></button><span>Stroke</span><span class="menu-spacer"></span><input data-prop="strokeWidth" aria-label="Stroke width" type="number" min="0" max="2000" step=".5" value="${round(n?.strokeWidth ?? this.strokeWidth, 2)}"><span class="percent">px</span></div>${n ? `<div class="opacity-row"><span>Opacity</span><input data-live="opacity" aria-label="Opacity slider" type="range" min="0" max="100" value="${round(op)}"><label><input data-prop="opacity" aria-label="Opacity percent" type="number" min="0" max="100" value="${round(op)}">%</label></div>` : ''}<div class="segmented"><button data-fill-mode="solid" class="${typeof fill === 'string' && fill !== 'none' ? 'active' : ''}">Solid</button><button data-fill-mode="gradient" class="${typeof fill === 'object' ? 'active' : ''}">Gradient</button><button data-fill-mode="none" class="${fill === 'none' ? 'active' : ''}">None</button></div>${typeof fill === 'object' ? `<div class="gradient-row"><input type="color" data-prop="gradient0" aria-label="Gradient start color" value="${esc(fill.color0)}"><span class="gradient-preview" style="background:${esc(this.paintCSS(fill))}"></span><input type="color" data-prop="gradient1" aria-label="Gradient end color" value="${esc(fill.color1)}"><input type="number" data-prop="gradientAngle" aria-label="Gradient angle" value="${round(fill.angle)}"><span class="dim">°</span></div>` : ''}${n && stroke !== 'none' ? `<div class="stroke-options"><select data-prop="lineJoin" aria-label="Stroke join">${['round', 'miter', 'bevel'].map(v => `<option ${n.lineJoin === v ? 'selected' : ''}>${v}</option>`).join('')}</select><select data-prop="lineCap" aria-label="Stroke cap">${['round', 'butt', 'square'].map(v => `<option ${n.lineCap === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>` : ''}</section>`;
            if (n?.type === 'text') {
                let families = ['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana', 'Courier New'];
                if (!families.includes(n.fontFamily))
                    families.push(n.fontFamily);
                html += `<section class="panel-section" id="character-section"><h3 class="section-title">Character</h3><div class="field-column"><select data-prop="fontFamily" aria-label="Font family">${families.map(f => `<option ${n.fontFamily === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select><div class="field-grid">${this.field('fontSize', 'T', n.fontSize, 'min="1" max="2048"')}<select data-prop="fontWeight" aria-label="Font weight">${[[400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']].map(([v, l]) => `<option value="${v}" ${Number(n.fontWeight) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${this.field('lineHeight', '↕', n.lineHeight, 'min="0.5" max="5" step=".05"')}${this.field('letterSpacing', '↔', n.letterSpacing, 'min="-20" max="100" step=".2"')}</div><textarea data-prop="text" aria-label="Text content" rows="3">${esc(n.text)}</textarea></div><div class="quick-actions" style="margin-top:10px"><button data-cmd="bold">Bold</button><button data-cmd="italic">Italic</button></div></section>`;
            }
            if (n) {
                html += `<section class="panel-section"><h3 class="section-title">Align</h3><div class="align-buttons">${[['left', 'alignLeft'], ['center', 'alignCenter'], ['right', 'alignRight'], ['top', 'alignTop'], ['middle', 'alignMiddle'], ['bottom', 'alignBottom']].map(([v, ic]) => `<button data-cmd="align-${v}" title="${v}">${V.icon(ic)}</button>`).join('')}</div><div class="align-note">Align to ${count === 1 ? 'active artboard' : 'selection'}</div></section><section class="panel-section" id="pathfinder-section"><h3 class="section-title">Pathfinder</h3><div class="pathfinder-buttons">${[['union', 'Unite'], ['subtract', 'Minus'], ['intersect', 'Intersect'], ['xor', 'Exclude']].map(([v, label]) => `<button data-cmd="boolean-${v}" ${count < 2 ? 'disabled' : ''} title="${label}">${V.icon(v)}<span>${label}</span></button>`).join('')}</div>${n.type === 'path' ? `<div class="field-column" style="margin-top:12px"><label><span>Fill rule</span><select data-prop="fillRule" aria-label="Fill rule"><option value="nonzero" ${n.fillRule === 'nonzero' ? 'selected' : ''}>Nonzero</option><option value="evenodd" ${n.fillRule === 'evenodd' ? 'selected' : ''}>Even-odd</option></select></label></div>` : ''}</section>`;
            }
            html += `<section class="panel-section" id="swatches-section"><h3 class="section-title">Swatches<span class="count">Studio palette</span></h3><div class="swatch-grid">${SWATCHES.map(color => `<button data-swatch="${color}" data-target="fill" title="${color} · Shift for stroke" class="${fill === color ? 'current' : ''}" style="background:${color}"></button>`).join('')}</div><div class="swatch-caption">Warm forms. Earthy colors. Endless possibility.</div></section>`;
            html += `<section class="panel-section"><h3 class="section-title">Artboards<span class="count">${s.doc.artboards.length}</span></h3>${s.doc.artboards.map((b, i) => `<button class="artboard-row ${b.id === s.activeArtboard ? 'active' : ''}" data-board="${esc(b.id)}"><span class="board-thumb" style="background:${esc(b.background)}"></span><span class="board-row-text"><strong>${esc(b.name.replace(/^\d+\s*[—–-]\s*/, ''))}</strong><small>${round(b.w)} × ${round(b.h)} px</small></span><span class="board-index">${String(i + 1).padStart(2, '0')}</span></button>`).join('')}<button class="section-action" data-cmd="new-board">${V.icon('plus')}Add artboard</button></section><section class="panel-section"><h3 class="section-title">Quick actions</h3><div class="quick-actions"><button data-cmd="${n ? 'expand' : 'fit-all'}">${n ? 'Expand shapes' : 'Fit all artboards'}</button><button data-cmd="export">Export artwork</button><button data-cmd="grid">${this.renderer.grid ? 'Hide' : 'Show'} grid</button><button data-cmd="smart-guides">Guides: ${this.smartGuides ? 'on' : 'off'}</button></div></section>`;
            let scroll = panel.scrollTop;
            panel.innerHTML = html;
            panel.scrollTop = scroll;
        }
        renderLayers() { const query = $('layer-search').value.toLowerCase(), s = this.store; let html = ''; for (let layer of [...s.doc.layers].reverse()) {
            let ns = s.doc.nodes.filter(n => n.layerId === layer.id && (!query || n.name.toLowerCase().includes(query))).reverse(), expanded = this.expanded.has(layer.id) || !!query;
            if (query && !ns.length && !layer.name.toLowerCase().includes(query))
                continue;
            html += `<div class="layer-row layer-header ${s.activeLayer === layer.id ? 'active-layer' : ''}" data-layer-id="${esc(layer.id)}"><button data-layer-eye="${esc(layer.id)}" class="${layer.visible === false ? 'visible-off' : ''}" title="Toggle layer visibility">${V.icon('eye')}</button><button data-layer-lock="${esc(layer.id)}" title="${layer.locked ? 'Unlock' : 'Lock'} layer">${V.icon(layer.locked ? 'lock' : 'unlock')}</button><button data-layer-collapse="${esc(layer.id)}" title="Expand or collapse">${V.icon(expanded ? 'chevronDown' : 'chevronRight')}</button><span class="layer-color" style="background:${esc(layer.color)}"></span><span class="layer-name">${esc(layer.name)}</span><span class="layer-counter">${s.doc.nodes.filter(n => n.layerId === layer.id).length}</span></div>`;
            if (expanded)
                for (let n of ns)
                    html += `<div class="layer-row node-row ${s.selection.has(n.id) ? 'selected' : ''}" data-node-id="${esc(n.id)}" draggable="${!s.isLocked(n)}"><button data-node-eye="${esc(n.id)}" class="${n.visible === false ? 'visible-off' : ''}" title="Toggle object visibility">${V.icon('eye')}</button><button data-node-lock="${esc(n.id)}" class="${n.locked ? '' : 'visible-off'}" title="${n.locked ? 'Unlock' : 'Lock'} object">${V.icon(n.locked ? 'lock' : 'unlock')}</button><span class="layer-node-icon">${V.icon(n.type === 'text' ? 'type' : n.type === 'path' ? 'path' : n.type)}</span><span class="layer-name">${esc(n.name)}</span>${n.groupId ? '<span class="layer-counter">G</span>' : ''}<span class="layer-target"></span></div>`;
        } if (!html)
            html = '<div class="empty-panel">No matching objects.</div>'; $('layers-tree').innerHTML = html; $('layer-count').textContent = s.doc.layers.length + ' layers · ' + s.doc.nodes.length + ' objects'; }
        layerClick(event) { let target = event.target, ds = target.closest('button')?.dataset || {}, s = this.store; if (ds.layerCollapse) {
            this.expanded.has(ds.layerCollapse) ? this.expanded.delete(ds.layerCollapse) : this.expanded.add(ds.layerCollapse);
            this.renderLayers();
            return;
        } for (let [key, collection, prop, label] of [['layerEye', 'layers', 'visible', 'Toggle layer visibility'], ['layerLock', 'layers', 'locked', 'Toggle layer lock'], ['nodeEye', 'nodes', 'visible', 'Toggle object visibility'], ['nodeLock', 'nodes', 'locked', 'Toggle object lock']])
            if (ds[key]) {
                let obj = s.doc[collection].find(n => n.id === ds[key]);
                if (!obj)
                    return;
                s.mutate(label, () => { obj[prop] = prop === 'visible' ? obj[prop] === false : !obj[prop]; if ((prop === 'visible' && obj[prop] === false) || (prop === 'locked' && obj[prop]))
                    for (let n of s.doc.nodes)
                        if (collection === 'nodes' ? n.id === obj.id : n.layerId === obj.id)
                            s.selection.delete(n.id); });
                return;
            } let row = target.closest('[data-node-id],[data-layer-id]'); if (!row)
            return; if (row.dataset.nodeId) {
            let n = s.doc.nodes.find(n => n.id === row.dataset.nodeId);
            if (!n || s.isLocked(n))
                return;
            s.activeLayer = n.layerId;
            if (event.shiftKey) {
                let ids = new Set(s.selection);
                ids.has(n.id) ? ids.delete(n.id) : ids.add(n.id);
                s.select([...ids]);
            }
            else
                s.select(this.editor.idsFor(n));
        }
        else {
            s.activeLayer = row.dataset.layerId;
            this.renderLayers();
        } }
        renderHistory() { let h = this.store.history, html = `<div class="panel-section"><h3 class="section-title">History<span class="count">${h.index} / ${h.entries.length}</span></h3><div class="document-subtitle">One step per completed gesture.<br>Click a step to return to that state.</div></div><button class="history-row ${h.index === 0 ? 'current' : ''}" data-history-index="0">${V.icon('file')}Initial document</button>`; h.entries.forEach((e, i) => html += `<button class="history-row ${h.index === i + 1 ? 'current' : ''} ${i >= h.index ? 'future' : ''}" data-history-index="${i + 1}">${V.icon('history')}<span>${esc(e.label)}</span></button>`); if (!h.entries.length)
            html += '<div class="empty-panel"><strong>Make your first mark.</strong>Your edits will appear here. Undo and redo are available throughout the editor.</div>'; $('history-panel').innerHTML = html; }
        editSelected(label, fn) { if (!this.store.selection.size) {
            this.refreshUI();
            return;
        } this.store.mutate(label, () => { for (let n of this.store.selected)
            if (!this.store.isLocked(n))
                fn(n); }); }
        applyPaint(paint, target = 'fill') { if (target === 'stroke' && typeof paint === 'object')
            paint = paint.color0; if (target === 'fill')
            this.fill = V.clone(paint);
        else
            this.stroke = paint; this.editSelected('Change ' + target, n => n[target] = V.clone(paint)); this.refreshUI(); this.invalidate(); }
        setOpacity(value) { value = Math.max(0, Math.min(100, Number(value) || 0)); this.opacity = value / 100; this.editSelected('Change opacity', n => n.opacity = value / 100); this.refreshUI(); }
        applyProperty(prop, raw) {
            let value = Number(raw), s = this.store, b = s.selectionBounds(), n = s.selected[0];
            try {
                if (prop === 'board-color') {
                    s.mutate('Artboard background', () => s.activeBoard.background = raw);
                    return;
                }
                if (prop === 'board-width' || prop === 'board-height') {
                    if (!Number.isFinite(value) || value < 1 || value > 100000)
                        throw Error('Artboard dimensions must be between 1 and 100,000 px.');
                    s.mutate('Resize artboard', () => s.activeBoard[prop === 'board-width' ? 'w' : 'h'] = value);
                    return;
                }
                if (prop === 'opacity') {
                    this.setOpacity(value);
                    return;
                }
                if (prop === 'strokeWidth') {
                    if (!Number.isFinite(value) || value < 0 || value > 2000)
                        throw Error('Stroke width must be between 0 and 2,000 px.');
                    this.strokeWidth = value;
                    this.editSelected('Stroke width', n => n.strokeWidth = value);
                    return;
                }
                if (prop.startsWith('gradient')) {
                    let fill = typeof (n?.fill ?? this.fill) === 'object' ? V.clone(n?.fill ?? this.fill) : { type: 'linear', color0: '#F4A27B', color1: '#344C3D', angle: 0 };
                    if (prop === 'gradient0')
                        fill.color0 = raw;
                    if (prop === 'gradient1')
                        fill.color1 = raw;
                    if (prop === 'gradientAngle') {
                        if (!Number.isFinite(value))
                            return;
                        fill.angle = value;
                    }
                    this.applyPaint(fill);
                    return;
                }
                if (!n)
                    return;
                if (['x', 'y', 'width', 'height', 'rotation', 'radius', 'sides', 'innerRatio', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'].includes(prop) && (!Number.isFinite(value) || Math.abs(value) > 1e7))
                    throw Error('Enter a finite numeric value.');
                if (prop === 'x' || prop === 'y') {
                    s.mutate('Position objects', () => s.transformSelected(V.translate(prop === 'x' ? value - b.x : 0, prop === 'y' ? value - b.y : 0)));
                    return;
                }
                if (prop === 'width' || prop === 'height') {
                    if (value <= 0)
                        throw Error('Dimensions must be greater than zero.');
                    let sx = prop === 'width' ? value / (b.w || 1) : 1, sy = prop === 'height' ? value / (b.h || 1) : 1;
                    if (this.constrain) {
                        if (prop === 'width')
                            sy = sx;
                        else
                            sx = sy;
                    }
                    s.mutate('Resize objects', () => s.transformSelected(V.around(V.scale(sx, sy), V.pt(b.x, b.y))));
                    return;
                }
                if (prop === 'rotation') {
                    let old = Math.atan2(n.matrix[1], n.matrix[0]), angle = value * Math.PI / 180 - old;
                    s.mutate('Rotate objects', () => s.transformSelected(V.around(V.rotate(angle), V.pt((b.x + b.x2) / 2, (b.y + b.y2) / 2))));
                    return;
                }
                this.editSelected('Change ' + prop, n => { if (['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'text'].includes(prop)) {
                    if (n.type !== 'text')
                        return;
                    n[prop] = ['text', 'fontFamily'].includes(prop) ? raw : value;
                    if (prop === 'text')
                        n.text = String(raw).slice(0, 100000);
                    V.measureText(n);
                }
                else if (prop === 'radius' && n.type === 'rect')
                    n.radius = Math.max(0, value);
                else if (prop === 'sides' && ['star', 'polygon'].includes(n.type))
                    n.sides = Math.max(3, Math.min(64, Math.round(value)));
                else if (prop === 'innerRatio' && n.type === 'star')
                    n.innerRatio = Math.max(.01, Math.min(.99, value / 100));
                else if (prop === 'fillRule')
                    n.fillRule = ['nonzero', 'evenodd'].includes(raw) ? raw : 'nonzero';
                else if (prop === 'lineCap')
                    n.lineCap = ['round', 'butt', 'square'].includes(raw) ? raw : 'round';
                else if (prop === 'lineJoin')
                    n.lineJoin = ['round', 'miter', 'bevel'].includes(raw) ? raw : 'round'; });
            }
            catch (e) {
                this.toast(e.message, true);
                this.refreshUI();
            }
        }
        flip(axis) { let b = this.store.selectionBounds(); if (!b)
            return; this.store.mutate('Reflect ' + (axis === 'x' ? 'horizontally' : 'vertically'), () => this.store.transformSelected(V.around(V.scale(axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1), V.pt((b.x + b.x2) / 2, (b.y + b.y2) / 2)))); }
        outlineStroke() { let ids = []; this.store.mutate('Outline stroke', () => { for (let n of [...this.store.selected]) {
            if (this.store.isLocked(n) || n.stroke === 'none' || !n.strokeWidth || ['text', 'image'].includes(n.type))
                continue;
            let polys = V.strokeOutline(V.flatten(V.shapePaths(n), .3), n.strokeWidth, n.lineJoin, n.lineCap), copy = V.node('path', { ...V.clone(n), id: V.uid(), name: n.name + ' · outlined stroke', paths: polys.map(p => ({ closed: true, points: p.points.map(p => V.anchor(p.x, p.y)) })), fill: n.stroke, stroke: 'none' });
            if (n.fill === 'none')
                this.store.doc.nodes = this.store.doc.nodes.filter(a => a.id !== n.id);
            else
                n.stroke = 'none';
            this.store.doc.nodes.push(copy);
            ids.push(copy.id);
        } this.store.selection = new Set(ids); }); }
        simplifySelected() { this.store.mutate('Simplify paths', () => { for (let n of this.store.selected) {
            if (this.store.isLocked(n) || n.type !== 'path')
                continue;
            n.paths = V.flatten(n.paths, .35).map(p => { let ps = p.closed ? [...p.points, p.points[0]] : p.points, points = V.simplify(ps, 1); if (p.closed && points.length > 1 && V.dist(points[0], points.at(-1)) < .0001)
                points.pop(); return { closed: p.closed, points: points.map(a => V.anchor(a.x, a.y)) }; });
        } }); }
        addLayer() { this.store.mutate('Add layer', () => { let n = this.store.doc.layers.length + 1, id = V.uid('layer'); this.store.doc.layers.push({ id, name: 'Layer ' + n, color: ['#88BCA4', '#D398CA', '#7BA9FA', '#F6AA60'][n % 4], visible: true, locked: false }); this.store.activeLayer = id; this.expanded.add(id); }); this.setTab('layers'); }
        addBoard() { this.store.mutate('Add artboard', () => { let b = this.store.activeBoard, edge = Math.max(...this.store.doc.artboards.map(a => a.x + a.w)), n = { id: V.uid('board'), name: 'Artboard ' + (this.store.doc.artboards.length + 1), x: edge + 70, y: b.y, w: b.w, h: b.h, background: b.background }; this.store.doc.artboards.push(n); this.store.activeArtboard = n.id; }); this.editor.fitAll(); }
        stepBoard(direction) { const bs = this.store.doc.artboards, index = bs.findIndex(b => b.id === this.store.activeArtboard); this.store.activeArtboard = bs[(index + direction + bs.length) % bs.length].id; this.editor.fitBoard(); this.refreshUI(); }
        colorPopover(target, anchor) { this.colorTarget = target; const pop = $('color-popover'), n = this.store.selected[0], paint = n?.[target] ?? this[target], color = typeof paint === 'object' ? paint.color0 : paint === 'none' ? '#EB713F' : paint, rgb = V.rgba(color), hex = '#' + rgb.slice(0, 3).map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); pop.innerHTML = `<h3>${target === 'fill' ? 'Fill' : 'Stroke'} color</h3><input id="color-native" type="color" value="${hex}" aria-label="Choose ${target} color"><div class="color-fields"><span class="dim">HEX</span><input id="color-hex" value="${hex.toUpperCase()}" aria-label="Hex color" maxlength="9"><button id="color-apply" title="Apply color">${V.icon('check')}</button></div><div class="swatch-grid">${SWATCHES.slice(0, 24).map(color => `<button data-swatch="${color}" data-target="${target}" style="background:${color}" title="${color}"></button>`).join('')}</div><button id="color-none" class="section-action">${V.icon('erase')}No ${target}</button>`; pop.hidden = false; let r = anchor.getBoundingClientRect(); pop.style.left = Math.max(8, Math.min(innerWidth - 252, r.left)) + 'px'; pop.style.top = Math.max(8, Math.min(innerHeight - pop.offsetHeight - 40, r.bottom + 7)) + 'px'; $('color-native').addEventListener('change', event => { this.applyPaint(event.target.value, target); $('color-hex').value = event.target.value.toUpperCase(); }); const apply = () => { let value = $('color-hex').value.trim(); if (!value.startsWith('#'))
            value = '#' + value; if (!/^#[\da-f]{3}([\da-f]{3})?([\da-f]{2})?$/i.test(value)) {
            this.toast('Enter a hexadecimal color, for example #EB713F.', true);
            return;
        } this.applyPaint(value, target); }; $('color-apply').addEventListener('click', apply); $('color-hex').addEventListener('keydown', event => { if (event.key === 'Enter') {
            apply();
            this.closePopovers();
        } }); $('color-none').addEventListener('click', () => { this.applyPaint('none', target); this.closePopovers(); }); }
        save() { if (this.editor.pen)
            this.editor.finishPen(); if (this.editor.textNode)
            this.editor.finishText(); V.download(JSON.stringify(this.store.doc, null, 2), this.safeName() + '.vectora', 'application/json'); this.toast('Saved an editable .vectora document.'); }
        safeName() { return this.store.doc.name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled'; }
        copy() { if (!this.store.selection.size)
            return; this.clipboard = V.clone(this.store.selected); let svg = V.svgExport(this.store.doc, null, this.store.selection); navigator.clipboard?.writeText(svg).catch(() => { }); this.toast(this.clipboard.length + ' object' + (this.clipboard.length === 1 ? '' : 's') + ' copied.'); }
        async paste() {
            if (!this.clipboard?.length) {
                try {
                    let text = await navigator.clipboard.readText();
                    if (text.includes('<svg')) {
                        const { doc, warnings } = V.importSVG(text, 'Pasted artwork');
                        this.placeDocument(doc);
                        if (warnings.length)
                            this.toast(warnings.join(' '), true);
                        return;
                    }
                    if (text) {
                        this.store.mutate('Paste text', () => { let b = this.store.activeBoard, n = V.node('text', { text: text.slice(0, 100000), name: 'Pasted text', fontSize: 32, fontFamily: 'Arial', fontWeight: 400, lineHeight: 1.12, fill: typeof this.fill === 'string' && this.fill !== 'none' ? this.fill : '#344C3D', matrix: V.translate(b.x + 50, b.y + 50) }); V.measureText(n); this.store.add(n); this.store.selection = new Set([n.id]); });
                        return;
                    }
                }
                catch { }
                throw Error('Copy an object first. Clipboard access may require HTTPS and browser permission.');
            }
            this.store.mutate('Paste objects', () => { let ids = [], groups = new Map(); for (let old of this.clipboard) {
                let n = V.clone(old);
                n.id = V.uid();
                n.name += ' copy';
                n.matrix = V.matrix(V.translate(20, 20), n.matrix);
                if (n.groupId) {
                    if (!groups.has(n.groupId))
                        groups.set(n.groupId, V.uid('group'));
                    n.groupId = groups.get(n.groupId);
                }
                if (!this.store.doc.layers.some(l => l.id === n.layerId))
                    n.layerId = this.store.activeLayer;
                if (!this.store.doc.artboards.some(b => b.id === n.artboardId))
                    n.artboardId = this.store.activeArtboard;
                this.store.doc.nodes.push(n);
                ids.push(n.id);
            } this.store.selection = new Set(ids); });
        }
        openFile(place) { this.placeMode = place; $('file-input').click(); }
        async importFile(file, place = false, point = null) { try {
            if (file.size > 30 * 1024 * 1024)
                throw Error('Files are limited to 30 MB.');
            let ext = file.name.split('.').at(-1).toLowerCase();
            if (['ai', 'pdf', 'eps', 'psd'].includes(ext))
                throw Error('Native ' + ext.toUpperCase() + ' import is not implemented. Export the artwork as SVG first.');
            if (ext === 'svg' || file.type === 'image/svg+xml') {
                let { doc, warnings } = V.importSVG(await file.text(), file.name);
                if (place)
                    this.placeDocument(doc, point);
                else
                    this.loadDocument(doc);
                if (warnings.length)
                    this.warningDialog('SVG import notes', warnings);
                else
                    this.toast('SVG imported as editable vector objects.');
            }
            else if (['vectora', 'json'].includes(ext)) {
                let doc = V.validateDocument(JSON.parse(await file.text()));
                place ? this.placeDocument(doc, point) : this.loadDocument(doc);
                this.toast('Vectora document opened.');
            }
            else if (/^image\/(png|jpeg|webp|gif)$/.test(file.type) || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
                const src = await new Promise((resolve, reject) => { let r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(file); }), img = await new Promise((resolve, reject) => { let img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(Error('The image could not be decoded.')); img.src = src; });
                if (img.naturalWidth * img.naturalHeight > 64000000)
                    throw Error('Images are limited to 64 megapixels.');
                let b = this.store.activeBoard, scale = Math.min(1, b.w * .75 / img.naturalWidth, b.h * .75 / img.naturalHeight), w = img.naturalWidth * scale, h = img.naturalHeight * scale, at = point || V.pt(b.x + (b.w - w) / 2, b.y + (b.h - h) / 2);
                this.store.mutate('Place image', () => { let n = V.node('image', { name: file.name, src, w, h, fill: 'none', matrix: V.translate(at.x, at.y) }); this.store.add(n); this.store.selection = new Set([n.id]); });
                this.editor.setTool('select');
                this.toast('Embedded image placed.');
            }
            else
                throw Error('Use SVG, .vectora, PNG, JPEG, WebP, or GIF.');
        }
        catch (e) {
            this.toast(e.message || 'Unable to import file.', true);
        } }
        placeDocument(doc, point = null) { if (this.store.doc.layers.find(l => l.id === this.store.activeLayer)?.locked)
            throw Error('Unlock the active layer before placing artwork.'); let b = V.unionBounds(doc.artboards.map(b => ({ x: b.x, y: b.y, x2: b.x + b.w, y2: b.y + b.h }))), board = this.store.activeBoard, at = point || V.pt(board.x + (board.w - b.w) / 2, board.y + (board.h - b.h) / 2), groups = new Map(), ids = []; this.store.mutate('Place vector artwork', () => { for (let source of doc.nodes) {
            let n = V.clone(source);
            n.id = V.uid();
            n.layerId = this.store.activeLayer;
            n.artboardId = this.store.activeArtboard;
            n.matrix = V.matrix(V.translate(at.x - b.x, at.y - b.y), n.matrix);
            if (n.groupId) {
                if (!groups.has(n.groupId))
                    groups.set(n.groupId, V.uid('group'));
                n.groupId = groups.get(n.groupId);
            }
            this.store.doc.nodes.push(n);
            ids.push(n.id);
        } this.store.selection = new Set(ids); }); this.editor.setTool('select'); }
        showDialog(title, subtitle, body, footer = '') { const modal = $('modal'); if (modal.open)
            modal.close(); modal.className = ''; $('modal-content').innerHTML = `<div class="modal-header"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="close" data-close title="Close">${V.icon('close')}</button></div><div class="modal-body">${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}`; modal.showModal(); }
        renameDialog(title, value, apply) { this.showDialog(title, 'Give your work a name.', `<div class="field-column"><input id="rename-value" value="${esc(value)}" maxlength="200" aria-label="Name"></div>`, '<button class="button" data-close>Cancel</button><button class="button primary" id="rename-confirm">Save name</button>'); let input = $('rename-value'); input.focus(); input.select(); const save = () => { let name = input.value.trim(); if (!name)
            return; apply(name); $('modal').close(); this.refreshUI(); }; $('rename-confirm').onclick = save; input.onkeydown = e => { if (e.key === 'Enter')
            save(); }; }
        newDialog() { this.showDialog('Make something yours.', 'A blank canvas. An open possibility.', `<div class="preset-grid"><button class="preset-card" data-size="1200,1600">${V.icon('file')}<strong>Editorial</strong><small>1200 × 1600 px</small></button><button class="preset-card" data-size="1080,1080">${V.icon('phone')}<strong>Social</strong><small>1080 × 1080 px</small></button><button class="preset-card active" data-size="1440,900">${V.icon('monitor')}<strong>Digital</strong><small>1440 × 900 px</small></button></div><div class="field-column"><label><span>Name</span><input id="new-name" value="Untitled" maxlength="200"></label><div class="field-grid"><label><span>W</span><input id="new-width" type="number" value="1440" min="1" max="100000"></label><label><span>H</span><input id="new-height" type="number" value="900" min="1" max="100000"></label></div><label><span>Background</span><input id="new-color" type="color" value="#F2EFE5" style="max-width:100px"></label></div><div class="modal-note">New documents use <strong>sRGB and pixel units</strong>. Save a .vectora file to keep a separate copy of your current workspace.</div>`, '<button class="button" data-close>Cancel</button><button class="button primary" id="create-document">Create document</button>'); document.querySelectorAll('[data-size]').forEach(button => button.onclick = () => { let [w, h] = button.dataset.size.split(','); $('new-width').value = w; $('new-height').value = h; document.querySelectorAll('[data-size]').forEach(el => el.classList.toggle('active', el === button)); }); $('create-document').onclick = () => { let w = Number($('new-width').value), h = Number($('new-height').value); if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 100000 || h > 100000) {
            this.toast('Enter dimensions from 1 to 100,000 px.', true);
            return;
        } let d = V.blankDocument(w, h, $('new-name').value.trim() || 'Untitled'); d.artboards[0].background = $('new-color').value; this.loadDocument(d); $('modal').close(); this.toast('Your new canvas is ready.'); }; }
        replaceDialog() { this.showDialog('Open the studio example?', 'The example replaces this workspace.', `<div class="modal-note">Save your current artwork as a <strong>.vectora</strong> file before opening the three-artboard <em>Form &amp; Feeling</em> example. Every shape and every line of text in the example is editable.</div>`, '<button class="button" data-close>Cancel</button><button class="button" id="save-example-current">Save current</button><button class="button primary" id="open-example">Open example</button>'); $('save-example-current').onclick = () => this.save(); $('open-example').onclick = () => { this.loadDocument(V.demoDocument()); $('modal').close(); }; }
        setupDialog() { let b = this.store.activeBoard; this.showDialog('Document setup', 'Edit the active artboard and document name.', `<div class="field-column"><label><span>Document</span><input id="setup-name" value="${esc(this.store.doc.name)}" maxlength="200"></label><label><span>Artboard</span><input id="setup-board" value="${esc(b.name)}" maxlength="200"></label><div class="field-grid"><label><span>W</span><input id="setup-width" type="number" min="1" value="${round(b.w)}"></label><label><span>H</span><input id="setup-height" type="number" min="1" value="${round(b.h)}"></label></div><label><span>Background</span><input type="color" id="setup-color" value="${esc(/^#[\da-f]{6}$/i.test(b.background) ? b.background : '#ffffff')}" style="max-width:100px"></label></div><div class="modal-note"><strong>sRGB · Pixel coordinates</strong><br>Resizing an artboard does not scale its artwork. Use selection transforms to scale objects.</div>`, '<button class="button" data-close>Cancel</button><button class="button primary" id="setup-apply">Apply changes</button>'); $('setup-apply').onclick = () => { let w = Number($('setup-width').value), h = Number($('setup-height').value); if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 100000 || h > 100000) {
            this.toast('Enter dimensions from 1 to 100,000 px.', true);
            return;
        } this.store.mutate('Document setup', () => { this.store.doc.name = $('setup-name').value.trim() || 'Untitled'; b.name = $('setup-board').value.trim() || 'Artboard'; b.w = w; b.h = h; b.background = $('setup-color').value; }); $('modal').close(); }; }
        exportDialog() { if (this.editor.pen)
            this.editor.finishPen(); if (this.editor.textNode)
            this.editor.finishText(); this.showDialog('Ready for the world.', 'Export your artwork, or keep an editable source file.', `<div class="field-column"><label><span>Format</span><select id="export-format"><option value="svg">SVG — editable vector artwork</option><option value="png">PNG — high-resolution image</option><option value="vectora">Vectora — complete source document</option></select></label><label id="export-board-row"><span>Artboard</span><select id="export-board"><option value="all">All artboards</option>${this.store.doc.artboards.map(b => `<option value="${esc(b.id)}" ${b.id === this.store.activeArtboard ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label><div id="png-options" hidden><label><span>Resolution</span><select id="export-scale"><option value="1">1× — original size</option><option value="2" selected>2× — double resolution</option><option value="4">4× — quadruple resolution</option></select></label><label style="margin-top:13px"><span></span><input type="checkbox" id="export-transparent" style="flex:none;width:14px;height:14px">Transparent background</label></div><label id="svg-options" style="align-items:flex-start"><input type="checkbox" id="export-metadata" style="flex:none;width:14px;height:14px;margin:0"><span style="font-size:10px;line-height:1.6">Embed Vectora source metadata in all-artboard SVG.<br>Includes hidden objects and layer data.</span></label></div><div class="modal-note" id="export-note">SVG preserves vector paths and live text. Matching fonts must be available wherever the file is opened. Native AI, PDF and CMYK export are not part of this build.</div>`, '<button class="button" data-close>Cancel</button><button class="button primary" id="export-confirm">Export artwork</button>'); $('export-format').onchange = () => { let f = $('export-format').value; $('png-options').hidden = f !== 'png'; $('svg-options').hidden = f !== 'svg'; $('export-board-row').hidden = f === 'vectora'; $('export-note').textContent = f === 'png' ? 'PNG is rendered with the Canvas 2D export backend. Up to 64 megapixels; larger exports are rejected before allocation.' : f === 'vectora' ? 'The complete source document preserves editable shapes, text, gradients, images, artboards, layers and groups.' : 'SVG preserves vector paths and live text. Matching fonts must be available wherever the file is opened. Native AI, PDF and CMYK export are not part of this build.'; }; $('export-confirm').onclick = async () => { const button = $('export-confirm'); button.disabled = true; button.textContent = 'Exporting…'; try {
            let format = $('export-format').value, choice = $('export-board').value, board = choice === 'all' ? null : this.store.doc.artboards.find(b => b.id === choice), name = this.safeName() + (board ? ' — ' + board.name.replace(/[\\/:*?"<>|]/g, '-') : '');
            if (format === 'vectora')
                this.save();
            else if (format === 'svg') {
                V.download(V.svgExport(this.store.doc, board, null, $('export-metadata').checked), name + '.svg', 'image/svg+xml');
                this.toast('Editable SVG exported.');
            }
            else {
                let bb = board || { ...V.unionBounds(this.store.doc.artboards.map(b => ({ x: b.x, y: b.y, x2: b.x + b.w, y2: b.y + b.h }))), all: true }, blob = await this.renderer.exportPNG(bb, Number($('export-scale').value), $('export-transparent').checked);
                if (!blob)
                    throw Error('The browser could not encode this image.');
                V.download(blob, name + '.png');
                this.toast('PNG exported.');
            }
            $('modal').close();
        }
        catch (e) {
            this.toast(e.message, true);
        }
        finally {
            button.disabled = false;
            button.textContent = 'Export artwork';
        } }; }
        warningDialog(title, warnings) { this.showDialog(title, 'The supported artwork was imported. Review these conversions.', `<div class="modal-note">${warnings.map(esc).join('<br><br>')}</div>`, '<button class="button primary" data-close>Continue editing</button>'); }
        shortcutDialog() { const pairs = [['Selection', 'V'], ['Direct selection', 'A'], ['Pen / freehand', 'P / N'], ['Rectangle / ellipse', 'M / L'], ['Text / brush', 'T / B'], ['Star / artboards', 'S / O'], ['Rotate / gradient', 'R / G'], ['Pan temporarily', 'Hold Space'], ['Zoom', 'Mouse wheel'], ['Horizontal pan', 'Shift + wheel'], ['Constrain gesture', 'Shift'], ['Duplicate while dragging', 'Alt / Option'], ['Undo', 'Ctrl / ⌘ Z'], ['Redo', 'Ctrl / ⌘ Shift Z'], ['Select all', 'Ctrl / ⌘ A'], ['Group / ungroup', 'Ctrl / ⌘ G / Shift G'], ['Save / open', 'Ctrl / ⌘ S / O'], ['Command search', 'Ctrl / ⌘ K'], ['Finish pen path', 'Enter'], ['Insert anchor', 'A + double-click'], ['Delete selection', 'Delete / Backspace'], ['Nudge / larger nudge', 'Arrows / Shift'], ['Outline view', 'Ctrl / ⌘ Y'], ['Fit artboard / all', 'Ctrl / ⌘ 0 / Alt 0']]; this.showDialog('Find your flow.', 'The familiar gestures, with a few useful extras.', `<div class="shortcut-grid">${pairs.map(([label, key]) => `<div><span>${esc(label)}</span><kbd>${esc(key)}</kbd></div>`).join('')}</div><div class="modal-note">Drag from a ruler to create a guide. In Direct Selection, drag a handle with Alt to break symmetry; double-click an anchor to toggle smooth / corner. A selected shape becomes a path when you edit an anchor.</div>`, '<button class="button primary" data-close>Back to creating</button>'); }
        diagnostics() { let r = this.renderer, s = r.stats; this.showDialog('Under the canvas', 'Live renderer and document diagnostics.', `<dl class="diagnostics"><dt>Active backend</dt><dd>${esc(r.outline ? 'Canvas 2D (outline mode)' : r.mode)}</dd><dt>Adapter</dt><dd>${esc(r.adapterInfo || r.reason || 'Unavailable')}</dd><dt>Antialiasing</dt><dd>${r.mode === 'WebGPU' && !r.outline ? '4× multisample rendering' : 'Browser Canvas 2D rasterizer'}</dd><dt>Visible draw calls</dt><dd>${s.draws}</dd><dt>Submitted vertices</dt><dd>${s.vertices.toLocaleString()}</dd><dt>Last CPU submission</dt><dd>${round(s.frameMs, 2)} ms (not a GPU benchmark)</dd><dt>Text / image textures</dt><dd>${round(s.textureMB || 0, 2)} MiB</dd><dt>Geometry worker</dt><dd>${r.meshes.worker ? 'Dedicated Web Worker' : 'Main-thread fallback'}</dd><dt>Document</dt><dd>${this.store.doc.nodes.length} objects · ${this.store.doc.artboards.length} artboards</dd><dt>Undo storage</dt><dd>${this.store.history.entries.length} steps · ${round(this.store.history.bytes / 1048576, 2)} MiB</dd><dt>Rendering model</dt><dd>Retained triangle meshes, affine uniforms, viewport culling and coalesced worker jobs.</dd></dl><div class="modal-note">Vector fills, gradients, strokes and image quads use WebGPU when available. Text is shaped and rasterized by the browser, cached in textures, then composited by WebGPU. Panels, rulers and selection handles are not GPU-rendered.</div>`, '<button class="button primary" data-close>Done</button>'); }
        about() { this.showDialog('', '', `<div class="about-brand"><span class="brand-mark"><svg viewBox="0 0 28 28"><path d="M4 6h5l5 14 5-14h5l-8 19h-4z" fill="currentColor" stroke="none"/></svg></span><div><strong>Vectora<span style="color:var(--accent)">.</span></strong><small>VECTOR DESIGN STUDIO / 0.1</small></div></div><div class="document-subtitle" style="font-size:12px;line-height:1.9">A local-first, Illustrator-inspired vector workspace.<br>Plain HTML. Plain JavaScript. Real editable artwork.<br>No account, no CDN, no runtime dependencies.</div><div class="modal-note"><strong>This is an independent implementation, not Adobe Illustrator.</strong><br><br>This build supports Bézier editing, shape tools, text, affine transforms, layers, flat groups, winding-rule fills, strokes, two-stop linear gradients, path operations, SVG, embedded images and source-file persistence.<br><br>Not implemented: AI/PDF/EPS formats, CMYK/ICC print workflows, gradient meshes, pattern fills, masks, filters, isolated group compositing, text-on-path, variable-font controls, plug-ins, and full SVG/CSS fidelity.</div>`, '<button class="button" data-cmd="diagnostics">Renderer details</button><button class="button primary" data-close>Keep creating</button>'); }
        palette() { let modal = $('modal'); if (modal.open)
            modal.close(); modal.className = 'palette-dialog'; $('modal-content').innerHTML = '<input id="command-search" class="command-search" placeholder="What would you like to do?" aria-label="Search commands" autocomplete="off"><div id="command-results" class="command-results"></div><div class="palette-footer">Enter runs the first result · Esc closes · All commands operate on your current document</div>'; const render = () => { let q = $('command-search').value.toLowerCase(), matches = [...this.commands.values()].filter(c => c.id !== 'palette' && c.label.toLowerCase().includes(q)).slice(0, 30); $('command-results').innerHTML = matches.map(c => `<button class="menu-item" data-palette-cmd="${c.id}" ${c.enabled() ? '' : 'disabled'}>${V.icon(c.icon)}<span class="menu-label">${esc(c.label)}</span><span class="menu-shortcut">${esc(c.shortcut)}</span></button>`).join('') || '<div class="empty-panel">No matching commands.</div>'; }; modal.showModal(); render(); $('command-search').focus(); $('command-search').oninput = render; $('command-search').onkeydown = event => { if (event.key === 'Enter') {
            let first = $('command-results').querySelector('button:not(:disabled)');
            if (first) {
                modal.close();
                this.run(first.dataset.paletteCmd);
            }
        } }; $('command-results').onclick = event => { let b = event.target.closest('[data-palette-cmd]'); if (b && !b.disabled) {
            modal.close();
            this.run(b.dataset.paletteCmd);
        } }; }
    }
    V.App = App;
    window.vectora = new App();
})();

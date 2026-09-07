/* Versioned, serializable scene model. One undo transaction per completed gesture. */
'use strict';
(() => {
    const clone = x => JSON.parse(JSON.stringify(x)), uid = (prefix = 'n') => prefix + '_' + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
    function node(type, props = {}) { return { id: uid(), type, name: type[0].toUpperCase() + type.slice(1), matrix: V.ident(), fill: '#EB713F', stroke: 'none', strokeWidth: 2, opacity: 1, visible: true, locked: false, fillRule: 'nonzero', lineJoin: 'round', lineCap: 'round', layerId: 'artwork', artboardId: 'board1', ...props, type }; }
    let measuring;
    function measureText(n) { n.fontSize = Math.max(1, Math.min(2048, Number(n.fontSize) || 32)); n.lineHeight = Math.max(.5, Math.min(5, Number(n.lineHeight) || 1.12)); n.letterSpacing = Math.max(-20, Math.min(100, Number(n.letterSpacing) || 0)); if (typeof document === 'undefined')
        return; const ctx = measuring || (measuring = document.createElement('canvas').getContext('2d')); ctx.font = `${n.fontStyle || 'normal'} ${n.fontWeight || 400} ${n.fontSize}px ${n.fontFamily || 'Arial'}`; const lines = String(n.text || '').split('\n'); n.w = Math.max(4, ...lines.map(l => ctx.measureText(l).width + Math.max(0, l.length - 1) * n.letterSpacing)); n.h = Math.max(n.fontSize * 1.2, lines.length * n.fontSize * n.lineHeight); }
    class History {
        constructor(store) { this.store = store; this.entries = []; this.index = 0; this.before = null; this.limit = 60; this.maxBytes = 32 * 1024 * 1024; this.bytes = 0; }
        begin(label) { if (this.before !== null)
            return; this.before = JSON.stringify(this.store.doc); this.label = label; }
        commit() { if (this.before === null)
            return false; const after = JSON.stringify(this.store.doc), before = this.before; this.before = null; if (before === after)
            return false; for (const e of this.entries.splice(this.index))
            this.bytes -= e.bytes; let e = { before, after, label: this.label, bytes: (before.length + after.length) * 2 }; this.entries.push(e); this.bytes += e.bytes; this.index = this.entries.length; while (this.entries.length > 1 && (this.entries.length > this.limit || this.bytes > this.maxBytes)) {
            this.bytes -= this.entries.shift().bytes;
            this.index--;
        } this.store.emit('commit'); return true; }
        cancel() { if (this.before !== null) {
            this.store.doc = JSON.parse(this.before);
            this.before = null;
            this.store.cleanSelection();
            this.store.emit('history');
        } }
        undo() { if (this.before !== null)
            this.commit(); if (!this.index)
            return; this.store.doc = JSON.parse(this.entries[--this.index].before); this.store.cleanSelection(); this.store.emit('history'); }
        redo() { if (this.before !== null)
            this.commit(); if (this.index >= this.entries.length)
            return; this.store.doc = JSON.parse(this.entries[this.index++].after); this.store.cleanSelection(); this.store.emit('history'); }
        clear() { this.entries = []; this.index = 0; this.bytes = 0; this.before = null; }
    }
    class DocumentStore extends EventTarget {
        constructor(doc) { super(); this.doc = doc; this.selection = new Set(); this.activeLayer = doc.layers.find(l => l.id === 'artwork')?.id || doc.layers.at(-1).id; this.activeArtboard = doc.artboards[0].id; this.history = new History(this); this.revision = 0; this.index = new V.SpatialIndex(); this.reindex(); }
        emit(kind = 'change') { this.revision++; if (kind !== 'selection')
            this.reindex(); this.dispatchEvent(new CustomEvent('change', { detail: { kind, revision: this.revision } })); }
        get selected() { return this.doc.nodes.filter(n => this.selection.has(n.id)); }
        get activeBoard() { return this.doc.artboards.find(b => b.id === this.activeArtboard) || this.doc.artboards[0]; }
        get visibleNodes() { return this.doc.layers.flatMap(l => l.visible === false ? [] : this.doc.nodes.filter(n => n.layerId === l.id && n.visible !== false)); }
        isLocked(n) { return n.locked || this.doc.layers.find(l => l.id === n.layerId)?.locked; }
        select(ids, add = false) { if (!add)
            this.selection.clear(); for (let id of ids)
            this.selection.add(id); this.emit('selection'); }
        cleanSelection() { this.selection = new Set([...this.selection].filter(id => this.doc.nodes.some(n => n.id === id))); if (!this.doc.layers.some(l => l.id === this.activeLayer))
            this.activeLayer = this.doc.layers.at(-1).id; if (!this.doc.artboards.some(b => b.id === this.activeArtboard))
            this.activeArtboard = this.doc.artboards[0].id; }
        reindex() { this.index.reset(this.visibleNodes.map((n, order) => { let b = V.worldBounds(n), sw = n.stroke !== 'none' ? (n.strokeWidth || 0) * Math.max(Math.hypot(n.matrix[0], n.matrix[1]), Math.hypot(n.matrix[2], n.matrix[3])) / 2 : 0; return { id: n.id, node: n, order, bounds: { x: b.x - sw, y: b.y - sw, x2: b.x2 + sw, y2: b.y2 + sw } }; })); }
        mutate(label, fn) { this.history.begin(label); try {
            fn();
            this.cleanSelection();
            this.emit();
            this.history.commit();
        }
        catch (e) {
            this.history.cancel();
            throw e;
        } }
        add(n) { n.layerId = this.activeLayer; n.artboardId = this.activeArtboard; this.doc.nodes.push(n); return n; }
        delete() { if (!this.selection.size)
            return; this.mutate('Delete objects', () => { this.doc.nodes = this.doc.nodes.filter(n => !this.selection.has(n.id) || this.isLocked(n)); this.selection.clear(); }); }
        duplicate(offset = 20) { let ids = []; this.mutate('Duplicate objects', () => { const groups = new Map(); for (let n of this.selected) {
            if (this.isLocked(n))
                continue;
            let c = clone(n);
            c.id = uid();
            c.name = n.name + ' copy';
            c.matrix = V.matrix(V.translate(offset, offset), c.matrix);
            if (c.groupId) {
                if (!groups.has(c.groupId))
                    groups.set(c.groupId, uid('group'));
                c.groupId = groups.get(c.groupId);
            }
            this.doc.nodes.push(c);
            ids.push(c.id);
        } this.selection = new Set(ids); }); return ids; }
        group() { if (this.selection.size < 2)
            return; this.mutate('Group objects', () => { let id = uid('group'); for (let n of this.selected)
            if (!this.isLocked(n))
                n.groupId = id; }); }
        ungroup() { this.mutate('Ungroup objects', () => { for (let n of this.selected)
            if (!this.isLocked(n))
                delete n.groupId; }); }
        arrange(where) { this.mutate('Arrange objects', () => { let nodes = this.doc.nodes, sel = this.selection; if (where === 'front' || where === 'back') {
            let a = nodes.filter(n => sel.has(n.id)), b = nodes.filter(n => !sel.has(n.id));
            this.doc.nodes = where === 'front' ? [...b, ...a] : [...a, ...b];
        }
        else if (where === 'forward') {
            for (let i = nodes.length - 2; i >= 0; i--)
                if (sel.has(nodes[i].id) && !sel.has(nodes[i + 1].id))
                    [nodes[i], nodes[i + 1]] = [nodes[i + 1], nodes[i]];
        }
        else
            for (let i = 1; i < nodes.length; i++)
                if (sel.has(nodes[i].id) && !sel.has(nodes[i - 1].id))
                    [nodes[i], nodes[i - 1]] = [nodes[i - 1], nodes[i]]; }); }
        transformSelected(m) { for (let n of this.selected)
            if (!this.isLocked(n))
                n.matrix = V.matrix(m, n.matrix); this.emit(); }
        selectionBounds() { return this.selected.length ? V.unionBounds(this.selected.map(V.worldBounds)) : null; }
        align(mode) { if (!this.selection.size)
            return; this.mutate('Align ' + mode, () => { let nodes = this.selected.filter(n => !this.isLocked(n)), board = this.activeBoard, box = nodes.length === 1 ? { x: board.x, y: board.y, x2: board.x + board.w, y2: board.y + board.h } : this.selectionBounds(); for (let n of nodes) {
            let b = V.worldBounds(n), dx = 0, dy = 0;
            if (mode === 'left')
                dx = box.x - b.x;
            if (mode === 'center')
                dx = (box.x + box.x2 - b.x - b.x2) / 2;
            if (mode === 'right')
                dx = box.x2 - b.x2;
            if (mode === 'top')
                dy = box.y - b.y;
            if (mode === 'middle')
                dy = (box.y + box.y2 - b.y - b.y2) / 2;
            if (mode === 'bottom')
                dy = box.y2 - b.y2;
            n.matrix = V.matrix(V.translate(dx, dy), n.matrix);
        } }); }
        distribute(axis) { if (this.selected.length < 3)
            return; this.mutate('Distribute objects', () => { let ns = this.selected.filter(n => !this.isLocked(n)).map(n => ({ n, b: V.worldBounds(n) })).sort((a, b) => a.b[axis] - b.b[axis]), first = ns[0].b[axis], last = ns.at(-1).b[axis], step = (last - first) / (ns.length - 1); ns.forEach(({ n, b }, i) => { let d = first + i * step - b[axis]; n.matrix = V.matrix(V.translate(axis === 'x' ? d : 0, axis === 'y' ? d : 0), n.matrix); }); }); }
        convertToPath() { this.mutate('Expand shapes', () => { for (let n of this.selected)
            if (!this.isLocked(n) && n.type !== 'text' && n.type !== 'image') {
                n.paths = clone(V.shapePaths(n));
                n.type = 'path';
            } }); }
        boolean(op) { let ns = this.selected.filter(n => !this.isLocked(n) && n.type !== 'text' && n.type !== 'image'); if (ns.length < 2)
            throw Error('Select at least two vector shapes.'); this.mutate('Pathfinder: ' + op, () => { let paths = V.transformPaths(V.shapePaths(ns[0]), ns[0].matrix); for (let n of ns.slice(1))
            paths = V.booleanPaths(paths, V.transformPaths(V.shapePaths(n), n.matrix), op, ns[0].fillRule, n.fillRule); let ids = new Set(ns.map(n => n.id)), result = node('path', { ...clone(ns[0]), id: uid(), name: { union: 'United shape', subtract: 'Subtracted shape', intersect: 'Intersection', xor: 'Excluded shape' }[op], paths, matrix: V.ident(), groupId: undefined }); this.doc.nodes = this.doc.nodes.filter(n => !ids.has(n.id)); if (paths.length) {
            this.doc.nodes.push(result);
            this.selection = new Set([result.id]);
        }
        else
            this.selection.clear(); }); }
    }
    function validColor(value, allowNone = true) { return typeof value === 'string' && value.length <= 160 && (allowNone && value === 'none' || (!/[;<>]|url\s*\(|var\s*\(/i.test(value) && (globalThis.CSS?.supports ? CSS.supports('color', value) : /^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([\w\s.,%+\-/]+\))$/i.test(value)))); }
    function validateDocument(raw) { if (!raw || raw.format !== 'vectora' || raw.version !== 1 || !Array.isArray(raw.nodes) || !Array.isArray(raw.artboards) || !Array.isArray(raw.layers))
        throw Error('Not a supported Vectora document.'); if (raw.nodes.length > 10000 || raw.artboards.length > 100 || !raw.artboards.length || !raw.layers.length)
        throw Error('Document exceeds supported limits.'); const doc = clone(raw), ids = new Set(), finite = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7; let anchors = 0; for (let l of doc.layers) {
        if (!validColor(l.color || '#80ADFF', false))
            throw Error('Invalid layer color.');
    } for (let b of doc.artboards) {
        if (!validColor(b.background || '#FFFFFF', false))
            throw Error('Invalid artboard color.');
        if (![b.x, b.y, b.w, b.h].every(finite) || b.w < 1 || b.h < 1)
            throw Error('Invalid artboard dimensions.');
    } for (let n of doc.nodes) {
        if (ids.has(n.id) || typeof n.id !== 'string')
            throw Error('Invalid or duplicate node ID.');
        ids.add(n.id);
        if (!['rect', 'ellipse', 'polygon', 'star', 'path', 'line', 'text', 'image'].includes(n.type))
            throw Error('Unsupported node type.');
        if (!Array.isArray(n.matrix) || n.matrix.length !== 6 || !n.matrix.every(finite))
            throw Error('Invalid transformation.');
        if (!doc.layers.some(l => l.id === n.layerId))
            n.layerId = doc.layers[0].id;
        if (!doc.artboards.some(b => b.id === n.artboardId))
            n.artboardId = doc.artboards[0].id;
        for (let k of ['w', 'h', 'radius', 'sides', 'innerRatio'])
            if (n[k] !== undefined && !finite(n[k]))
                throw Error('Invalid geometry.');
        if (n.paths && !Array.isArray(n.paths))
            throw Error('Invalid path list.');
        for (let p of n.paths || []) {
            if (!Array.isArray(p.points))
                throw Error('Invalid anchors.');
            anchors += p.points.length;
            for (let a of p.points)
                for (let q of [a, a.in, a.out].filter(Boolean))
                    if (!finite(q.x) || !finite(q.y))
                        throw Error('Invalid path coordinates.');
        }
        if (n.type === 'image' && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(n.src || ''))
            throw Error('Only embedded raster images are accepted.');
        if (n.type === 'text') {
            n.text = String(n.text || '').slice(0, 100000);
            measureText(n);
        }
        n.opacity = Number.isFinite(Number(n.opacity)) ? Math.max(0, Math.min(1, Number(n.opacity))) : 1;
        n.strokeWidth = Math.max(0, Math.min(2000, Number(n.strokeWidth) || 0));
        if (typeof n.fill === 'object' && n.fill) {
            if (n.fill.type !== 'linear' || typeof n.fill.color0 !== 'string' || typeof n.fill.color1 !== 'string')
                throw Error('Invalid gradient.');
            if (!validColor(n.fill.color0, false) || !validColor(n.fill.color1, false))
                throw Error('Invalid gradient colors.');
            n.fill.angle = Number(n.fill.angle) || 0;
        }
        else if (typeof n.fill !== 'string')
            n.fill = 'none';
        if (typeof n.fill === 'string' && !validColor(n.fill))
            throw Error('Invalid fill color.');
        if (typeof n.stroke !== 'string')
            n.stroke = 'none';
        if (!validColor(n.stroke))
            throw Error('Invalid stroke color.');
    } if (anchors > 200000)
        throw Error('Document exceeds 200,000 anchors.'); doc.name = String(doc.name || 'Untitled').slice(0, 200); return doc; }
    function blankDocument(w = 1200, h = 800, name = 'Untitled') { return { format: 'vectora', version: 1, name, colorSpace: 'sRGB', artboards: [{ id: 'board1', name: 'Artboard 1', x: 0, y: 0, w, h, background: '#FFFFFF' }], layers: [{ id: 'artwork', name: 'Layer 1', color: '#7BA9FA', visible: true, locked: false }], nodes: [] }; }
    function demoDocument() {
        let d = blankDocument(720, 840, 'Form & Feeling'), nodes = d.nodes;
        d.artboards = [{ id: 'board1', name: '01 — Editorial poster', x: 0, y: 0, w: 720, h: 840, background: '#F2EFE5' }, { id: 'board2', name: '02 — Social / Olive', x: 790, y: 0, w: 380, h: 390, background: '#344C3D' }, { id: 'board3', name: '03 — Social / Apricot', x: 790, y: 450, w: 380, h: 390, background: '#F4A27B' }];
        d.layers = [{ id: 'background', name: 'Background elements', color: '#B294E8', visible: true, locked: false }, { id: 'artwork', name: 'Sculptural forms', color: '#F6AA60', visible: true, locked: false }, { id: 'type', name: 'Typography', color: '#8CBCA5', visible: true, locked: false }];
        const shape = (type, x, y, w, h, fill, extra = {}) => { let n = node(type, { w, h, fill, matrix: V.translate(x, y), ...extra }); nodes.push(n); return n; }, text = (text, x, y, size, fill, extra = {}) => { let n = node('text', { text, fontSize: size, fontFamily: 'Arial', fontWeight: 400, lineHeight: 1.05, letterSpacing: 0, fill, matrix: V.translate(x, y), layerId: 'type', ...extra }); measureText(n); nodes.push(n); return n; }, path = (name, paths, fill, extra = {}) => { let n = node('path', { name, paths, fill, ...extra }); nodes.push(n); return n; };
        text('F/F', 44, 33, 24, '#344C3D', { fontWeight: 800, name: 'Studio monogram' });
        text('AN INDEPENDENT STUDY OF FORM', 330, 42, 10, '#344C3D', { letterSpacing: 1.6, name: 'Edition header' });
        shape('line', 44, 82, 632, 0, 'none', { stroke: '#344C3D', strokeWidth: 1, layerId: 'background', name: 'Header divider' });
        text('FORM &', 38, 112, 107, '#2E4435', { fontWeight: 800, letterSpacing: -5, name: 'FORM &' });
        text('FEELING', 38, 217, 107, '#2E4435', { fontWeight: 800, letterSpacing: -5, name: 'FEELING' });
        text('A little less ordinary.\nA little more you.', 47, 341, 17, '#4C5E4D', { lineHeight: 1.4, name: 'Editorial subtitle' });
        text('EXPLORATION\nNO. 001', 547, 345, 11, '#344C3D', { lineHeight: 1.6, letterSpacing: 1.4, name: 'Exploration number' });
        let center = V.pt(366, 571), count = 12;
        for (let k = count - 1; k >= 0; k--) {
            let r = 49 + k * 11.5, ps = [];
            for (let i = 0; i < 64; i++) {
                let a = i * V.TAU / 64, rr = r * (1 + .16 * Math.cos(3 * a + .4) + .09 * Math.sin(5 * a - .7)), p = V.pt(Math.cos(a) * rr * 1.31, Math.sin(a) * rr * .84);
                p = V.transform(V.rotate(-.28), p);
                ps.push(V.add(center, p));
            }
            path('Contour ribbon ' + (k + 1), [V.smoothPath(ps, true, .17)], k % 2 ? '#EB713F' : '#F2EFE5', { layerId: 'artwork' });
        }
        shape('ellipse', 312, 532, 108, 108, { type: 'linear', color0: '#F7B084', color1: '#D74622', angle: 65 }, { name: 'Gradient core' });
        shape('ellipse', 350, 570, 29, 29, '#F2EFE5', { name: 'Core cutout' });
        shape('line', 44, 755, 632, 0, 'none', { stroke: '#344C3D', strokeWidth: 1, layerId: 'background', name: 'Footer divider' });
        text('THE BEAUTY OF BECOMING.', 45, 775, 11, '#344C3D', { fontWeight: 700, letterSpacing: 1.4, name: 'Footer caption' });
        text('VOL. 01  /  2026', 562, 775, 10, '#344C3D', { name: 'Edition' });
        text('F/F', 818, 25, 20, '#F2EFE5', { fontWeight: 800, artboardId: 'board2', name: 'Olive monogram' });
        text('STUDIES IN FORM', 986, 31, 8, '#DBE3CD', { letterSpacing: 1.5, artboardId: 'board2' });
        text('Good things\ntake shape.', 819, 90, 43, '#F2EFE5', { fontWeight: 700, letterSpacing: -1.6, lineHeight: 1.02, artboardId: 'board2', name: 'Social headline' });
        let star = shape('star', 1024, 215, 112, 112, '#F4A27B', { sides: 12, innerRatio: .45, name: 'Twelve-point burst', artboardId: 'board2' });
        star.matrix = V.matrix(star.matrix, V.around(V.rotate(.12), V.pt(56, 56)));
        text('MADE TO MOVE YOU.', 819, 343, 9, '#DBE3CD', { letterSpacing: 1.5, artboardId: 'board2' });
        text('F/F', 818, 473, 20, '#344C3D', { fontWeight: 800, artboardId: 'board3', name: 'Apricot monogram' });
        text('A DIFFERENT PERSPECTIVE', 982, 480, 7, '#344C3D', { letterSpacing: 1.1, artboardId: 'board3' });
        for (let i = 0; i < 6; i++) {
            let e = shape('ellipse', 846 + i * 17, 534 + i * 9, 188, 146, 'none', { stroke: '#FFF5E2', strokeWidth: 2.2, name: 'Orbit ' + (i + 1), artboardId: 'board3' });
            e.matrix = V.matrix(e.matrix, V.around(V.rotate(-.43), V.pt(94, 73)));
        }
        text('Less noise.\nMore meaning.', 819, 725, 29, '#344C3D', { fontWeight: 700, lineHeight: 1.05, letterSpacing: -.8, artboardId: 'board3', name: 'Apricot headline' });
        return d;
    }
    Object.assign(V, { validColor, clone, uid, node, measureText, History, DocumentStore, validateDocument, blankDocument, demoDocument });
})();

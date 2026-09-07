/* Pointer-driven editing state machine. Gestures are reversible transactions, not UI-only mocks. */
'use strict';
(() => {
    const toolInfo = { select: ['Selection', 'Click to select. Drag to move. Shift adds to selection.'], direct: ['Direct Selection', 'Drag anchors or Bézier handles. Double-click a segment to add an anchor.'], pen: ['Pen', 'Click for corners, drag for curves. Click the first point to close. Enter finishes.'], pencil: ['Pencil', 'Drag to draw a freehand path.'], brush: ['Paintbrush', 'Drag to draw a smooth, pressure-independent vector stroke.'], rect: ['Rectangle', 'Drag to draw. Shift constrains to a square.'], ellipse: ['Ellipse', 'Drag to draw. Shift constrains to a circle.'], polygon: ['Polygon', 'Drag to draw. Arrow keys change the number of sides.'], star: ['Star', 'Drag to draw. Arrow keys change the number of points.'], line: ['Line Segment', 'Drag to draw. Shift snaps to 45-degree angles.'], text: ['Type', 'Click to add editable text. Double-click existing text to edit.'], gradient: ['Gradient', 'Drag on a selected object to set its linear-gradient angle.'], eyedropper: ['Eyedropper', 'Click artwork to copy its fill and stroke to your selection.'], erase: ['Object Eraser', 'Drag over objects to delete them. This erases whole vector objects.'], artboard: ['Artboard', 'Drag an artboard to move it. Shift-drag creates a new artboard.'], hand: ['Hand', 'Drag to pan the canvas.'], zoom: ['Zoom', 'Click to zoom in. Alt-click to zoom out.'], rotate: ['Rotate', 'Drag to rotate the selection. Shift snaps to 15 degrees.'] };
    class Editor {
        constructor(app) { this.app = app; this.canvas = app.dom.overlay; this.tool = 'select'; this.space = false; this.gesture = null; this.pen = null; this.hover = null; this.pointer = V.pt(); this.snapLines = []; this.anchorSelection = null; this.textNode = null; this.canvas.addEventListener('pointerdown', e => this.down(e)); this.canvas.addEventListener('pointermove', e => this.move(e)); this.canvas.addEventListener('pointerup', e => this.up(e)); this.canvas.addEventListener('pointercancel', () => this.cancel()); this.canvas.addEventListener('dblclick', e => this.doubleClick(e)); this.canvas.addEventListener('contextmenu', e => { e.preventDefault(); this.app.contextMenu(e); }); this.canvas.addEventListener('wheel', e => this.wheel(e), { passive: false }); this.canvas.addEventListener('pointerleave', () => { if (!this.gesture) {
            this.hover = null;
            this.app.invalidate();
        } }); const te = app.dom.textEditor; te.addEventListener('input', () => { if (!this.textNode)
            return; this.textNode.text = te.value; V.measureText(this.textNode); this.store.emit(); this.positionText(); }); te.addEventListener('blur', () => this.finishText()); te.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') {
            e.preventDefault();
            this.finishText(true);
        }
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this.finishText();
        } }); }
        get store() { return this.app.store; }
        get cam() { return this.app.camera; }
        get renderer() { return this.app.renderer; }
        local(e) { const r = this.canvas.getBoundingClientRect(); return V.pt(e.clientX - r.left, e.clientY - r.top); }
        world(e) { return this.cam.world(this.local(e)); }
        setTool(tool) { if (!toolInfo[tool])
            return; if (this.pen && tool !== 'pen')
            this.finishPen(); if (this.textNode)
            this.finishText(); this.tool = tool; this.anchorSelection = null; this.hover = null; this.updateCursor(); this.app.updateToolUI(); this.app.invalidate(); }
        updateCursor() { let c = this.space || this.tool === 'hand' ? (this.gesture ? 'grabbing' : 'grab') : this.tool === 'select' ? 'default' : this.tool === 'text' ? 'text' : this.tool === 'zoom' ? 'zoom-in' : this.tool === 'erase' ? 'not-allowed' : this.tool === 'direct' ? 'default' : 'crosshair'; this.canvas.style.cursor = c; }
        hit(p, { unlocked = true } = {}) { let tol = 6 / this.cam.zoom, items = this.store.index.query({ x: p.x - tol, y: p.y - tol, x2: p.x + tol, y2: p.y + tol }).sort((a, b) => b.order - a.order); for (let { node: n } of items) {
            if (unlocked && this.store.isLocked(n))
                continue;
            let inv = V.inverse(n.matrix);
            if (!inv)
                continue;
            let q = V.transform(inv, p), s = Math.max(.001, Math.min(Math.hypot(n.matrix[0], n.matrix[1]), Math.hypot(n.matrix[2], n.matrix[3])));
            if (n.type === 'text' || n.type === 'image') {
                if (V.contains(V.localBounds(n), q, tol / s))
                    return n;
                continue;
            }
            let polys = V.flatten(V.shapePaths(n), .55);
            if (n.fill !== 'none' && V.windingAt(polys, q, n.fillRule))
                return n;
            if (n.stroke !== 'none' && n.strokeWidth > 0) {
                for (let poly of polys) {
                    let points = poly.points, count = poly.closed ? points.length : points.length - 1;
                    for (let i = 0; i < count; i++)
                        if (V.segmentDistance(q, points[i], points[(i + 1) % points.length]) <= n.strokeWidth / 2 + tol / s)
                            return n;
                }
            }
        } return null; }
        idsFor(n) { return n.groupId && this.tool !== 'direct' ? this.store.doc.nodes.filter(a => a.groupId === n.groupId && !this.store.isLocked(a)).map(a => a.id) : [n.id]; }
        handles(b) { let x = b.x, y = b.y, x2 = b.x2, y2 = b.y2, cx = (x + x2) / 2, cy = (y + y2) / 2; return [{ key: 'nw', p: V.pt(x, y), fixed: V.pt(x2, y2) }, { key: 'n', p: V.pt(cx, y), fixed: V.pt(cx, y2) }, { key: 'ne', p: V.pt(x2, y), fixed: V.pt(x, y2) }, { key: 'e', p: V.pt(x2, cy), fixed: V.pt(x, cy) }, { key: 'se', p: V.pt(x2, y2), fixed: V.pt(x, y) }, { key: 's', p: V.pt(cx, y2), fixed: V.pt(cx, y) }, { key: 'sw', p: V.pt(x, y2), fixed: V.pt(x2, y) }, { key: 'w', p: V.pt(x, cy), fixed: V.pt(x2, cy) }]; }
        hitHandle(p, b) { for (let h of this.handles(b))
            if (V.dist(p, h.p) * this.cam.zoom < 7)
                return h; let rp = V.pt((b.x + b.x2) / 2, b.y - 25 / this.cam.zoom); if (V.dist(p, rp) * this.cam.zoom < 8)
            return { key: 'rotate', p: rp }; return null; }
        anchorHit(p) { let best = null, min = 8 / this.cam.zoom; for (let n of this.store.selected) {
            if (this.store.isLocked(n) || ['text', 'image'].includes(n.type))
                continue;
            V.shapePaths(n).forEach((path, pi) => path.points.forEach((a, ai) => { for (let kind of ['in', 'out', 'point']) {
                let q = kind === 'point' ? a : a[kind];
                if (!q)
                    continue;
                let d = V.dist(V.transform(n.matrix, q), p);
                if (d < min) {
                    min = d;
                    best = { n, pi, ai, kind };
                }
            } }));
        } return best; }
        allBounds() { return V.unionBounds(this.store.doc.artboards.map(b => ({ x: b.x, y: b.y, x2: b.x + b.w, y2: b.y + b.h }))); }
        fitAll() { this.cam.fit(this.allBounds()); this.app.invalidate(); }
        fitBoard() { let b = this.store.activeBoard; this.cam.fit({ x: b.x, y: b.y, w: b.w, h: b.h }); this.app.invalidate(); }
        fitSelection() { let b = this.store.selectionBounds(); if (b) {
            this.cam.fit(b);
            this.app.invalidate();
        } }
        wheel(e) { e.preventDefault(); const p = this.local(e); if (e.shiftKey) {
            this.cam.x -= e.deltaY || e.deltaX;
            this.cam.y -= e.deltaX;
        }
        else
            this.cam.zoomAt(Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * .007), p); this.app.invalidate(); }
        snapPoint(p, exclude = new Set()) { this.snapLines = []; if (this.app.gridSnap) {
            p = V.pt(Math.round(p.x / 20) * 20, Math.round(p.y / 20) * 20);
        } if (!this.app.smartGuides)
            return p; let xs = [], ys = []; for (let b of this.store.doc.artboards) {
            xs.push(b.x, b.x + b.w / 2, b.x + b.w);
            ys.push(b.y, b.y + b.h / 2, b.y + b.h);
        } for (let item of this.store.index.query({ x: p.x - 50 / this.cam.zoom, y: p.y - 50 / this.cam.zoom, x2: p.x + 50 / this.cam.zoom, y2: p.y + 50 / this.cam.zoom })) {
            if (exclude.has(item.id))
                continue;
            let b = item.bounds;
            xs.push(b.x, (b.x + b.x2) / 2, b.x2);
            ys.push(b.y, (b.y + b.y2) / 2, b.y2);
        } for (let g of this.store.doc.guides || [])
            (g.axis === 'x' ? xs : ys).push(g.value); let x = p.x, y = p.y, dx = 6 / this.cam.zoom, dy = dx; for (let v of xs)
            if (Math.abs(v - p.x) < dx) {
                dx = Math.abs(v - p.x);
                x = v;
            } for (let v of ys)
            if (Math.abs(v - p.y) < dy) {
                dy = Math.abs(v - p.y);
                y = v;
            } if (x !== p.x)
            this.snapLines.push({ axis: 'x', value: x }); if (y !== p.y)
            this.snapLines.push({ axis: 'y', value: y }); return V.pt(x, y); }
        snapDelta(delta, b, exclude) { this.snapLines = []; if (this.app.gridSnap) {
            delta = V.pt(Math.round((b.x + delta.x) / 20) * 20 - b.x, Math.round((b.y + delta.y) / 20) * 20 - b.y);
        } if (!this.app.smartGuides)
            return delta; let xs = [], ys = []; for (let a of this.store.doc.artboards) {
            xs.push(a.x, a.x + a.w / 2, a.x + a.w);
            ys.push(a.y, a.y + a.h / 2, a.y + a.h);
        } for (let item of this.store.index.query({ x: (-this.cam.x) / this.cam.zoom, y: (-this.cam.y) / this.cam.zoom, x2: (this.cam.width - this.cam.x) / this.cam.zoom, y2: (this.cam.height - this.cam.y) / this.cam.zoom })) {
            if (exclude.has(item.id))
                continue;
            let a = item.bounds;
            xs.push(a.x, (a.x + a.x2) / 2, a.x2);
            ys.push(a.y, (a.y + a.y2) / 2, a.y2);
        } for (let g of this.store.doc.guides || [])
            (g.axis === 'x' ? xs : ys).push(g.value); let dx = 0, dy = 0, minx = 6 / this.cam.zoom, miny = minx, sx = null, sy = null; for (let a of [b.x, (b.x + b.x2) / 2, b.x2])
            for (let v of xs) {
                let diff = v - a - delta.x;
                if (Math.abs(diff) < minx) {
                    minx = Math.abs(diff);
                    dx = diff;
                    sx = v;
                }
            } for (let a of [b.y, (b.y + b.y2) / 2, b.y2])
            for (let v of ys) {
                let diff = v - a - delta.y;
                if (Math.abs(diff) < miny) {
                    miny = Math.abs(diff);
                    dy = diff;
                    sy = v;
                }
            } if (sx !== null)
            this.snapLines.push({ axis: 'x', value: sx }); if (sy !== null)
            this.snapLines.push({ axis: 'y', value: sy }); return V.pt(delta.x + dx, delta.y + dy); }
        originals() { return this.store.selected.filter(n => !this.store.isLocked(n)).map(n => ({ n, m: [...n.matrix] })); }
        down(e) {
            if (e.button === 2)
                return;
            e.preventDefault();
            this.app.closePopovers();
            this.canvas.focus({ preventScroll: true });
            if (this.textNode)
                this.finishText();
            const screen = this.local(e), p = this.cam.world(screen);
            this.pointer = p;
            this.canvas.setPointerCapture(e.pointerId);
            if (e.button === 1 || this.space || this.tool === 'hand') {
                e.preventDefault();
                this.gesture = { kind: 'pan', screen, x: this.cam.x, y: this.cam.y };
                this.updateCursor();
                return;
            }
            if (screen.x < 22 || screen.y < 22) {
                this.store.history.begin('Add guide');
                const axis = screen.y < 22 ? 'y' : 'x', g = { id: V.uid('guide'), axis, value: p[axis] };
                (this.store.doc.guides ||= []).push(g);
                this.gesture = { kind: 'guide', guide: g };
                this.store.emit();
                return;
            }
            const board = this.store.doc.artboards.find(b => V.contains({ x: b.x, y: b.y, x2: b.x + b.w, y2: b.y + b.h }, p));
            if (board && this.tool !== 'artboard')
                this.store.activeArtboard = board.id;
            if (this.tool === 'zoom') {
                this.cam.zoomAt(e.altKey ? 1 / 1.35 : 1.35, screen);
                this.app.invalidate();
                return;
            }
            if (this.tool === 'pen') {
                this.penDown(e, p);
                return;
            }
            if (this.tool === 'direct') {
                let a = this.anchorHit(p);
                if (a) {
                    this.store.history.begin(a.kind === 'point' ? 'Move anchor' : 'Move Bézier handle');
                    if (a.n.type !== 'path') {
                        a.n.paths = V.clone(V.shapePaths(a.n));
                        a.n.type = 'path';
                    }
                    this.anchorSelection = { id: a.n.id, pi: a.pi, ai: a.ai };
                    this.gesture = { ...a, kind: 'anchor', part: a.kind, start: p, original: V.clone(a.n.paths[a.pi].points[a.ai]) };
                    return;
                }
            }
            if (this.tool === 'select' || this.tool === 'rotate') {
                let b = this.store.selectionBounds();
                if (b && this.store.selected.some(n => !this.store.isLocked(n))) {
                    let h = this.tool === 'rotate' ? { key: 'rotate' } : this.hitHandle(p, b);
                    if (h) {
                        let center = V.pt((b.x + b.x2) / 2, (b.y + b.y2) / 2);
                        this.store.history.begin(h.key === 'rotate' ? 'Rotate objects' : 'Resize objects');
                        this.gesture = { kind: h.key === 'rotate' ? 'rotate' : 'resize', handle: h, start: p, b, center, angle: Math.atan2(p.y - center.y, p.x - center.x), originals: this.originals() };
                        return;
                    }
                }
            }
            if (['select', 'direct', 'rotate'].includes(this.tool)) {
                let n = this.hit(p);
                this.anchorSelection = null;
                if (n) {
                    let ids = this.idsFor(n);
                    if (e.shiftKey) {
                        let next = new Set(this.store.selection);
                        for (let id of ids)
                            next.has(id) ? next.delete(id) : next.add(id);
                        this.store.select([...next]);
                    }
                    else if (!this.store.selection.has(n.id))
                        this.store.select(ids);
                    if (!this.store.selection.has(n.id))
                        return;
                    this.store.history.begin(e.altKey ? 'Duplicate and move' : 'Move objects');
                    if (e.altKey) {
                        let groups = new Map();
                        let ns = this.store.selected.map(a => { if (a.groupId && !groups.has(a.groupId))
                            groups.set(a.groupId, V.uid('group')); return { ...V.clone(a), id: V.uid(), name: a.name + ' copy', groupId: a.groupId ? groups.get(a.groupId) : undefined }; });
                        this.store.doc.nodes.push(...ns);
                        this.store.selection = new Set(ns.map(a => a.id));
                        this.store.emit();
                    }
                    this.gesture = { kind: 'move', start: p, originals: this.originals(), b: this.store.selectionBounds() };
                }
                else {
                    let g = (this.app.showGuides ? this.store.doc.guides || [] : []).find(g => Math.abs(p[g.axis] - g.value) * this.cam.zoom < 5);
                    if (g && !this.app.lockGuides) {
                        this.store.history.begin('Move guide');
                        this.gesture = { kind: 'guide', guide: g };
                    }
                    else {
                        if (!e.shiftKey)
                            this.store.select([]);
                        this.gesture = { kind: 'marquee', start: p, end: p, add: e.shiftKey };
                    }
                }
                this.app.invalidate();
                return;
            }
            if (this.tool === 'text') {
                let n = this.hit(p);
                if (n?.type === 'text')
                    this.editText(n);
                else {
                    this.store.history.begin('Add text');
                    n = V.node('text', { opacity: this.app.opacity, name: 'Text', text: 'Your text', fontSize: 48, fontFamily: 'Arial', fontWeight: 600, lineHeight: 1.12, letterSpacing: 0, matrix: V.translate(p.x, p.y), fill: this.app.fill === 'none' ? '#344C3D' : V.clone(this.app.fill), stroke: 'none' });
                    V.measureText(n);
                    this.store.add(n);
                    this.store.select([n.id]);
                    this.store.emit();
                    this.editText(n, true);
                }
                return;
            }
            if (this.tool === 'eyedropper') {
                let n = this.hit(p, { unlocked: false });
                if (n) {
                    this.app.fill = V.clone(n.fill);
                    this.app.stroke = n.stroke;
                    this.app.strokeWidth = n.strokeWidth;
                    this.app.opacity = n.opacity;
                    this.store.mutate('Sample appearance', () => { for (let a of this.store.selected)
                        if (!this.store.isLocked(a))
                            Object.assign(a, { fill: V.clone(n.fill), stroke: n.stroke, strokeWidth: n.strokeWidth, opacity: n.opacity }); });
                    this.app.refreshUI();
                    this.app.toast('Appearance sampled.');
                }
                return;
            }
            if (this.tool === 'erase') {
                this.store.history.begin('Erase objects');
                this.gesture = { kind: 'erase' };
                this.eraseAt(p);
                return;
            }
            if (this.tool === 'gradient') {
                let n = this.hit(p) || this.store.selected[0];
                if (!n || this.store.isLocked(n))
                    return;
                this.store.select([n.id]);
                this.store.history.begin('Edit gradient');
                n.fill = typeof n.fill === 'object' ? V.clone(n.fill) : { type: 'linear', color0: n.fill === 'none' ? '#F5BC8B' : n.fill, color1: '#344C3D', angle: 0 };
                this.gesture = { kind: 'gradient', n, start: V.transform(V.inverse(n.matrix) || V.ident(), p) };
                this.store.emit();
                return;
            }
            if (this.tool === 'artboard') {
                let b = this.store.activeBoard, bb = { x: b.x, y: b.y, x2: b.x + b.w, y2: b.y + b.h, w: b.w, h: b.h }, h = this.hitHandle(p, bb);
                if (h && h.key !== 'rotate' && !e.shiftKey) {
                    this.store.history.begin('Resize artboard');
                    this.gesture = { kind: 'boardresize', b, original: { ...b }, handle: h };
                }
                else if (board && !e.shiftKey) {
                    this.store.activeArtboard = board.id;
                    this.store.history.begin('Move artboard');
                    this.gesture = { kind: 'boardmove', b: board, start: p, x: board.x, y: board.y, originals: this.store.doc.nodes.filter(n => n.artboardId === board.id).map(n => ({ n, m: [...n.matrix] })) };
                }
                else {
                    this.store.history.begin('Create artboard');
                    let b = { id: V.uid('board'), name: 'Artboard ' + (this.store.doc.artboards.length + 1), x: p.x, y: p.y, w: 1, h: 1, background: '#FFFFFF' };
                    this.store.doc.artboards.push(b);
                    this.store.activeArtboard = b.id;
                    this.gesture = { kind: 'boarddraw', b, start: p };
                }
                this.store.select([]);
                this.store.emit();
                return;
            }
            if (this.store.doc.layers.find(l => l.id === this.store.activeLayer)?.locked) {
                this.app.toast('Unlock the active layer before drawing.', true);
                return;
            }
            let start = this.snapPoint(p), n;
            if (this.tool === 'pencil' || this.tool === 'brush') {
                this.store.history.begin('Draw ' + this.tool);
                let stroke = this.app.stroke === 'none' ? (typeof this.app.fill === 'string' && this.app.fill !== 'none' ? this.app.fill : '#EB713F') : this.app.stroke;
                n = V.node('path', { name: this.tool === 'brush' ? 'Brush stroke' : 'Pencil path', paths: [{ closed: false, points: [V.anchor(start.x, start.y)] }], fill: 'none', stroke, opacity: this.app.opacity, strokeWidth: this.tool === 'brush' ? Math.max(6, this.app.strokeWidth) : this.app.strokeWidth || 2 });
                this.store.add(n);
                this.store.select([n.id]);
                this.gesture = { kind: 'freehand', n, start, points: [start] };
            }
            else {
                this.store.history.begin('Draw ' + this.tool);
                n = V.node(this.tool, { w: 0, h: 0, matrix: V.translate(start.x, start.y), fill: V.clone(this.app.fill), stroke: this.app.stroke, opacity: this.app.opacity, strokeWidth: this.app.strokeWidth, radius: 0, sides: this.tool === 'polygon' ? 6 : 5, innerRatio: .45 });
                if (this.tool === 'line') {
                    n.fill = 'none';
                    n.stroke = this.app.stroke === 'none' ? (typeof this.app.fill === 'string' && this.app.fill !== 'none' ? this.app.fill : '#EB713F') : this.app.stroke;
                }
                this.store.add(n);
                this.store.select([n.id]);
                this.gesture = { kind: 'draw', n, start };
            }
            this.store.emit();
        }
        move(e) {
            const p = this.world(e), screen = this.local(e);
            this.pointer = p;
            let g = this.gesture;
            if (!g) {
                if (this.tool === 'select' || this.tool === 'direct') {
                    let n = this.hit(p);
                    if (this.hover?.id !== n?.id) {
                        this.hover = n;
                        this.app.invalidate();
                    }
                    let b = this.store.selectionBounds(), h = this.tool === 'select' && b ? this.hitHandle(p, b) : null;
                    this.canvas.style.cursor = this.space ? 'grab' : h ? (h.key === 'rotate' ? 'crosshair' : ({ nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }[h.key])) : 'default';
                }
                if (this.pen)
                    this.app.invalidate();
                return;
            }
            if (g.kind === 'pan') {
                this.cam.x = g.x + screen.x - g.screen.x;
                this.cam.y = g.y + screen.y - g.screen.y;
                this.app.invalidate();
                return;
            }
            if (g.kind === 'marquee') {
                g.end = p;
                this.app.invalidate();
                return;
            }
            if (g.kind === 'move') {
                let d = V.sub(p, g.start);
                if (e.shiftKey) {
                    if (Math.abs(d.x) > Math.abs(d.y))
                        d.y = 0;
                    else
                        d.x = 0;
                }
                if (!e.ctrlKey && !e.metaKey)
                    d = this.snapDelta(d, g.b, this.store.selection);
                for (let { n, m } of g.originals)
                    n.matrix = V.matrix(V.translate(d.x, d.y), m);
            }
            else if (g.kind === 'resize') {
                let q = e.ctrlKey ? p : this.snapPoint(p, this.store.selection), fixed = e.altKey ? g.center : g.handle.fixed, key = g.handle.key, sx = key === 'n' || key === 's' ? 1 : (q.x - fixed.x) / ((g.handle.p.x - fixed.x) || 1), sy = key === 'e' || key === 'w' ? 1 : (q.y - fixed.y) / ((g.handle.p.y - fixed.y) || 1);
                if ((e.shiftKey || this.app.constrain) && key.length === 2) {
                    let s = Math.abs(sx - 1) > Math.abs(sy - 1) ? Math.abs(sx) : Math.abs(sy);
                    sx = Math.sign(sx || 1) * s;
                    sy = Math.sign(sy || 1) * s;
                }
                if (Math.abs(sx) < .005)
                    sx = .005 * Math.sign(sx || 1);
                if (Math.abs(sy) < .005)
                    sy = .005 * Math.sign(sy || 1);
                let m = V.around(V.scale(sx, sy), fixed);
                for (let o of g.originals)
                    o.n.matrix = V.matrix(m, o.m);
            }
            else if (g.kind === 'rotate') {
                let angle = Math.atan2(p.y - g.center.y, p.x - g.center.x) - g.angle;
                if (e.shiftKey)
                    angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
                for (let o of g.originals)
                    o.n.matrix = V.matrix(V.around(V.rotate(angle), g.center), o.m);
            }
            else if (g.kind === 'draw') {
                let q = e.ctrlKey ? p : this.snapPoint(p, new Set([g.n.id])), dx = q.x - g.start.x, dy = q.y - g.start.y;
                if (g.n.type === 'line') {
                    if (e.shiftKey) {
                        let a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, l = Math.hypot(dx, dy);
                        dx = Math.cos(a) * l;
                        dy = Math.sin(a) * l;
                    }
                    g.n.w = dx;
                    g.n.h = dy;
                }
                else {
                    if (e.shiftKey) {
                        let size = Math.max(Math.abs(dx), Math.abs(dy));
                        dx = Math.sign(dx || 1) * size;
                        dy = Math.sign(dy || 1) * size;
                    }
                    g.n.w = Math.abs(dx);
                    g.n.h = Math.abs(dy);
                    g.n.matrix = V.translate(g.start.x + Math.min(0, dx), g.start.y + Math.min(0, dy));
                    if (e.altKey) {
                        g.n.matrix = V.translate(g.start.x - Math.abs(dx), g.start.y - Math.abs(dy));
                        g.n.w *= 2;
                        g.n.h *= 2;
                    }
                }
            }
            else if (g.kind === 'freehand') {
                if (g.points.length < 10000 && V.dist(g.points.at(-1), p) * this.cam.zoom > .9) {
                    g.points.push(p);
                    g.n.paths = [{ closed: false, points: g.points.map(p => V.anchor(p.x, p.y)) }];
                }
            }
            else if (g.kind === 'pen') {
                let a = g.n.paths[0].points[g.ai], d = V.sub(p, a);
                if (V.len(d) * this.cam.zoom > 2) {
                    if (e.shiftKey) {
                        let angle = Math.round(Math.atan2(d.y, d.x) / (Math.PI / 4)) * Math.PI / 4, l = V.len(d);
                        d = V.pt(Math.cos(angle) * l, Math.sin(angle) * l);
                    }
                    a.out = V.add(a, d);
                    a.in = e.altKey ? null : V.sub(a, d);
                }
            }
            else if (g.kind === 'anchor') {
                let inv = V.inverse(g.n.matrix) || V.ident(), local = V.transform(inv, p), old = g.original, a = g.n.paths[g.pi].points[g.ai];
                let part = g.part;
                if (part === 'point') {
                    let start = V.transform(inv, g.start), d = V.sub(local, start);
                    if (e.shiftKey) {
                        if (Math.abs(d.x) > Math.abs(d.y))
                            d.y = 0;
                        else
                            d.x = 0;
                    }
                    a.x = old.x + d.x;
                    a.y = old.y + d.y;
                    a.in = old.in ? V.add(old.in, d) : null;
                    a.out = old.out ? V.add(old.out, d) : null;
                }
                else {
                    a[part] = local;
                    let other = part === 'in' ? 'out' : 'in';
                    if (!e.altKey && old[other])
                        a[other] = V.sub(V.mul(a, 2), local);
                }
            }
            else if (g.kind === 'gradient') {
                let q = V.transform(V.inverse(g.n.matrix) || V.ident(), p);
                g.n.fill.angle = Math.atan2(q.y - g.start.y, q.x - g.start.x) * 180 / Math.PI;
            }
            else if (g.kind === 'erase') {
                this.eraseAt(p);
                return;
            }
            else if (g.kind === 'guide') {
                g.guide.value = p[g.guide.axis];
            }
            else if (g.kind === 'boardmove') {
                let d = V.sub(p, g.start);
                g.b.x = g.x + d.x;
                g.b.y = g.y + d.y;
                for (let o of g.originals)
                    o.n.matrix = V.matrix(V.translate(d.x, d.y), o.m);
            }
            else if (g.kind === 'boarddraw') {
                g.b.x = Math.min(g.start.x, p.x);
                g.b.y = Math.min(g.start.y, p.y);
                g.b.w = Math.max(1, Math.abs(p.x - g.start.x));
                g.b.h = Math.max(1, Math.abs(p.y - g.start.y));
            }
            else if (g.kind === 'boardresize') {
                let f = g.handle.fixed, key = g.handle.key, old = g.original;
                if (key !== 'n' && key !== 's') {
                    g.b.x = Math.min(f.x, p.x);
                    g.b.w = Math.max(1, Math.abs(p.x - f.x));
                }
                else {
                    g.b.x = old.x;
                    g.b.w = old.w;
                }
                if (key !== 'e' && key !== 'w') {
                    g.b.y = Math.min(f.y, p.y);
                    g.b.h = Math.max(1, Math.abs(p.y - f.y));
                }
                else {
                    g.b.y = old.y;
                    g.b.h = old.h;
                }
            }
            this.store.emit('gesture');
        }
        up(e) {
            let g = this.gesture;
            if (!g)
                return;
            this.gesture = null;
            this.snapLines = [];
            if (g.kind === 'marquee') {
                let b = V.bounds([g.start, g.end]), items = this.store.index.query(b).filter(i => !this.store.isLocked(i.node)), ids = new Set(g.add ? this.store.selection : []);
                for (let i of items)
                    for (let id of this.idsFor(i.node))
                        ids.add(id);
                this.store.select([...ids]);
            }
            else if (g.kind === 'draw') {
                if (Math.abs(g.n.w) + Math.abs(g.n.h) < 3 / this.cam.zoom) {
                    g.n.w = 100;
                    g.n.h = g.n.type === 'line' ? 0 : 100;
                }
                this.store.emit();
            }
            else if (g.kind === 'freehand') {
                let ps = V.simplify(g.points, .8 / this.cam.zoom);
                if (ps.length < 2)
                    this.store.doc.nodes = this.store.doc.nodes.filter(n => n.id !== g.n.id);
                else
                    g.n.paths = [V.smoothPath(ps, false, this.tool === 'brush' ? .18 : .12)];
                this.store.cleanSelection();
                this.store.emit();
            }
            else if (g.kind === 'guide') {
                let p = this.local(e);
                if (p.x < 22 || p.y < 22)
                    this.store.doc.guides = this.store.doc.guides.filter(a => a !== g.guide);
                this.store.emit();
            }
            else if (g.kind === 'boarddraw' && g.b.w < 10 && g.b.h < 10) {
                g.b.w = 720;
                g.b.h = 840;
                this.store.emit();
            }
            if (g.kind !== 'pen' && g.kind !== 'pan')
                this.store.history.commit();
            this.app.refreshUI();
            this.updateCursor();
            this.app.invalidate();
        }
        penDown(e, p) { let n = this.pen, ps = n?.paths[0].points; if (n && ps.length >= 3 && V.dist(p, ps[0]) * this.cam.zoom < 9) {
            n.paths[0].closed = true;
            this.finishPen();
            return;
        } if (!n) {
            if (this.store.doc.layers.find(l => l.id === this.store.activeLayer)?.locked) {
                this.app.toast('Unlock the active layer before drawing.', true);
                return;
            }
            this.store.history.begin('Draw Bézier path');
            n = V.node('path', { name: 'Bézier path', paths: [{ closed: false, points: [] }], fill: V.clone(this.app.fill), stroke: this.app.stroke, opacity: this.app.opacity, strokeWidth: this.app.strokeWidth });
            this.store.add(n);
            this.pen = n;
            this.store.select([n.id]);
            ps = n.paths[0].points;
        } let q = this.snapPoint(p, new Set([n.id])); if (e.shiftKey && ps.length) {
            let last = ps.at(-1), d = V.sub(q, last), a = Math.round(Math.atan2(d.y, d.x) / (Math.PI / 4)) * Math.PI / 4;
            q = V.add(last, V.pt(Math.cos(a) * V.len(d), Math.sin(a) * V.len(d)));
        } ps.push(V.anchor(q.x, q.y)); this.gesture = { kind: 'pen', n, ai: ps.length - 1 }; this.store.emit(); }
        finishPen() { if (!this.pen)
            return; let n = this.pen, ps = n.paths[0].points; this.pen = null; this.gesture = null; if (ps.length < 2)
            this.store.doc.nodes = this.store.doc.nodes.filter(a => a.id !== n.id); if (!n.paths[0].closed && n.fill === 'none' && n.stroke === 'none')
            n.stroke = '#EB713F'; this.store.cleanSelection(); this.store.emit(); this.store.history.commit(); this.app.refreshUI(); this.app.invalidate(); }
        eraseAt(p) { let n = this.hit(p); if (n) {
            this.store.doc.nodes = this.store.doc.nodes.filter(a => a.id !== n.id);
            this.store.selection.delete(n.id);
            this.store.emit('gesture');
        } }
        doubleClick(e) { let p = this.world(e); if (this.pen) {
            let ps = this.pen.paths[0].points;
            if (ps.length > 1 && V.dist(ps.at(-1), ps.at(-2)) * this.cam.zoom < 3)
                ps.pop();
            this.finishPen();
            return;
        } let n = this.hit(p); if (n?.type === 'text') {
            this.store.select([n.id]);
            this.editText(n);
            return;
        } if (this.tool === 'direct' && n && !this.store.isLocked(n) && !['text', 'image'].includes(n.type))
            this.insertAnchor(n, p); }
        insertAnchor(n, p) { this.store.mutate('Edit path anchor', () => { if (n.type !== 'path') {
            n.paths = V.clone(V.shapePaths(n));
            n.type = 'path';
        } let inv = V.inverse(n.matrix); if (!inv)
            return; let q = V.transform(inv, p), hit = null, near = 8 / this.cam.zoom; for (let [pi, path] of n.paths.entries())
            for (let [ai, a] of path.points.entries()) {
                let d = V.dist(a, q);
                if (d < near) {
                    near = d;
                    hit = { pi, ai, a };
                }
            } if (hit) {
            let { a, ai, pi } = hit, path = n.paths[pi], ps = path.points;
            if (a.in || a.out) {
                a.in = null;
                a.out = null;
            }
            else {
                let prev = ps[(ai - 1 + ps.length) % ps.length], next = ps[(ai + 1) % ps.length], d = V.mul(V.sub(next, prev), .2);
                a.in = V.sub(a, d);
                a.out = V.add(a, d);
            }
            this.anchorSelection = { id: n.id, pi, ai };
            return;
        } let best = { d: Infinity }; for (let [pi, path] of n.paths.entries()) {
            let ps = path.points, count = path.closed ? ps.length : ps.length - 1;
            for (let i = 0; i < count; i++) {
                let a = ps[i], b = ps[(i + 1) % ps.length];
                for (let j = 1; j < 64; j++) {
                    let t = j / 64, v = V.cubic(a, a.out || a, b.in || b, b, t), d = V.dist(v, q);
                    if (d < best.d)
                        best = { d, pi, i, t, a, b };
                }
            }
        } if (!Number.isFinite(best.d))
            return; let { pi, i, t, a, b } = best, [l, r] = V.splitCubic(a, a.out || a, b.in || b, b, t); a.out = l[1]; b.in = r[2]; n.paths[pi].points.splice(i + 1, 0, V.anchor(l[3].x, l[3].y, l[2], r[1])); this.anchorSelection = { id: n.id, pi, ai: i + 1 }; }); }
        deleteSelection() { if (this.tool === 'direct' && this.anchorSelection) {
            let { id, pi, ai } = this.anchorSelection, n = this.store.doc.nodes.find(n => n.id === id);
            if (n?.type === 'path' && !this.store.isLocked(n)) {
                this.store.mutate('Delete anchor', () => { let p = n.paths[pi]; p.points.splice(ai, 1); n.paths = n.paths.filter(p => p.points.length >= 2); if (!n.paths.length)
                    this.store.doc.nodes = this.store.doc.nodes.filter(a => a.id !== id); });
                this.anchorSelection = null;
                return;
            }
        } this.store.delete(); }
        editText(n, existingTransaction = false) { if (this.textNode && this.textNode !== n)
            this.finishText(); if (!existingTransaction)
            this.store.history.begin('Edit text'); this.textNode = n; this.renderer.editingText = n.id; let te = this.app.dom.textEditor; te.value = n.text; te.hidden = false; this.positionText(); te.focus(); te.select(); this.app.invalidate(); }
        positionText() { if (!this.textNode)
            return; let n = this.textNode, m = V.matrix([this.cam.zoom, 0, 0, this.cam.zoom, this.cam.x, this.cam.y], n.matrix), te = this.app.dom.textEditor; te.style.left = '0px'; te.style.top = '0px'; te.style.width = (n.w + 35) + 'px'; te.style.height = (n.h + 14) + 'px'; te.style.transform = `matrix(${m.join(',')})`; te.style.font = `${n.fontStyle || 'normal'} ${n.fontWeight || 400} ${n.fontSize}px ${n.fontFamily || 'Arial'}`; te.style.lineHeight = n.lineHeight; te.style.letterSpacing = (n.letterSpacing || 0) + 'px'; te.style.color = typeof n.fill === 'object' ? n.fill.color0 : n.fill === 'none' ? '#111' : n.fill; }
        finishText(cancel = false) { if (!this.textNode)
            return; let n = this.textNode; this.textNode = null; this.renderer.editingText = null; this.app.dom.textEditor.hidden = true; if (cancel)
            this.store.history.cancel();
        else {
            n.text = this.app.dom.textEditor.value;
            if (!n.text.trim())
                this.store.doc.nodes = this.store.doc.nodes.filter(a => a.id !== n.id);
            V.measureText(n);
            this.store.cleanSelection();
            this.store.emit();
            this.store.history.commit();
        } this.app.refreshUI(); this.app.invalidate(); }
        cancel() { this.gesture = null; this.pen = null; this.snapLines = []; this.store.history.cancel(); this.updateCursor(); this.app.refreshUI(); this.app.invalidate(); }
        drawPath(ctx, n, color = '#80adff', dash = []) { ctx.save(); ctx.translate(this.cam.x, this.cam.y); ctx.scale(this.cam.zoom, this.cam.zoom); ctx.transform(...n.matrix); ctx.strokeStyle = color; let s = Math.max(.001, Math.max(Math.hypot(n.matrix[0], n.matrix[1]), Math.hypot(n.matrix[2], n.matrix[3]))); ctx.lineWidth = 1 / (this.cam.zoom * s); ctx.setLineDash(dash); if (n.type === 'text' || n.type === 'image') {
            let b = V.localBounds(n);
            ctx.strokeRect(b.x, b.y, b.w, b.h);
        }
        else
            ctx.stroke(new Path2D(V.pathsToD(V.shapePaths(n)))); ctx.restore(); }
        drawOverlay() {
            const c = this.canvas.getContext('2d'), cam = this.cam, dpr = this.renderer.dpr || devicePixelRatio, blue = getComputedStyle(document.documentElement).getPropertyValue('--blue').trim() || '#79aafa';
            c.setTransform(dpr, 0, 0, dpr, 0, 0);
            c.clearRect(0, 0, cam.width, cam.height);
            c.save();
            c.beginPath();
            c.rect(22, 22, cam.width - 22, cam.height - 22);
            c.clip();
            if (this.app.showGuides)
                for (let g of this.store.doc.guides || [])
                    this.drawGuide(c, g, '#64b2bc', [4, 4]);
            for (let g of this.snapLines)
                this.drawGuide(c, g, '#dd83cc', [3, 3]);
            if (this.hover && !this.store.selection.has(this.hover.id) && !this.gesture)
                this.drawPath(c, this.hover, '#76a6fa');
            for (let n of this.store.selected)
                if (n.id !== this.renderer.editingText)
                    this.drawPath(c, n, blue);
            if (this.tool === 'direct' || this.pen) {
                for (let n of this.store.selected) {
                    if (['text', 'image'].includes(n.type))
                        continue;
                    V.shapePaths(n).forEach((path, pi) => path.points.forEach((a, ai) => { let p = cam.screen(V.transform(n.matrix, a)); c.strokeStyle = blue; c.fillStyle = '#fafafa'; c.lineWidth = 1; for (let kind of ['in', 'out'])
                        if (a[kind]) {
                            let h = cam.screen(V.transform(n.matrix, a[kind]));
                            c.beginPath();
                            c.moveTo(p.x, p.y);
                            c.lineTo(h.x, h.y);
                            c.stroke();
                            c.beginPath();
                            c.arc(h.x, h.y, 2.5, 0, Math.PI * 2);
                            c.fill();
                            c.stroke();
                        } let selected = this.anchorSelection?.id === n.id && this.anchorSelection.pi === pi && this.anchorSelection.ai === ai; c.fillStyle = selected ? blue : '#fafafa'; c.fillRect(p.x - 3, p.y - 3, 6, 6); c.strokeRect(p.x - 3, p.y - 3, 6, 6); }));
                }
            }
            let b = this.store.selectionBounds();
            if (b && !this.pen && !this.textNode && ['select', 'rotate'].includes(this.tool)) {
                this.drawBox(c, b, blue, true);
            }
            if (this.tool === 'artboard') {
                let b = this.store.activeBoard;
                this.drawBox(c, { x: b.x, y: b.y, x2: b.x + b.w, y2: b.y + b.h, w: b.w, h: b.h }, blue, false);
            }
            if (this.pen && this.pen.paths[0].points.length) {
                let last = this.pen.paths[0].points.at(-1), p = cam.screen(last), end = cam.screen(this.pointer);
                c.beginPath();
                c.moveTo(p.x, p.y);
                if (last.out) {
                    let h = cam.screen(last.out);
                    c.bezierCurveTo(h.x, h.y, end.x, end.y, end.x, end.y);
                }
                else
                    c.lineTo(end.x, end.y);
                c.strokeStyle = blue;
                c.setLineDash([4, 3]);
                c.stroke();
                c.setLineDash([]);
            }
            if (this.gesture?.kind === 'marquee') {
                let b = V.bounds([this.gesture.start, this.gesture.end]), p = cam.screen(b);
                c.fillStyle = '#79aafa15';
                c.strokeStyle = blue;
                c.lineWidth = 1;
                c.fillRect(p.x, p.y, b.w * cam.zoom, b.h * cam.zoom);
                c.setLineDash([4, 3]);
                c.strokeRect(p.x, p.y, b.w * cam.zoom, b.h * cam.zoom);
                c.setLineDash([]);
            }
            if (this.gesture?.kind === 'gradient') {
                let g = this.gesture, a = cam.screen(V.transform(g.n.matrix, g.start)), b = cam.screen(this.pointer);
                c.strokeStyle = '#eee';
                c.lineWidth = 2;
                c.beginPath();
                c.moveTo(a.x, a.y);
                c.lineTo(b.x, b.y);
                c.stroke();
                c.fillStyle = '#fff';
                c.strokeStyle = '#333';
                for (let p of [a, b]) {
                    c.beginPath();
                    c.arc(p.x, p.y, 4, 0, Math.PI * 2);
                    c.fill();
                    c.stroke();
                }
            }
            c.restore();
            this.drawRulers(c);
            this.positionText();
        }
        drawBox(c, b, color, rotation) { let p = this.cam.screen(V.pt(b.x, b.y)); c.strokeStyle = color; c.lineWidth = 1; c.strokeRect(p.x, p.y, b.w * this.cam.zoom, b.h * this.cam.zoom); if (rotation) {
            let x = (b.x + b.x2) / 2, a = this.cam.screen(V.pt(x, b.y)), z = this.cam.screen(V.pt(x, b.y - 25 / this.cam.zoom));
            c.beginPath();
            c.moveTo(a.x, a.y);
            c.lineTo(z.x, z.y);
            c.stroke();
            c.beginPath();
            c.arc(z.x, z.y, 3.5, 0, V.TAU);
            c.fillStyle = '#fff';
            c.fill();
            c.stroke();
        } for (let h of this.handles(b)) {
            let p = this.cam.screen(h.p);
            c.fillStyle = '#f6f6f6';
            c.fillRect(p.x - 3, p.y - 3, 6, 6);
            c.strokeRect(p.x - 3, p.y - 3, 6, 6);
        } }
        drawGuide(c, g, color, dash) { let p = this.cam.screen(g.axis === 'x' ? V.pt(g.value, 0) : V.pt(0, g.value)); c.save(); c.strokeStyle = color; c.lineWidth = 1; c.setLineDash(dash); c.beginPath(); if (g.axis === 'x') {
            c.moveTo(p.x, 22);
            c.lineTo(p.x, this.cam.height);
        }
        else {
            c.moveTo(22, p.y);
            c.lineTo(this.cam.width, p.y);
        } c.stroke(); c.restore(); }
        drawRulers(c) { const dark = document.documentElement.dataset.theme !== 'light', cam = this.cam; c.fillStyle = dark ? '#303133' : '#ececee'; c.fillRect(0, 0, cam.width, 22); c.fillRect(0, 0, 22, cam.height); c.strokeStyle = dark ? '#4b4c4e' : '#bfc1c5'; c.lineWidth = 1; c.beginPath(); c.moveTo(22, 22.5); c.lineTo(cam.width, 22.5); c.moveTo(22.5, 22); c.lineTo(22.5, cam.height); c.stroke(); let desired = 85 / cam.zoom, pow = Math.pow(10, Math.floor(Math.log10(desired))), step = [1, 2, 5, 10].map(x => x * pow).find(x => x >= desired) || pow * 10, minor = step / 5; c.font = '8px Arial'; c.fillStyle = dark ? '#97999e' : '#767a82'; c.strokeStyle = dark ? '#64666b' : '#acaeb4'; for (let axis of ['x', 'y']) {
            let pan = axis === 'x' ? cam.x : cam.y, size = axis === 'x' ? cam.width : cam.height, start = Math.floor((22 - pan) / cam.zoom / minor) * minor;
            for (let v = start; v < (size - pan) / cam.zoom; v += minor) {
                let screen = v * cam.zoom + pan;
                if (screen < 23)
                    continue;
                let major = Math.abs(v / step - Math.round(v / step)) < .0001;
                c.beginPath();
                if (axis === 'x') {
                    c.moveTo(Math.round(screen) + .5, major ? 13 : 18);
                    c.lineTo(Math.round(screen) + .5, 22);
                    if (major)
                        c.fillText(String(Math.round(v * 100) / 100), screen + 3, 10);
                }
                else {
                    c.moveTo(major ? 13 : 18, Math.round(screen) + .5);
                    c.lineTo(22, Math.round(screen) + .5);
                    if (major) {
                        c.save();
                        c.translate(9, screen + 3);
                        c.rotate(-Math.PI / 2);
                        c.fillText(String(Math.round(v * 100) / 100), 0, 0);
                        c.restore();
                    }
                }
                c.stroke();
            }
        } c.fillStyle = dark ? '#393a3c' : '#dedfe1'; c.fillRect(0, 0, 22, 22); c.strokeStyle = dark ? '#81848a' : '#8c9097'; c.beginPath(); c.moveTo(7, 15); c.lineTo(15, 7); c.moveTo(7, 7); c.lineTo(7, 15); c.lineTo(15, 15); c.stroke(); }
    }
    V.Editor = Editor;
    V.toolInfo = toolInfo;
})();

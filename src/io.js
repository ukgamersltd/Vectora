/* Safe document and SVG import/export. Imported XML is parsed, never executed or inserted. */
'use strict';
(() => {
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])), num = n => Number(Number(n).toFixed(5));
    function parseTransform(s) { let m = V.ident(); for (let match of (s || '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
        let p = match[2].trim().split(/[\s,]+/).map(Number);
        if (p.some(x => !Number.isFinite(x)))
            throw Error('Invalid SVG transformation');
        let t = V.ident();
        switch (match[1]) {
            case 'matrix':
                if (p.length !== 6)
                    throw Error('Invalid SVG matrix');
                t = p;
                break;
            case 'translate':
                t = V.translate(p[0] || 0, p[1] || 0);
                break;
            case 'scale':
                t = V.scale(p[0], p[1] ?? p[0]);
                break;
            case 'rotate':
                t = V.rotate((p[0] || 0) * Math.PI / 180);
                if (p.length >= 3)
                    t = V.around(t, V.pt(p[1], p[2]));
                break;
            case 'skewX':
                t = [1, 0, Math.tan(p[0] * Math.PI / 180), 1, 0, 0];
                break;
            case 'skewY':
                t = [1, Math.tan(p[0] * Math.PI / 180), 0, 1, 0, 0];
                break;
        }
        m = V.matrix(m, t);
    } return m; }
    function svgExport(doc, board = null, selection = null, embedMetadata = false) {
        let artboards = board ? [board] : doc.artboards, bb = V.unionBounds(artboards.map(b => ({ x: b.x, y: b.y, x2: b.x + b.w, y2: b.y + b.h }))), defs = [], body = [], nodes = doc.layers.flatMap(l => l.visible === false ? [] : doc.nodes.filter(n => n.layerId === l.id && n.visible !== false && (!selection || selection.has(n.id))));
        if (!selection)
            for (let b of artboards)
                body.push(`<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" fill="${esc(b.background || '#fff')}"/>`);
        for (let n of nodes) {
            let b = V.localBounds(n), fill = n.fill;
            if (typeof fill === 'object') {
                let a = (fill.angle || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), extent = Math.max(1, Math.abs(c) * b.w + Math.abs(s) * b.h), cx = b.x + b.w / 2, cy = b.y + b.h / 2, id = 'gradient-' + n.id;
                defs.push(`<linearGradient id="${esc(id)}" gradientUnits="userSpaceOnUse" x1="${num(cx - c * extent / 2)}" y1="${num(cy - s * extent / 2)}" x2="${num(cx + c * extent / 2)}" y2="${num(cy + s * extent / 2)}"><stop stop-color="${esc(fill.color0)}"/><stop offset="1" stop-color="${esc(fill.color1)}"/></linearGradient>`);
                fill = `url(#${id})`;
            }
            let common = `id="${esc(n.id)}" data-name="${esc(n.name)}" transform="matrix(${n.matrix.map(num).join(' ')})" opacity="${num(n.opacity ?? 1)}" fill="${esc(fill || 'none')}" stroke="${esc(n.stroke || 'none')}" stroke-width="${num(n.strokeWidth || 0)}" stroke-linecap="${esc(n.lineCap || 'round')}" stroke-linejoin="${esc(n.lineJoin || 'round')}" fill-rule="${esc(n.fillRule || 'nonzero')}"`;
            if (n.type === 'text')
                body.push(`<text ${common} font-family="${esc(n.fontFamily || 'Arial')}" font-size="${num(n.fontSize)}" font-weight="${esc(n.fontWeight || 400)}" font-style="${esc(n.fontStyle || 'normal')}" letter-spacing="${num(n.letterSpacing || 0)}">${String(n.text || '').split('\n').map((line, i) => `<tspan x="0" y="${num(n.fontSize * .91 + i * n.fontSize * n.lineHeight)}">${esc(line)}</tspan>`).join('')}</text>`);
            else if (n.type === 'image')
                body.push(`<image ${common} width="${num(n.w)}" height="${num(n.h)}" href="${esc(n.src)}"/>`);
            else
                body.push(`<path ${common} d="${V.pathsToD(V.shapePaths(n))}"/>`);
        }
        let metadata = embedMetadata && !board && !selection ? `<metadata id="vectora-document">${esc(JSON.stringify(doc))}</metadata>` : '';
        return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(bb.w)}" height="${num(bb.h)}" viewBox="${num(bb.x)} ${num(bb.y)} ${num(bb.w)} ${num(bb.h)}"><title>${esc(doc.name)}</title>${metadata}<defs>${defs.join('')}</defs>${body.join('\n')}</svg>`;
    }
    function importSVG(text, name = 'Imported artwork') {
        if (text.length > 25 * 1024 * 1024)
            throw Error('SVG exceeds the 25 MB limit.');
        const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
        if (xml.querySelector('parsererror'))
            throw Error('The SVG is not well-formed XML.');
        const root = xml.documentElement;
        if (root.localName !== 'svg')
            throw Error('No SVG root element.');
        const metadata = root.querySelector('metadata#vectora-document');
        if (metadata) {
            try {
                return { doc: V.validateDocument(JSON.parse(metadata.textContent)), warnings: [] };
            }
            catch { }
        }
        let warnings = new Set(), vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number), w = parseFloat(root.getAttribute('width')) || 1200, h = parseFloat(root.getAttribute('height')) || 800;
        if (vb.length === 4 && vb.every(Number.isFinite)) {
            w = vb[2];
            h = vb[3];
        }
        else
            vb = [0, 0, w, h];
        if (w <= 0 || h <= 0 || w > 100000 || h > 100000)
            throw Error('Unsupported SVG dimensions.');
        let doc = V.blankDocument(w, h, name.replace(/\.svg$/i, '')), gradients = new Map(), idMap = new Map();
        for (let e of root.querySelectorAll('[id]'))
            idMap.set(e.id, e);
        for (let g of root.querySelectorAll('linearGradient,radialGradient')) {
            let stops = [...g.querySelectorAll('stop')].map(s => { let style = Object.fromEntries((s.getAttribute('style') || '').split(';').filter(Boolean).map(x => x.split(':').map(x => x.trim()))); return s.getAttribute('stop-color') || style['stop-color'] || '#000'; });
            if (g.localName === 'radialGradient')
                warnings.add('Radial gradients approximated by linear gradients.');
            if (stops.length > 2)
                warnings.add('Multi-stop gradients reduced to first and last colors.');
            let x1 = parseFloat(g.getAttribute('x1')) || 0, y1 = parseFloat(g.getAttribute('y1')) || 0, x2 = parseFloat(g.getAttribute('x2')) || 100, y2 = parseFloat(g.getAttribute('y2')) || 0;
            gradients.set(g.id, { type: 'linear', color0: stops[0] || '#000', color1: stops.at(-1) || '#fff', angle: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI });
            if (g.hasAttribute('gradientTransform'))
                warnings.add('Gradient transforms are approximated.');
        }
        const styleNames = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'stroke-linejoin', 'stroke-linecap', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'display', 'visibility'];
        let total = 0;
        function walk(el, parentM, inherited, depth = 0, groupId = null) {
            if (depth > 32)
                throw Error('SVG nesting limit exceeded.');
            if (++total > 20000)
                throw Error('SVG element limit exceeded.');
            let tag = el.localName;
            if (['script', 'foreignObject', 'style', 'filter', 'clipPath', 'mask', 'defs', 'metadata', 'title', 'desc', 'linearGradient', 'radialGradient', 'pattern'].includes(tag)) {
                if (['style', 'filter', 'clipPath', 'mask', 'pattern'].includes(tag))
                    warnings.add('Stylesheets, filters, clipping masks and patterns are not imported.');
                return;
            }
            let style = { ...inherited }, inline = Object.fromEntries((el.getAttribute('style') || '').split(';').filter(s => s.includes(':')).map(s => { let i = s.indexOf(':'); return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; }));
            for (let k of styleNames) {
                if (el.hasAttribute(k))
                    style[k] = el.getAttribute(k);
                if (inline[k] !== undefined)
                    style[k] = inline[k];
            }
            if (style.display === 'none' || style.visibility === 'hidden')
                return;
            let ownOpacity = parseFloat(el.getAttribute('opacity') || inline.opacity || '1');
            style.opacity = Number(inherited.opacity ?? 1) * ownOpacity;
            let m = V.matrix(parentM, parseTransform(el.getAttribute('transform')));
            const attr = (k, def = 0) => { let v = parseFloat(el.getAttribute(k)); return Number.isFinite(v) ? v : def; };
            if (el.hasAttribute('clip-path') || el.hasAttribute('mask') || el.hasAttribute('filter'))
                warnings.add('Clipping masks and filters were omitted.');
            if (tag === 'svg' || tag === 'g' || tag === 'a' || tag === 'symbol') {
                let group = tag === 'g' ? (groupId || V.uid('group')) : groupId;
                for (let child of el.children)
                    walk(child, m, style, depth + 1, group);
                return;
            }
            if (tag === 'use') {
                let href = el.getAttribute('href') || el.getAttribute('xlink:href');
                if (href?.startsWith('#') && idMap.has(href.slice(1)))
                    walk(idMap.get(href.slice(1)), V.matrix(m, V.translate(attr('x'), attr('y'))), style, depth + 1, groupId);
                else
                    warnings.add('External SVG references were omitted.');
                return;
            }
            let n = V.node('path', { layerId: 'artwork', matrix: m, groupId, name: el.getAttribute('data-name') || el.id || tag, fill: style.fill || '#000', stroke: style.stroke || 'none', strokeWidth: Number.isFinite(parseFloat(style['stroke-width'])) ? parseFloat(style['stroke-width']) : 1, opacity: Math.max(0, Math.min(1, Number(style.opacity ?? 1))), fillRule: style['fill-rule'] || 'nonzero', lineJoin: style['stroke-linejoin'] || 'miter', lineCap: style['stroke-linecap'] || 'butt' });
            if (/^url\(/.test(n.fill)) {
                let id = n.fill.match(/#([^\s)'";]+)/)?.[1];
                n.fill = gradients.get(id) || '#000';
                if (!gradients.has(id))
                    warnings.add('Unsupported paint servers were replaced with black.');
            }
            if (style['fill-opacity'] && Number(style['fill-opacity']) !== 1) {
                n.opacity *= Number(style['fill-opacity']);
                warnings.add('Fill opacity was folded into object opacity.');
            }
            if (style['stroke-opacity'] && Number(style['stroke-opacity']) !== 1)
                warnings.add('Independent stroke opacity is not supported.');
            if (tag === 'path')
                n.paths = V.parsePath(el.getAttribute('d') || '');
            else if (tag === 'rect') {
                n.type = 'rect';
                n.w = attr('width');
                n.h = attr('height');
                n.radius = attr('rx', attr('ry'));
                n.matrix = V.matrix(m, V.translate(attr('x'), attr('y')));
            }
            else if (tag === 'circle' || tag === 'ellipse') {
                n.type = 'ellipse';
                let rx = tag === 'circle' ? attr('r') : attr('rx'), ry = tag === 'circle' ? rx : attr('ry');
                n.w = rx * 2;
                n.h = ry * 2;
                n.matrix = V.matrix(m, V.translate(attr('cx') - rx, attr('cy') - ry));
            }
            else if (tag === 'line')
                n.paths = [{ closed: false, points: [V.anchor(attr('x1'), attr('y1')), V.anchor(attr('x2'), attr('y2'))] }];
            else if (tag === 'polyline' || tag === 'polygon') {
                let ns = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
                n.paths = [{ closed: tag === 'polygon', points: [] }];
                for (let i = 0; i + 1 < ns.length; i += 2)
                    n.paths[0].points.push(V.anchor(ns[i], ns[i + 1]));
            }
            else if (tag === 'text') {
                n.type = 'text';
                n.fontSize = parseFloat(style['font-size']) || 16;
                n.fontFamily = (style['font-family'] || 'Arial').replace(/["']/g, '');
                n.fontWeight = style['font-weight'] || 400;
                n.fontStyle = style['font-style'] || 'normal';
                n.letterSpacing = parseFloat(style['letter-spacing']) || 0;
                n.lineHeight = 1.12;
                let spans = [...el.children].filter(e => e.localName === 'tspan');
                n.text = spans.length ? spans.map(e => e.textContent).join('\n') : el.textContent;
                let tx = attr('x'), ty = attr('y');
                if (spans.length) {
                    tx = parseFloat(spans[0].getAttribute('x')) || tx;
                    ty = parseFloat(spans[0].getAttribute('y')) || ty;
                    if (spans.length > 1) {
                        let y2 = parseFloat(spans[1].getAttribute('y'));
                        if (Number.isFinite(y2))
                            n.lineHeight = (y2 - ty) / n.fontSize;
                    }
                }
                n.matrix = V.matrix(m, V.translate(tx, ty - n.fontSize * .91));
                V.measureText(n);
                if (el.getAttribute('text-anchor') === 'middle')
                    n.matrix = V.matrix(n.matrix, V.translate(-n.w / 2, 0));
                if (el.getAttribute('text-anchor') === 'end')
                    n.matrix = V.matrix(n.matrix, V.translate(-n.w, 0));
                if (el.querySelector('textPath'))
                    warnings.add('Text on a path imported as ordinary text.');
            }
            else if (tag === 'image') {
                let src = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
                if (!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(src)) {
                    warnings.add('External and SVG image links omitted for security.');
                    return;
                }
                n.type = 'image';
                n.src = src;
                n.w = attr('width');
                n.h = attr('height');
                n.matrix = V.matrix(m, V.translate(attr('x'), attr('y')));
            }
            else {
                warnings.add('Unsupported SVG element omitted: ' + tag);
                return;
            }
            doc.nodes.push(n);
        }
        walk(root, V.translate(-vb[0], -vb[1]), { fill: '#000', stroke: 'none', opacity: 1 });
        return { doc: V.validateDocument(doc), warnings: [...warnings] };
    }
    function download(data, name, type = 'application/octet-stream') { let blob = data instanceof Blob ? data : new Blob([data], { type }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
    class SessionStorage {
        async open() { if (this.db)
            return; return new Promise((resolve, reject) => { if (!globalThis.indexedDB) {
            reject(Error('IndexedDB unavailable'));
            return;
        } let req = indexedDB.open('vectora-studio', 1); req.onupgradeneeded = () => req.result.createObjectStore('documents'); req.onsuccess = () => { this.db = req.result; resolve(); }; req.onerror = () => reject(req.error); }); }
        async save(doc) { if (!this.db)
            await this.open(); return new Promise((resolve, reject) => { let tx = this.db.transaction('documents', 'readwrite'); tx.objectStore('documents').put(V.clone(doc), 'session'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
        async load() { if (!this.db)
            await this.open(); return new Promise((resolve, reject) => { let r = this.db.transaction('documents', 'readonly').objectStore('documents').get('session'); r.onsuccess = () => resolve(r.result ? V.validateDocument(r.result) : null); r.onerror = () => reject(r.error); }); }
    }
    Object.assign(V, { esc, parseTransform, svgExport, importSVG, download, SessionStorage });
})();

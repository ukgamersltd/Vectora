/* Vectora geometry kernel. Float64 editing, adaptive cubic curves, winding tessellation,
 * affine transforms, planar boolean operations and a bounding-volume spatial index. */
'use strict';
globalThis.V = globalThis.V || {};
(() => {
    const EPS = 1e-8, TAU = Math.PI * 2, K = .5522847498307936;
    const pt = (x = 0, y = 0) => ({ x, y }), add = (a, b) => pt(a.x + b.x, a.y + b.y), sub = (a, b) => pt(a.x - b.x, a.y - b.y), mul = (a, t) => pt(a.x * t, a.y * t), dot = (a, b) => a.x * b.x + a.y * b.y, cross = (a, b) => a.x * b.y - a.y * b.x, len = a => Math.hypot(a.x, a.y), lerp = (a, b, t) => pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), dist = (a, b) => len(sub(a, b));
    const ident = () => [1, 0, 0, 1, 0, 0], matrix = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]], transform = (m, p) => pt(m[0] * p.x + m[2] * p.y + m[4], m[1] * p.x + m[3] * p.y + m[5]);
    function inverse(m) { const d = m[0] * m[3] - m[1] * m[2]; return Math.abs(d) < 1e-12 ? null : [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; }
    const translate = (x, y) => [1, 0, 0, 1, x, y], scale = (x, y = x) => [x, 0, 0, y, 0, 0], rotate = r => [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0], around = (m, p) => matrix(translate(p.x, p.y), matrix(m, translate(-p.x, -p.y))), anchor = (x, y, hi = null, ho = null) => ({ x, y, in: hi, out: ho });
    function bounds(points) { let x = Infinity, y = Infinity, x2 = -Infinity, y2 = -Infinity; for (const p of points) {
        x = Math.min(x, p.x);
        y = Math.min(y, p.y);
        x2 = Math.max(x2, p.x);
        y2 = Math.max(y2, p.y);
    } if (!Number.isFinite(x))
        return { x: 0, y: 0, x2: 0, y2: 0, w: 0, h: 0 }; return { x, y, x2, y2, w: x2 - x, h: y2 - y }; }
    const unionBounds = bs => bounds(bs.flatMap(b => [pt(b.x, b.y), pt(b.x2, b.y2)])), contains = (b, p, pad = 0) => p.x >= b.x - pad && p.x <= b.x2 + pad && p.y >= b.y - pad && p.y <= b.y2 + pad, overlaps = (a, b) => a.x <= b.x2 && a.x2 >= b.x && a.y <= b.y2 && a.y2 >= b.y;
    function segmentDistance(p, a, b) { let d = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), d) / (dot(d, d) || 1))); return dist(p, add(a, mul(d, t))); }
    function cubic(p0, p1, p2, p3, t) { let u = 1 - t; return pt(u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y); }
    function splitCubic(p0, p1, p2, p3, t = .5) { let a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t), d = lerp(a, b, t), e = lerp(b, c, t), f = lerp(d, e, t); return [[p0, a, d, f], [f, e, c, p3]]; }
    function flattenCubic(p0, p1, p2, p3, tol, out, depth = 0) { if (depth >= 14 || (segmentDistance(p1, p0, p3) <= tol && segmentDistance(p2, p0, p3) <= tol)) {
        out.push(pt(p3.x, p3.y));
        return;
    } let [a, b] = splitCubic(p0, p1, p2, p3); flattenCubic(...a, tol, out, depth + 1); flattenCubic(...b, tol, out, depth + 1); }
    function flatten(paths, tol = .35) { return paths.map(path => { let out = [], p = path.points; if (!p.length)
        return { points: out, closed: path.closed }; out.push(pt(p[0].x, p[0].y)); let n = path.closed ? p.length : p.length - 1; for (let i = 0; i < n; i++) {
        let a = p[i], b = p[(i + 1) % p.length];
        if (a.out || b.in)
            flattenCubic(a, a.out || a, b.in || b, b, tol, out);
        else
            out.push(pt(b.x, b.y));
    } if (path.closed && out.length > 1 && dist(out[0], out.at(-1)) < EPS)
        out.pop(); return { points: out, closed: !!path.closed }; }); }
    function shapePaths(n) {
        let w = n.w || 0, h = n.h || 0;
        if (n.type === 'path')
            return n.paths || [];
        if (n.type === 'ellipse') {
            let cx = w / 2, cy = h / 2, rx = w / 2, ry = h / 2;
            return [{ closed: true, points: [anchor(cx, 0, pt(cx - rx * K, 0), pt(cx + rx * K, 0)), anchor(w, cy, pt(w, cy - ry * K), pt(w, cy + ry * K)), anchor(cx, h, pt(cx + rx * K, h), pt(cx - rx * K, h)), anchor(0, cy, pt(0, cy + ry * K), pt(0, cy - ry * K))] }];
        }
        if (n.type === 'polygon' || n.type === 'star') {
            let count = Math.max(3, Math.min(128, n.sides || 5)), p = [], total = n.type === 'star' ? count * 2 : count;
            for (let i = 0; i < total; i++) {
                let a = -Math.PI / 2 + i * TAU / total, r = n.type === 'star' && i % 2 ? (n.innerRatio ?? .45) : 1;
                p.push(anchor(w / 2 + Math.cos(a) * w / 2 * r, h / 2 + Math.sin(a) * h / 2 * r));
            }
            return [{ closed: true, points: p }];
        }
        if (n.type === 'line')
            return [{ closed: false, points: [anchor(0, 0), anchor(w, h)] }];
        let r = Math.max(0, Math.min(n.radius || 0, Math.abs(w) / 2, Math.abs(h) / 2));
        if (!r)
            return [{ closed: true, points: [anchor(0, 0), anchor(w, 0), anchor(w, h), anchor(0, h)] }];
        return [{ closed: true, points: [anchor(r, 0, pt(r - r * K, 0)), anchor(w - r, 0, null, pt(w - r + r * K, 0)), anchor(w, r, pt(w, r - r * K)), anchor(w, h - r, null, pt(w, h - r + r * K)), anchor(w - r, h, pt(w - r + r * K, h)), anchor(r, h, null, pt(r - r * K, h)), anchor(0, h - r, pt(0, h - r + r * K)), anchor(0, r, null, pt(0, r - r * K))] }];
    }
    function localBounds(n) { if (n.type === 'text' || n.type === 'image')
        return { x: 0, y: 0, w: n.w || 100, h: n.h || 30, x2: n.w || 100, y2: n.h || 30 }; return bounds(flatten(shapePaths(n), .2).flatMap(p => p.points)); }
    function worldBounds(n) { let b = localBounds(n), m = n.matrix || ident(); return bounds([pt(b.x, b.y), pt(b.x2, b.y), pt(b.x2, b.y2), pt(b.x, b.y2)].map(p => transform(m, p))); }
    function windingAt(polys, p, rule = 'nonzero') { let w = 0, c = 0; for (let poly of polys) {
        let ps = poly.points || poly;
        for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
            let a = ps[j], b = ps[i];
            if ((a.y > p.y) !== (b.y > p.y)) {
                let x = a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y);
                if (x > p.x) {
                    c++;
                    w += b.y > a.y ? 1 : -1;
                }
            }
        }
    } return rule === 'evenodd' ? !!(c % 2) : w !== 0; }
    function intersection(a, b, c, d) { let r = sub(b, a), s = sub(d, c), den = cross(r, s); if (Math.abs(den) < EPS)
        return null; let q = sub(c, a), t = cross(q, s) / den, u = cross(q, r) / den; if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS)
        return { p: lerp(a, b, t), t, u }; return null; }
    /** Winding-rule scanline tessellation. Splits scan bands at vertices and edge crossings.
     * Supports concave polygons, holes and self-intersections. O(E²) worst-case, worker-isolated. */
    function tessellate(polys, rule = 'nonzero') {
        let edges = [], ys = [], out = [];
        for (let poly of polys) {
            let p = poly.points || poly;
            if (p.length < 3)
                continue;
            for (let i = 0; i < p.length; i++) {
                let a = p[i], b = p[(i + 1) % p.length];
                ys.push(a.y);
                if (Math.abs(a.y - b.y) > EPS)
                    edges.push({ a, b, minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y), minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), sign: b.y > a.y ? 1 : -1 });
            }
        }
        if (edges.length > 16000)
            throw Error('Path exceeds 16,000 tessellation edges. Simplify the path.');
        for (let i = 0; i < edges.length; i++)
            for (let j = i + 1; j < edges.length; j++) {
                let a = edges[i], b = edges[j];
                if (a.maxY <= b.minY + EPS || b.maxY <= a.minY + EPS || a.maxX < b.minX || b.maxX < a.minX)
                    continue;
                let p = intersection(a.a, a.b, b.a, b.b);
                if (p && p.t > EPS && p.t < 1 - EPS && p.u > EPS && p.u < 1 - EPS)
                    ys.push(p.p.y);
            }
        ys.sort((a, b) => a - b);
        ys = ys.filter((y, i) => !i || y - ys[i - 1] > EPS);
        const xAt = (e, y) => e.a.x + (y - e.a.y) * (e.b.x - e.a.x) / (e.b.y - e.a.y), tri = (a, b, c) => { if (Math.abs(cross(sub(b, a), sub(c, a))) > EPS)
            out.push(a.x, a.y, b.x, b.y, c.x, c.y); };
        for (let j = 0; j < ys.length - 1; j++) {
            let y0 = ys[j], y1 = ys[j + 1], ym = (y0 + y1) / 2, active = edges.filter(e => e.minY < ym && e.maxY > ym).map(e => ({ e, x: xAt(e, ym) })).sort((a, b) => a.x - b.x), w = 0, left = null;
            for (let i = 0; i < active.length; i++) {
                let e = active[i].e, old = rule === 'evenodd' ? (w % 2) !== 0 : w !== 0;
                w += rule === 'evenodd' ? 1 : e.sign;
                let inside = rule === 'evenodd' ? (w % 2) !== 0 : w !== 0;
                if (!old && inside)
                    left = e;
                else if (old && !inside && left) {
                    let a = pt(xAt(left, y0), y0), b = pt(xAt(e, y0), y0), c = pt(xAt(e, y1), y1), d = pt(xAt(left, y1), y1);
                    tri(a, b, c);
                    tri(a, c, d);
                    left = null;
                }
            }
        }
        return new Float32Array(out);
    }
    function strokeOutline(polys, width = 1, join = 'round', cap = 'round', miterLimit = 4) {
        let result = [], r = width / 2;
        if (r <= 0)
            return result;
        function circle(p) { let points = [], steps = Math.max(10, Math.min(36, Math.ceil(Math.PI * Math.sqrt(r * 2)))); for (let i = 0; i < steps; i++)
            points.push(add(p, pt(Math.cos(i * TAU / steps) * r, Math.sin(i * TAU / steps) * r))); result.push({ closed: true, points }); }
        const orient = points => { let area = 0; for (let i = 0; i < points.length; i++)
            area += cross(points[i], points[(i + 1) % points.length]); if (area < 0)
            points.reverse(); result.push({ closed: true, points }); };
        for (let poly of polys) {
            let p = poly.points.filter((v, i, a) => !i || dist(v, a[i - 1]) > EPS), n = p.length;
            if (n < 2)
                continue;
            let count = poly.closed ? n : n - 1, dirs = [], normals = [];
            for (let i = 0; i < count; i++) {
                let a = p[i], b = p[(i + 1) % n], d = mul(sub(b, a), 1 / (dist(a, b) || 1)), nn = pt(-d.y * r, d.x * r);
                dirs.push(d);
                normals.push(nn);
                let aa = a, bb = b;
                if (!poly.closed && cap === 'square') {
                    if (i === 0)
                        aa = sub(a, mul(d, r));
                    if (i === count - 1)
                        bb = add(b, mul(d, r));
                }
                orient([add(aa, nn), sub(aa, nn), sub(bb, nn), add(bb, nn)]);
            }
            for (let i = poly.closed ? 0 : 1; i < (poly.closed ? n : n - 1); i++) {
                if (join === 'round') {
                    circle(p[i]);
                    continue;
                }
                let prev = (i - 1 + count) % count, next = i % count;
                for (let side of [-1, 1]) {
                    let a = add(p[i], mul(normals[prev], side)), b = add(p[i], mul(normals[next], side));
                    if (join === 'miter') {
                        let den = cross(dirs[prev], dirs[next]);
                        if (Math.abs(den) > EPS) {
                            let t = cross(sub(b, a), dirs[next]) / den, m = add(a, mul(dirs[prev], t));
                            if (dist(m, p[i]) <= miterLimit * r) {
                                orient([p[i], a, m, b]);
                                continue;
                            }
                        }
                    }
                    orient([p[i], a, b]);
                }
            }
            if (!poly.closed && cap === 'round') {
                circle(p[0]);
                circle(p.at(-1));
            }
        }
        return result;
    }
    const strokeMesh = (polys, width = 1, join = 'round', cap = 'round', miterLimit = 4) => tessellate(strokeOutline(polys, width, join, cap, miterLimit));
    function pathsToD(paths) { const f = v => Number(v.toFixed(4)); let s = ''; for (let path of paths) {
        let p = path.points;
        if (!p.length)
            continue;
        s += `M${f(p[0].x)} ${f(p[0].y)}`;
        for (let i = 1; i < p.length + (path.closed ? 1 : 0); i++) {
            let a = p[i - 1], b = p[i % p.length];
            if (a.out || b.in) {
                let c = a.out || a, d = b.in || b;
                s += `C${f(c.x)} ${f(c.y)} ${f(d.x)} ${f(d.y)} ${f(b.x)} ${f(b.y)}`;
            }
            else
                s += `L${f(b.x)} ${f(b.y)}`;
        }
        if (path.closed)
            s += 'Z';
    } return s; }
    function arcToCubics(a, rx, ry, phi, large, sweep, b) { rx = Math.abs(rx); ry = Math.abs(ry); if (!rx || !ry || dist(a, b) < EPS)
        return []; phi *= Math.PI / 180; let co = Math.cos(phi), si = Math.sin(phi), dx = (a.x - b.x) / 2, dy = (a.y - b.y) / 2, xp = co * dx + si * dy, yp = -si * dx + co * dy, lam = xp * xp / (rx * rx) + yp * yp / (ry * ry); if (lam > 1) {
        let s = Math.sqrt(lam);
        rx *= s;
        ry *= s;
    } let num = Math.max(0, rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp), den = rx * rx * yp * yp + ry * ry * xp * xp, fac = (large === sweep ? -1 : 1) * Math.sqrt(num / (den || 1)), cxp = fac * rx * yp / ry, cyp = -fac * ry * xp / rx, cx = co * cxp - si * cyp + (a.x + b.x) / 2, cy = si * cxp + co * cyp + (a.y + b.y) / 2, theta = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx), end = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx), delta = end - theta; if (sweep && delta < 0)
        delta += TAU; if (!sweep && delta > 0)
        delta -= TAU; let steps = Math.ceil(Math.abs(delta) / (Math.PI / 2)), out = [], map = (x, y) => pt(cx + rx * x * co - ry * y * si, cy + rx * x * si + ry * y * co); for (let i = 0; i < steps; i++) {
        let t0 = theta + delta * i / steps, t1 = theta + delta * (i + 1) / steps, k = 4 / 3 * Math.tan((t1 - t0) / 4);
        out.push([map(Math.cos(t0) - k * Math.sin(t0), Math.sin(t0) + k * Math.cos(t0)), map(Math.cos(t1) + k * Math.sin(t1), Math.sin(t1) - k * Math.cos(t1)), map(Math.cos(t1), Math.sin(t1))]);
    } return out; }
    function parsePath(d) {
        const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) || [], paths = [];
        let i = 0, cmd = '', cur = pt(), start = pt(), p = null, prevCmd = '', lastC = null, lastQ = null;
        const count = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
        const val = () => { if (i >= tokens.length || /^[a-zA-Z]$/.test(tokens[i]))
            throw Error('Malformed SVG path data'); let v = Number(tokens[i++]); if (!Number.isFinite(v) || Math.abs(v) > 1e7)
            throw Error('SVG coordinate out of range'); return v; }, ensure = () => { if (!p) {
            p = { closed: false, points: [anchor(cur.x, cur.y)] };
            paths.push(p);
        } }, append = b => { ensure(); p.points.push(anchor(b.x, b.y)); cur = b; }, appendC = (c1, c2, b) => { ensure(); p.points.at(-1).out = c1; p.points.push(anchor(b.x, b.y, c2)); cur = b; lastC = c2; };
        while (i < tokens.length) {
            if (/^[a-zA-Z]$/.test(tokens[i]))
                cmd = tokens[i++];
            let op = cmd.toUpperCase(), rel = cmd !== op;
            if (op === 'Z') {
                if (p) {
                    p.closed = true;
                    if (p.points.length > 1 && dist(p.points[0], p.points.at(-1)) < EPS) {
                        let last = p.points.pop();
                        p.points[0].in = last.in;
                    }
                    cur = pt(start.x, start.y);
                }
                cmd = '';
                prevCmd = 'Z';
                lastC = lastQ = null;
                continue;
            }
            if (!(op in count))
                throw Error('Unsupported SVG path command: ' + cmd);
            let old = pt(cur.x, cur.y), get = () => { let x = val(), y = val(); return pt(x + (rel ? old.x : 0), y + (rel ? old.y : 0)); };
            if (op === 'M') {
                cur = get();
                start = pt(cur.x, cur.y);
                p = { closed: false, points: [anchor(cur.x, cur.y)] };
                paths.push(p);
                cmd = rel ? 'l' : 'L';
            }
            else if (op === 'L')
                append(get());
            else if (op === 'H')
                append(pt(val() + (rel ? old.x : 0), old.y));
            else if (op === 'V')
                append(pt(old.x, val() + (rel ? old.y : 0)));
            else if (op === 'C') {
                let a = get(), b = get(), c = get();
                appendC(a, b, c);
            }
            else if (op === 'S') {
                let a = /[CS]/.test(prevCmd) && lastC ? sub(mul(old, 2), lastC) : old, b = get(), c = get();
                appendC(a, b, c);
            }
            else if (op === 'Q') {
                let q = get(), b = get();
                appendC(lerp(old, q, 2 / 3), lerp(b, q, 2 / 3), b);
                lastQ = q;
            }
            else if (op === 'T') {
                let q = /[QT]/.test(prevCmd) && lastQ ? sub(mul(old, 2), lastQ) : old, b = get();
                appendC(lerp(old, q, 2 / 3), lerp(b, q, 2 / 3), b);
                lastQ = q;
            }
            else if (op === 'A') {
                let rx = val(), ry = val(), phi = val(), la = val(), sw = val(), b = get(), cs = arcToCubics(old, rx, ry, phi, !!la, !!sw, b);
                if (!cs.length)
                    append(b);
                else
                    for (let c of cs)
                        appendC(...c);
            }
            if (!/[CS]/.test(op))
                lastC = null;
            if (!/[QT]/.test(op))
                lastQ = null;
            prevCmd = op;
        }
        return paths;
    }
    const transformPaths = (paths, m) => paths.map(p => ({ closed: p.closed, points: p.points.map(a => ({ ...transform(m, a), in: a.in ? transform(m, a.in) : null, out: a.out ? transform(m, a.out) : null })) }));
    function simplify(points, tolerance = 1) { if (points.length <= 2)
        return points; let max = 0, index = 0; for (let i = 1; i < points.length - 1; i++) {
        let d = segmentDistance(points[i], points[0], points.at(-1));
        if (d > max) {
            max = d;
            index = i;
        }
    } return max > tolerance ? [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)] : [points[0], points.at(-1)]; }
    const smoothPath = (points, closed = false, tension = .18) => ({ closed, points: points.map((p, i) => { let prev = points[(i - 1 + points.length) % points.length], next = points[(i + 1) % points.length], v = mul(sub(next, prev), tension); return anchor(p.x, p.y, !closed && i === 0 ? null : sub(p, v), !closed && i === points.length - 1 ? null : add(p, v)); }) });
    function booleanPaths(a, b, op = 'union', ruleA = 'nonzero', ruleB = 'nonzero') {
        const A = flatten(a, .25), B = flatten(b, .25), all = [...A, ...B];
        let edges = [];
        for (let poly of all)
            for (let i = 0; i < poly.points.length; i++) {
                let a = poly.points[i], b = poly.points[(i + 1) % poly.points.length];
                if (dist(a, b) > EPS)
                    edges.push({ a, b, ts: [0, 1] });
            }
        if (edges.length > 5000)
            throw Error('Pathfinder limit: simplify to fewer than 5,000 segments.');
        for (let i = 0; i < edges.length; i++)
            for (let j = i + 1; j < edges.length; j++) {
                let a = edges[i], b = edges[j], k = intersection(a.a, a.b, b.a, b.b);
                if (k) {
                    a.ts.push(Math.max(0, Math.min(1, k.t)));
                    b.ts.push(Math.max(0, Math.min(1, k.u)));
                }
                else
                    for (let [e, p] of [[a, b.a], [a, b.b], [b, a.a], [b, a.b]])
                        if (segmentDistance(p, e.a, e.b) < 1e-7) {
                            let d = sub(e.b, e.a), t = dot(sub(p, e.a), d) / dot(d, d);
                            if (t > EPS && t < 1 - EPS)
                                e.ts.push(t);
                        }
            }
        const f = p => { let x = windingAt(A, p, ruleA), y = windingAt(B, p, ruleB); return op === 'union' ? x || y : op === 'intersect' ? x && y : op === 'subtract' ? x && !y : x !== y; };
        let segs = [], keys = new Set(), bb = bounds(all.flatMap(p => p.points)), epsilon = Math.max(1e-7, Math.max(bb.w, bb.h) * 1e-8), quant = epsilon, key = p => Math.round(p.x / quant) + ',' + Math.round(p.y / quant);
        for (let e of edges) {
            e.ts.sort((a, b) => a - b);
            let ts = e.ts.filter((t, i, a) => !i || t - a[i - 1] > EPS);
            for (let i = 0; i < ts.length - 1; i++) {
                let a = lerp(e.a, e.b, ts[i]), b = lerp(e.a, e.b, ts[i + 1]), d = sub(b, a), l = len(d);
                if (l < epsilon)
                    continue;
                let mid = lerp(a, b, .5), n = pt(-d.y / l * epsilon, d.x / l * epsilon), left = f(add(mid, n)), right = f(sub(mid, n));
                if (left === right)
                    continue;
                if (!left)
                    [a, b] = [b, a];
                let k = key(a) + '>' + key(b);
                if (!keys.has(k)) {
                    keys.add(k);
                    segs.push({ a, b, used: false });
                }
            }
        }
        let map = new Map();
        for (let s of segs) {
            let k = key(s.a);
            if (!map.has(k))
                map.set(k, []);
            map.get(k).push(s);
        }
        let result = [];
        for (let seed of segs) {
            if (seed.used)
                continue;
            let cur = seed, points = [], start = key(seed.a), closed = false;
            for (let guard = 0; guard <= segs.length; guard++) {
                cur.used = true;
                points.push(anchor(cur.a.x, cur.a.y));
                let end = key(cur.b);
                if (end === start) {
                    closed = true;
                    break;
                }
                let candidates = (map.get(end) || []).filter(s => !s.used);
                if (!candidates.length)
                    break;
                let v = sub(cur.b, cur.a);
                candidates.sort((a, b) => { const angle = s => { let w = sub(s.b, s.a); return (Math.atan2(cross(v, w), dot(v, w)) + TAU) % TAU; }; return angle(a) - angle(b); });
                cur = candidates[0];
            }
            if (!closed)
                throw Error('Degenerate intersection. Adjust or simplify the input paths.');
            if (points.length >= 3)
                result.push({ closed: true, points });
        }
        return result;
    }
    class SpatialIndex {
        constructor(items = []) { this.reset(items); }
        reset(items) { const build = items => { if (!items.length)
            return null; let b = unionBounds(items.map(i => i.bounds)); if (items.length <= 8)
            return { bounds: b, items }; let axis = b.w > b.h ? 'x' : 'y'; items.sort((a, b) => a.bounds[axis] - b.bounds[axis]); let mid = items.length >> 1; return { bounds: b, left: build(items.slice(0, mid)), right: build(items.slice(mid)) }; }; this.root = build([...items]); }
        query(box) { let out = []; function walk(n) { if (!n || !overlaps(n.bounds, box))
            return; if (n.items) {
            for (let i of n.items)
                if (overlaps(i.bounds, box))
                    out.push(i);
        }
        else {
            walk(n.left);
            walk(n.right);
        } } walk(this.root); return out; }
    }
    Object.assign(V, { EPS, TAU, pt, add, sub, mul, dot, cross, len, lerp, dist, ident, matrix, transform, inverse, translate, scale, rotate, around, anchor, bounds, unionBounds, contains, overlaps, segmentDistance, cubic, splitCubic, flatten, shapePaths, localBounds, worldBounds, windingAt, intersection, tessellate, strokeOutline, strokeMesh, pathsToD, parsePath, arcToCubics, transformPaths, simplify, smoothPath, booleanPaths, SpatialIndex });
})();

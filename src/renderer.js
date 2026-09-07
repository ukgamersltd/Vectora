/* Retained WebGPU backend with worker-built triangle meshes, 4x MSAA, WGSL gradients,
 * per-object affine uniforms, viewport culling and cached text/image textures.
 * Canvas 2D is an explicitly identified compatibility and PNG-export backend. */
'use strict';
(() => {
    const colorCache = new Map();
    let colorCtx;
    function rgba(css) { if (!css || css === 'none')
        return [0, 0, 0, 0]; if (colorCache.has(css))
        return colorCache.get(css); let a; if (/^#[\da-f]{6}$/i.test(css))
        a = [parseInt(css.slice(1, 3), 16) / 255, parseInt(css.slice(3, 5), 16) / 255, parseInt(css.slice(5, 7), 16) / 255, 1];
    else if (/^#[\da-f]{3}$/i.test(css))
        a = [...css.slice(1)].map(c => parseInt(c + c, 16) / 255).concat(1);
    else {
        const c = colorCtx || (colorCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
        c.clearRect(0, 0, 1, 1);
        c.fillStyle = '#000';
        c.fillStyle = css;
        c.fillRect(0, 0, 1, 1);
        a = Array.from(c.getImageData(0, 0, 1, 1).data, v => v / 255);
    } colorCache.set(css, a); return a; }
    function gradientVector(fill, b) { let a = (fill.angle || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), ext = Math.max(1, Math.abs(c) * b.w + Math.abs(s) * b.h), gx = c / ext, gy = s / ext; return [gx, gy, .5 - gx * (b.x + b.w / 2) - gy * (b.y + b.h / 2), 0]; }
    function canvasFill(ctx, fill, b) { if (typeof fill === 'object') {
        let a = (fill.angle || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), ext = Math.max(1, Math.abs(c) * b.w + Math.abs(s) * b.h), x = b.x + b.w / 2, y = b.y + b.h / 2, g = ctx.createLinearGradient(x - c * ext / 2, y - s * ext / 2, x + c * ext / 2, y + s * ext / 2);
        g.addColorStop(0, fill.color0);
        g.addColorStop(1, fill.color1);
        return g;
    } return fill || 'transparent'; }
    function paintText(ctx, n) { ctx.font = `${n.fontStyle || 'normal'} ${n.fontWeight || 400} ${n.fontSize}px ${n.fontFamily || 'Arial'}`; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = canvasFill(ctx, n.fill, V.localBounds(n)); const spacing = n.letterSpacing || 0, lines = String(n.text || '').split('\n'); if ('letterSpacing' in ctx)
        ctx.letterSpacing = spacing + 'px'; lines.forEach((line, i) => { const y = n.fontSize * .91 + i * n.fontSize * n.lineHeight; if (!spacing || 'letterSpacing' in ctx)
        ctx.fillText(line, 0, y);
    else {
        let x = 0;
        for (let ch of line) {
            ctx.fillText(ch, x, y);
            x += ctx.measureText(ch).width + spacing;
        }
    } }); if ('letterSpacing' in ctx)
        ctx.letterSpacing = '0px'; }
    const images = new Map();
    function getImage(src, invalidate) { if (images.has(src))
        return images.get(src); let img = new Image(); img.onload = () => invalidate?.(); img.onerror = () => { img.failed = true; invalidate?.(); }; img.src = src; images.set(src, img); return img; }
    function drawNodeCanvas(ctx, n, invalidate, outline = false) { ctx.save(); ctx.transform(...n.matrix); ctx.globalAlpha = n.opacity ?? 1; let b = V.localBounds(n); if (n.type === 'text') {
        if (!outline && n.fill !== 'none')
            paintText(ctx, n);
        else if (outline) {
            ctx.strokeStyle = '#222';
            ctx.lineWidth = .5;
            ctx.strokeRect(b.x, b.y, b.w, b.h);
        }
    }
    else if (n.type === 'image') {
        let img = getImage(n.src, invalidate);
        if (img.complete && img.naturalWidth)
            ctx.drawImage(img, 0, 0, n.w, n.h);
    }
    else {
        let p = new Path2D(V.pathsToD(V.shapePaths(n)));
        if (!outline && n.fill && n.fill !== 'none') {
            ctx.fillStyle = canvasFill(ctx, n.fill, b);
            ctx.fill(p, n.fillRule || 'nonzero');
        }
        if (outline || n.stroke && n.stroke !== 'none' && n.strokeWidth > 0) {
            ctx.strokeStyle = outline ? '#242424' : n.stroke;
            ctx.lineWidth = outline ? .7 : n.strokeWidth;
            ctx.lineJoin = n.lineJoin || 'round';
            ctx.lineCap = n.lineCap || 'round';
            ctx.miterLimit = n.miterLimit || 4;
            ctx.stroke(p);
        }
    } ctx.restore(); }
    class Camera {
        constructor() { this.zoom = .7; this.x = 80; this.y = 70; this.width = 1000; this.height = 700; }
        world(p) { return V.pt((p.x - this.x) / this.zoom, (p.y - this.y) / this.zoom); }
        screen(p) { return V.pt(p.x * this.zoom + this.x, p.y * this.zoom + this.y); }
        zoomAt(factor, p) { let w = this.world(p); this.zoom = Math.max(.02, Math.min(64, this.zoom * factor)); this.x = p.x - w.x * this.zoom; this.y = p.y - w.y * this.zoom; }
        fit(b, pad = 58) { this.zoom = Math.max(.02, Math.min(8, Math.min((this.width - pad * 2) / Math.max(1, b.w), (this.height - pad * 2) / Math.max(1, b.h)))); this.x = (this.width - b.w * this.zoom) / 2 - b.x * this.zoom + 9; this.y = (this.height - b.h * this.zoom) / 2 - b.y * this.zoom + 9; }
    }
    class MeshService {
        constructor(onResult) { this.onResult = onResult; this.pending = new Map(); this.inFlight = 0; try {
            const embedded = document.getElementById('vectora-worker');
            this.url = embedded ? URL.createObjectURL(new Blob([embedded.textContent], { type: 'text/javascript' })) : null;
            this.worker = new Worker(this.url || new URL('src/geometry-worker.js', document.baseURI));
            this.worker.onmessage = e => { this.inFlight--; onResult(e.data); this.pump(); };
            this.worker.onerror = () => { this.worker?.terminate(); this.worker = null; this.inFlight = 0; onResult({ workerFailure: true }); this.pump(); };
        }
        catch {
            this.worker = null;
        } }
        request(id, key, node, tolerance) { this.pending.set(id, { id, key, node: V.clone(node), tolerance }); this.pump(); }
        pump() { while (this.pending.size && this.inFlight < 2) {
            let [id, data] = this.pending.entries().next().value;
            this.pending.delete(id);
            this.inFlight++;
            if (this.worker)
                this.worker.postMessage(data);
            else
                setTimeout(() => { try {
                    let p = V.flatten(V.shapePaths(data.node), data.tolerance);
                    this.onResult({ ...data, fill: data.node.fill === 'none' ? new Float32Array() : V.tessellate(p, data.node.fillRule), stroke: data.node.stroke === 'none' || !data.node.strokeWidth ? new Float32Array() : V.strokeMesh(p, data.node.strokeWidth, data.node.lineJoin, data.node.lineCap) });
                }
                catch (e) {
                    this.onResult({ ...data, error: e.message });
                }
                finally {
                    this.inFlight--;
                    this.pump();
                } }, 0);
        } }
        destroy() { this.worker?.terminate(); if (this.url)
            URL.revokeObjectURL(this.url); }
    }
    const shader = `
struct Camera { view:vec4f, pan:vec4f }
struct Paint { row0:vec4f, row1:vec4f, color0:vec4f, color1:vec4f, gradient:vec4f, clip:vec4f, options:vec4f }
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var<uniform> paint:Paint;
@group(2) @binding(0) var image:texture_2d<f32>;
@group(2) @binding(1) var imageSampler:sampler;
struct VSOut { @builtin(position) position:vec4f, @location(0) local:vec2f, @location(1) uv:vec2f, @location(2) world:vec2f }
@vertex fn vs(@location(0) local:vec2f,@location(1) uv:vec2f)->VSOut {
 var o:VSOut;let world=vec2f(dot(paint.row0.xyz,vec3f(local,1)),dot(paint.row1.xyz,vec3f(local,1)));
 let screen=world*camera.view.z+camera.pan.xy;
 o.position=vec4f(screen.x/camera.view.x*2-1,1-screen.y/camera.view.y*2,0,1);o.local=local;o.uv=uv;o.world=world;return o;
}
@fragment fn fs(i:VSOut)->@location(0) vec4f {
 if(paint.options.x>0.5 && (i.world.x<paint.clip.x || i.world.y<paint.clip.y || i.world.x>paint.clip.z || i.world.y>paint.clip.w)){discard;}
 var c=paint.color0;
 if(paint.row1.w>1.5){c=textureSample(image,imageSampler,i.uv);}
 else if(paint.row1.w>0.5){let t=clamp(dot(i.local,paint.gradient.xy)+paint.gradient.z,0,1);c=mix(paint.color0,paint.color1,t);}
 let alpha=c.a*paint.row0.w;return vec4f(c.rgb*alpha,alpha);
}`;
    class Renderer extends EventTarget {
        constructor({ gpu, fallback, background, store, camera, invalidate }) { super(); Object.assign(this, { canvas: gpu, fallback, background, store, camera, invalidate }); this.cache = new Map(); this.textures = new Map(); this.mode = 'Initializing'; this.stats = { vertices: 0, draws: 0, frameMs: 0 }; this.clip = false; this.outline = false; this.grid = false; this.meshes = new MeshService(data => this.meshReady(data)); this.ready = this.init(); }
        async init() {
            try {
                if (new URLSearchParams(location.search).get('renderer') === 'canvas')
                    throw Error('Canvas renderer selected explicitly');
                if (!navigator.gpu)
                    throw Error('WebGPU is not exposed by this browser');
                const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
                if (!adapter)
                    throw Error('No WebGPU adapter');
                const adapterDetails = adapter.info;
                this.adapterInfo = [adapterDetails?.vendor, adapterDetails?.architecture, adapterDetails?.device, adapterDetails?.description].filter(Boolean).join(' · ') || 'WebGPU adapter';
                if (new URLSearchParams(location.search).get('renderer') !== 'webgpu' && (adapterDetails?.isFallbackAdapter || /swiftshader|lavapipe|llvmpipe|software/i.test(this.adapterInfo)))
                    throw Error('Software GPU detected (' + this.adapterInfo + '). Canvas 2D is preferred for interactive use. Add ?renderer=webgpu to explicitly test the software WebGPU backend.');
                this.device = await adapter.requestDevice();
                this.device.lost.then(info => { this.deviceLost = true; this.reason = info.message || 'GPU device lost'; this.useFallback(); });
                this.device.addEventListener('uncapturederror', e => { console.error('WebGPU validation:', e.error); this.reason = e.error.message; this.useFallback(); });
                const d = this.device;
                this.context = this.canvas.getContext('webgpu');
                if (!this.context)
                    throw Error('Cannot create WebGPU canvas');
                this.format = navigator.gpu.getPreferredCanvasFormat();
                this.context.configure({ device: d, format: this.format, alphaMode: 'premultiplied' });
                this.cameraLayout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }] });
                this.paintLayout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 112 } }] });
                this.textureLayout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }] });
                let module = d.createShaderModule({ code: shader }), info = await module.getCompilationInfo();
                if (info.messages.some(m => m.type === 'error'))
                    throw Error(info.messages.map(m => m.message).join('\n'));
                this.pipeline = await d.createRenderPipelineAsync({ layout: d.createPipelineLayout({ bindGroupLayouts: [this.cameraLayout, this.paintLayout, this.textureLayout] }), vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32x2' }] }] }, fragment: { module, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] }, primitive: { topology: 'triangle-list' }, multisample: { count: 4 } });
                this.cameraBuffer = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
                this.cameraGroup = d.createBindGroup({ layout: this.cameraLayout, entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }] });
                this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear' });
                let white = document.createElement('canvas');
                white.width = white.height = 1;
                white.getContext('2d').fillRect(0, 0, 1, 1);
                this.white = this.makeTexture(white);
                this.mode = 'WebGPU';
                this.canvas.hidden = false;
                this.fallback.hidden = true;
            }
            catch (e) {
                this.reason = e.message;
                this.useFallback();
            }
            this.dispatchEvent(new Event('ready'));
            this.invalidate();
            return this.mode;
        }
        useFallback() { this.mode = 'Canvas 2D'; this.canvas.hidden = true; this.fallback.hidden = false; this.dispatchEvent(new Event('ready')); this.invalidate(); }
        resize(w, h, dpr) { this.dpr = Math.min(3, dpr || 1, (this.device?.limits.maxTextureDimension2D || 16384) / Math.max(w, h)); let pw = Math.max(1, Math.round(w * this.dpr)), ph = Math.max(1, Math.round(h * this.dpr)); for (let canvas of [this.canvas, this.fallback, this.background]) {
            if (canvas.width !== pw || canvas.height !== ph) {
                canvas.width = pw;
                canvas.height = ph;
            }
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
        } if (this.msaa && (this.msaa.width !== pw || this.msaa.height !== ph)) {
            this.msaa.destroy();
            this.msaa = null;
        } }
        makeBuffer(xy, quad = false) { if (!this.device || this.deviceLost || !xy.length)
            return null; let data; if (quad)
            data = xy;
        else {
            data = new Float32Array(xy.length * 2);
            for (let i = 0, j = 0; i < xy.length; i += 2, j += 4) {
                data[j] = xy[i];
                data[j + 1] = xy[i + 1];
            }
        } let buffer = this.device.createBuffer({ size: Math.max(16, data.byteLength), usage: GPUBufferUsage.VERTEX, mappedAtCreation: true }); new Float32Array(buffer.getMappedRange()).set(data); buffer.unmap(); return { buffer, count: data.length / 4 }; }
        meshReady(data) { if (data.workerFailure) {
            for (let c of this.cache.values())
                if (c.pending)
                    c.key = '';
            this.invalidate();
            return;
        } let c = this.cache.get(data.id); if (!c || c.key !== data.key)
            return; c.pending = false; if (data.error) {
            c.error = data.error;
            console.warn('Tessellation:', data.error);
            this.reason = data.error;
            this.useFallback();
            return;
        } c.fill?.buffer.destroy(); c.stroke?.buffer.destroy(); try {
            c.fill = this.makeBuffer(data.fill);
            c.stroke = this.makeBuffer(data.stroke);
        }
        catch (e) {
            this.reason = e.message;
            this.useFallback();
        } this.invalidate(); }
        mesh(n) { let s = Math.max(Math.hypot(n.matrix[0], n.matrix[1]), Math.hypot(n.matrix[2], n.matrix[3])), tol = Math.max(.03, Math.min(2, Math.pow(2, Math.floor(Math.log2(.45 / (this.camera.zoom * (s || 1))))))), key = JSON.stringify([n.type, n.w, n.h, n.radius, n.sides, n.innerRatio, n.paths, n.fill !== 'none', n.stroke !== 'none', n.strokeWidth, n.lineJoin, n.lineCap, n.fillRule, tol]), c = this.cache.get(n.id); if (!c) {
            c = { key: '', fill: null, stroke: null };
            this.cache.set(n.id, c);
        } if (c.key !== key) {
            c.key = key;
            c.pending = true;
            this.meshes.request(n.id, key, n, tol);
        } return c; }
        makeTexture(source) { const d = this.device, w = source.width || source.naturalWidth, h = source.height || source.naturalHeight, texture = d.createTexture({ size: [Math.max(1, w), Math.max(1, h)], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT }); d.queue.copyExternalImageToTexture({ source }, { texture, premultipliedAlpha: false }, [w, h]); const group = d.createBindGroup({ layout: this.textureLayout, entries: [{ binding: 0, resource: texture.createView() }, { binding: 1, resource: this.sampler }] }); return { texture, group }; }
        texture(n) { let effective = this.camera.zoom * this.dpr * Math.max(Math.hypot(n.matrix[0], n.matrix[1]), Math.hypot(n.matrix[2], n.matrix[3])), res = Math.max(1, Math.min(4, Math.pow(2, Math.ceil(Math.log2(effective))))), key = JSON.stringify([n.type, n.text, n.fontSize, n.fontFamily, n.fontWeight, n.fontStyle, n.letterSpacing, n.lineHeight, n.w, n.h, n.fill, n.src, res]), old = this.textures.get(n.id); if (old?.key === key)
            return old; let source, pad = n.type === 'text' ? 4 : 0; if (n.type === 'image') {
            let img = getImage(n.src, this.invalidate);
            if (!img.complete || !img.naturalWidth)
                return null;
            res = Math.min(1, 4096 / img.naturalWidth, 4096 / img.naturalHeight);
            source = document.createElement('canvas');
            source.width = Math.max(1, Math.ceil(img.naturalWidth * res));
            source.height = Math.max(1, Math.ceil(img.naturalHeight * res));
            source.getContext('2d').drawImage(img, 0, 0, source.width, source.height);
        }
        else {
            res = Math.min(res, 4096 / (n.w + pad * 2), 4096 / (n.h + pad * 2));
            source = document.createElement('canvas');
            source.width = Math.max(1, Math.ceil((n.w + pad * 2) * res));
            source.height = Math.max(1, Math.ceil((n.h + pad * 2) * res));
            let c = source.getContext('2d');
            c.scale(res, res);
            c.translate(pad, pad);
            paintText(c, n);
        } old?.texture.destroy(); old?.mesh.buffer.destroy(); let t = this.makeTexture(source), x = -pad, y = -pad, w = n.w + pad * 2, h = n.h + pad * 2, verts = new Float32Array([x, y, 0, 0, x + w, y, 1, 0, x + w, y + h, 1, 1, x, y, 0, 0, x + w, y + h, 1, 1, x, y + h, 0, 1]), entry = { key, ...t, mesh: this.makeBuffer(verts, true), bytes: source.width * source.height * 4 }; this.textures.set(n.id, entry); return entry; }
        drawBackground() { const c = this.background.getContext('2d'), cam = this.camera, dark = document.documentElement.dataset.theme !== 'light'; c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, cam.width, cam.height); c.fillStyle = dark ? '#27282A' : '#C9CBCE'; c.fillRect(0, 0, cam.width, cam.height); for (let b of this.store.doc.artboards) {
            let p = cam.screen(V.pt(b.x, b.y)), w = b.w * cam.zoom, h = b.h * cam.zoom;
            c.save();
            c.shadowColor = '#00000050';
            c.shadowBlur = 12;
            c.shadowOffsetY = 3;
            c.fillStyle = b.background || '#fff';
            c.fillRect(p.x, p.y, w, h);
            c.restore();
            if (this.grid) {
                c.save();
                c.beginPath();
                c.rect(p.x, p.y, w, h);
                c.clip();
                c.strokeStyle = '#00000018';
                c.lineWidth = .5;
                let step = 20 * cam.zoom;
                if (step > 4) {
                    c.beginPath();
                    for (let x = p.x; x <= p.x + w; x += step) {
                        c.moveTo(x, p.y);
                        c.lineTo(x, p.y + h);
                    }
                    for (let y = p.y; y <= p.y + h; y += step) {
                        c.moveTo(p.x, y);
                        c.lineTo(p.x + w, y);
                    }
                    c.stroke();
                }
                c.restore();
            }
            c.font = '10px Arial';
            c.fillStyle = dark ? '#A9ABAE' : '#505153';
            c.fillText(b.name, p.x, p.y - 12);
        } }
        drawFallback() { let c = this.fallback.getContext('2d'), cam = this.camera; c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, cam.width, cam.height); c.translate(cam.x, cam.y); c.scale(cam.zoom, cam.zoom); let nodes = this.store.visibleNodes; for (let n of nodes) {
            if (n.id === this.editingText)
                continue;
            c.save();
            if (this.clip) {
                let b = this.store.doc.artboards.find(b => b.id === n.artboardId);
                if (b) {
                    c.beginPath();
                    c.rect(b.x, b.y, b.w, b.h);
                    c.clip();
                }
            }
            drawNodeCanvas(c, n, this.invalidate, this.outline);
            c.restore();
        } this.stats.draws = nodes.length; this.stats.vertices = 0; }
        frame() { const start = performance.now(); this.drawBackground(); if (this.mode !== 'WebGPU' || this.outline) {
            this.canvas.hidden = true;
            this.fallback.hidden = false;
            this.drawFallback();
            this.stats.frameMs = performance.now() - start;
            return;
        } this.canvas.hidden = false; this.fallback.hidden = true; try {
            this.drawGPU();
        }
        catch (e) {
            console.error(e);
            this.reason = e.message;
            this.useFallback();
            this.drawFallback();
        } this.stats.frameMs = performance.now() - start; }
        drawGPU() {
            const d = this.device, cam = this.camera, draws = [], viewport = { x: -cam.x / cam.zoom, y: -cam.y / cam.zoom, x2: (cam.width - cam.x) / cam.zoom, y2: (cam.height - cam.y) / cam.zoom }, visible = new Set(this.store.index.query(viewport).map(e => e.id)), alive = new Set(this.store.doc.nodes.map(n => n.id));
            for (let [id, c] of this.cache)
                if (!alive.has(id)) {
                    c.fill?.buffer.destroy();
                    c.stroke?.buffer.destroy();
                    this.cache.delete(id);
                }
            for (let [id, c] of this.textures)
                if (!alive.has(id)) {
                    c.texture.destroy();
                    c.mesh.buffer.destroy();
                    this.textures.delete(id);
                }
            for (let n of this.store.visibleNodes) {
                if (!visible.has(n.id) || n.id === this.editingText)
                    continue;
                if (n.type === 'text' || n.type === 'image') {
                    if (n.type === 'text' && n.fill === 'none')
                        continue;
                    let t = this.texture(n);
                    if (t)
                        draws.push({ node: n, mesh: t.mesh, paint: '#fff', texture: t, kind: 2 });
                }
                else {
                    let c = this.mesh(n);
                    if (c.fill && n.fill !== 'none')
                        draws.push({ node: n, mesh: c.fill, paint: n.fill, texture: this.white, kind: typeof n.fill === 'object' ? 1 : 0 });
                    if (c.stroke && n.stroke !== 'none')
                        draws.push({ node: n, mesh: c.stroke, paint: n.stroke, texture: this.white, kind: 0 });
                }
            }
            const needed = Math.max(256, draws.length * 256);
            if (!this.paintBuffer || this.paintCapacity < needed) {
                this.paintBuffer?.destroy();
                this.paintCapacity = Math.pow(2, Math.ceil(Math.log2(needed)));
                this.paintBuffer = d.createBuffer({ size: this.paintCapacity, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
                this.paintGroup = d.createBindGroup({ layout: this.paintLayout, entries: [{ binding: 0, resource: { buffer: this.paintBuffer, size: 112 } }] });
            }
            let uniforms = new Float32Array(needed / 4);
            for (let i = 0; i < draws.length; i++) {
                const { node: n, paint, kind } = draws[i], m = n.matrix, offset = i * 64, fill = typeof paint === 'object' ? paint : null, b = this.store.doc.artboards.find(b => b.id === n.artboardId);
                uniforms.set([m[0], m[2], m[4], n.opacity ?? 1, m[1], m[3], m[5], kind], offset);
                uniforms.set(rgba(fill ? fill.color0 : paint), offset + 8);
                uniforms.set(rgba(fill ? fill.color1 : paint), offset + 12);
                if (fill)
                    uniforms.set(gradientVector(fill, V.localBounds(n)), offset + 16);
                if (b) {
                    uniforms.set([b.x, b.y, b.x + b.w, b.y + b.h], offset + 20);
                    uniforms[offset + 24] = this.clip ? 1 : 0;
                }
            }
            d.queue.writeBuffer(this.cameraBuffer, 0, new Float32Array([cam.width, cam.height, cam.zoom, 0, cam.x, cam.y, 0, 0]));
            d.queue.writeBuffer(this.paintBuffer, 0, uniforms);
            if (!this.msaa)
                this.msaa = d.createTexture({ size: [this.canvas.width, this.canvas.height], format: this.format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
            let encoder = d.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.msaa.createView(), resolveTarget: this.context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'discard' }] });
            pass.setPipeline(this.pipeline);
            pass.setBindGroup(0, this.cameraGroup);
            let vertices = 0;
            for (let i = 0; i < draws.length; i++) {
                let q = draws[i];
                pass.setBindGroup(1, this.paintGroup, [i * 256]);
                pass.setBindGroup(2, q.texture.group);
                pass.setVertexBuffer(0, q.mesh.buffer);
                pass.draw(q.mesh.count);
                vertices += q.mesh.count;
            }
            pass.end();
            d.queue.submit([encoder.finish()]);
            this.stats.vertices = vertices;
            this.stats.draws = draws.length;
            this.stats.textureMB = [...this.textures.values()].reduce((s, t) => s + t.bytes, 0) / 1048576;
        }
        async exportPNG(board, scale = 2, transparent = false) { const canvas = document.createElement('canvas'); if (board.w * scale > 16384 || board.h * scale > 16384 || board.w * board.h * scale * scale > 64000000)
            throw Error('Export exceeds the 64-megapixel limit.'); canvas.width = Math.ceil(board.w * scale); canvas.height = Math.ceil(board.h * scale); let ctx = canvas.getContext('2d'); ctx.scale(scale, scale); ctx.translate(-board.x, -board.y); if (!transparent) {
            for (let b of (board.all ? this.store.doc.artboards : [board])) {
                ctx.fillStyle = b.background || '#fff';
                ctx.fillRect(b.x, b.y, b.w, b.h);
            }
        } await Promise.all(this.store.visibleNodes.filter(n => n.type === 'image').map(n => new Promise(resolve => { let img = getImage(n.src); if (img.complete)
            resolve();
        else {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
        } }))); for (let n of this.store.visibleNodes)
            drawNodeCanvas(ctx, n, () => { }); return new Promise(resolve => canvas.toBlob(resolve, 'image/png')); }
    }
    Object.assign(V, { rgba, gradientVector, canvasFill, paintText, drawNodeCanvas, getImage, Camera, MeshService, Renderer });
})();

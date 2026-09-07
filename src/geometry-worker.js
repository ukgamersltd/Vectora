'use strict';
if (!globalThis.V)
    importScripts('geometry.js');
onmessage = ({ data }) => { const { id, key, node, tolerance } = data; try {
    const polys = V.flatten(V.shapePaths(node), tolerance), fill = node.fill === 'none' ? new Float32Array() : V.tessellate(polys, node.fillRule), stroke = node.stroke === 'none' || !node.strokeWidth ? new Float32Array() : V.strokeMesh(polys, node.strokeWidth, node.lineJoin, node.lineCap, node.miterLimit || 4);
    postMessage({ id, key, fill, stroke }, [fill.buffer, stroke.buffer]);
}
catch (e) {
    postMessage({ id, key, error: e.message });
} };

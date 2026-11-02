'use strict';

/**
 * Dev helper: generate the 3D glasses accessory used by the video effects engine.
 *
 * Writes public/video-effects/assets/glasses/glasses-3d.glb (glTF 2.0 binary) from procedural
 * geometry, so the asset is original, reproducible and has no third-party license.
 *
 * Model convention (see public/video-effects/model-renderer.js): 1 unit = distance between the
 * outer eye corners, origin at the nose bridge, +X subject's left, +Y up, +Z out of the face.
 *
 * Usage: node scripts/generate-video-effects-glb.js
 */

const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, '../public/video-effects/assets/glasses/glasses-3d.glb');

const EYE_X = 0.33;
const RIM_RADIUS = 0.235;
const RIM_TUBE = 0.022;
const RIM_SQUASH = 0.8;
const LENS_Z = 0.12;

function createMesh() {
    return { positions: [], normals: [], indices: [] };
}

function normalize([x, y, z]) {
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
}

function appendVertex(mesh, position, normal) {
    mesh.positions.push(...position);
    mesh.normals.push(...normalize(normal));
    return mesh.positions.length / 3 - 1;
}

// Torus (or torus arc) in the XY plane, squashed vertically, centered at `center`
function addTorus(mesh, center, radius, tube, { arc = Math.PI * 2, start = 0, squash = 1, segments = 64, sides = 12 }) {
    const base = mesh.positions.length / 3;
    const closed = Math.abs(arc - Math.PI * 2) < 1e-6;
    const rings = closed ? segments : segments + 1;
    for (let i = 0; i < rings; i++) {
        const u = start + (i / segments) * arc;
        for (let j = 0; j < sides; j++) {
            const v = (j / sides) * Math.PI * 2;
            const ring = radius + tube * Math.cos(v);
            appendVertex(
                mesh,
                [
                    center[0] + ring * Math.cos(u),
                    center[1] + ring * Math.sin(u) * squash,
                    center[2] + tube * Math.sin(v),
                ],
                [Math.cos(v) * Math.cos(u), (Math.cos(v) * Math.sin(u)) / squash, Math.sin(v)]
            );
        }
    }
    const ringCount = closed ? segments : segments;
    for (let i = 0; i < ringCount; i++) {
        const next = closed ? (i + 1) % segments : i + 1;
        for (let j = 0; j < sides; j++) {
            const a = base + i * sides + j;
            const b = base + next * sides + j;
            const c = base + next * sides + ((j + 1) % sides);
            const d = base + i * sides + ((j + 1) % sides);
            mesh.indices.push(a, b, d, b, c, d);
        }
    }
}

// Slightly domed elliptical lens facing +Z
function addLens(mesh, center, radius, squash, bulge, segments = 64) {
    const base = mesh.positions.length / 3;
    appendVertex(mesh, [center[0], center[1], center[2] + bulge], [0, 0, 1]);
    for (let i = 0; i < segments; i++) {
        const u = (i / segments) * Math.PI * 2;
        const x = Math.cos(u);
        const y = Math.sin(u);
        appendVertex(mesh, [center[0] + x * radius, center[1] + y * radius * squash, center[2]], [x * 0.2, y * 0.2, 1]);
    }
    for (let i = 0; i < segments; i++) {
        mesh.indices.push(base, base + 1 + i, base + 1 + ((i + 1) % segments));
    }
}

function addBox(mesh, min, max) {
    const faces = [
        { normal: [1, 0, 0], corners: [[max[0], min[1], max[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [max[0], max[1], max[2]]] },
        { normal: [-1, 0, 0], corners: [[min[0], min[1], min[2]], [min[0], min[1], max[2]], [min[0], max[1], max[2]], [min[0], max[1], min[2]]] },
        { normal: [0, 1, 0], corners: [[min[0], max[1], max[2]], [max[0], max[1], max[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]]] },
        { normal: [0, -1, 0], corners: [[min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], min[1], max[2]], [min[0], min[1], max[2]]] },
        { normal: [0, 0, 1], corners: [[min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]]] },
        { normal: [0, 0, -1], corners: [[max[0], min[1], min[2]], [min[0], min[1], min[2]], [min[0], max[1], min[2]], [max[0], max[1], min[2]]] },
    ]; // prettier-ignore
    faces.forEach(({ normal, corners }) => {
        const base = mesh.positions.length / 3;
        corners.forEach((corner) => appendVertex(mesh, corner, normal));
        mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
}

function buildGlasses() {
    const frame = createMesh();
    const lenses = createMesh();
    const hinges = createMesh();

    [-1, 1].forEach((side) => {
        const center = [side * EYE_X, 0, LENS_Z];
        addTorus(frame, center, RIM_RADIUS, RIM_TUBE, { squash: RIM_SQUASH });
        addLens(lenses, center, RIM_RADIUS, RIM_SQUASH, 0.025);
        const outer = side * (EYE_X + RIM_RADIUS + 0.01);
        // Temple arm running back towards the ear
        const x0 = Math.min(outer, outer + side * 0.035);
        const x1 = Math.max(outer, outer + side * 0.035);
        addBox(frame, [x0, 0.01, -1.05], [x1, 0.06, LENS_Z - 0.01]);
        addBox(hinges, [Math.min(outer - side * 0.03, outer + side * 0.04), 0.0, LENS_Z - 0.05], [Math.max(outer - side * 0.03, outer + side * 0.04), 0.075, LENS_Z + 0.02]);
    }); // prettier-ignore

    // Bridge arc between the two rims
    const innerGap = EYE_X - RIM_RADIUS;
    addTorus(frame, [0, 0.02, LENS_Z], innerGap + 0.005, 0.02, { arc: Math.PI, start: 0, segments: 24, sides: 10 });
    return { frame, lenses, hinges };
}

function align4(length) {
    return (length + 3) & ~3;
}

function writeGlb({ frame, lenses, hinges }) {
    const meshes = [
        { name: 'Frame', mesh: frame, material: 0 },
        { name: 'Lenses', mesh: lenses, material: 1 },
        { name: 'Hinges', mesh: hinges, material: 2 },
    ];
    const chunks = [];
    const bufferViews = [];
    const accessors = [];
    let byteLength = 0;

    function addView(typedArray, target) {
        const offset = byteLength;
        chunks.push({ offset, data: Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength) });
        byteLength = align4(offset + typedArray.byteLength);
        bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: typedArray.byteLength, target });
        return bufferViews.length - 1;
    }

    const gltfMeshes = meshes.map(({ name, mesh, material }) => {
        const positions = new Float32Array(mesh.positions);
        const normals = new Float32Array(mesh.normals);
        const indices = new Uint16Array(mesh.indices);
        if (positions.length / 3 > 65535) throw new Error(`${name}: too many vertices for 16-bit indices`);
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < positions.length; i += 3) {
            for (let k = 0; k < 3; k++) {
                min[k] = Math.min(min[k], positions[i + k]);
                max[k] = Math.max(max[k], positions[i + k]);
            }
        }
        accessors.push({ bufferView: addView(positions, 34962), componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max }); // prettier-ignore
        const position = accessors.length - 1;
        accessors.push({ bufferView: addView(normals, 34962), componentType: 5126, count: normals.length / 3, type: 'VEC3' }); // prettier-ignore
        const normal = accessors.length - 1;
        accessors.push({ bufferView: addView(indices, 34963), componentType: 5123, count: indices.length, type: 'SCALAR' }); // prettier-ignore
        const index = accessors.length - 1;
        return { name, primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices: index, material }] };
    });

    const json = {
        asset: { version: '2.0', generator: 'MiroTalk video effects generator', copyright: 'MiroTalk SFU (AGPL-3.0)' },
        scene: 0,
        scenes: [{ name: 'Glasses', nodes: [0, 1, 2] }],
        nodes: gltfMeshes.map((mesh, index) => ({ name: mesh.name, mesh: index })),
        meshes: gltfMeshes,
        materials: [
            { name: 'Frame', pbrMetallicRoughness: { baseColorFactor: [0.04, 0.04, 0.05, 1], metallicFactor: 0.2, roughnessFactor: 0.35 } },
            {
                name: 'Lens',
                pbrMetallicRoughness: { baseColorFactor: [0.1, 0.16, 0.26, 0.55], metallicFactor: 0, roughnessFactor: 0.05 },
                alphaMode: 'BLEND',
                doubleSided: true,
            },
            { name: 'Hinge', pbrMetallicRoughness: { baseColorFactor: [0.85, 0.7, 0.4, 1], metallicFactor: 1, roughnessFactor: 0.3 } },
        ],
        buffers: [{ byteLength }],
        bufferViews,
        accessors,
    }; // prettier-ignore

    const bin = Buffer.alloc(byteLength);
    chunks.forEach(({ offset, data }) => data.copy(bin, offset));
    let jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
    jsonBuffer = Buffer.concat([jsonBuffer, Buffer.alloc(align4(jsonBuffer.length) - jsonBuffer.length, 0x20)]);

    const header = Buffer.alloc(12);
    const totalLength = 12 + 8 + jsonBuffer.length + 8 + bin.length;
    header.writeUInt32LE(0x46546c67, 0); // 'glTF'
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(totalLength, 8);
    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonBuffer.length, 0);
    jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(bin.length, 0);
    binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN'
    return Buffer.concat([header, jsonHeader, jsonBuffer, binHeader, bin]);
}

const glb = writeGlb(buildGlasses());
fs.writeFileSync(OUTPUT, glb);
console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)} (${glb.length} bytes)`);

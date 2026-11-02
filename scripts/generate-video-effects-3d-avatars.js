'use strict';

/**
 * Dev helper: build the realistic 3D avatars ("3D Avatars" tab) of the video effects engine.
 *
 * Downloads permissively licensed source models and writes, for each avatar,
 * public/video-effects/assets/avatars-3d/<id>/model.glb (+ thumb.webp with --thumbs), then
 * regenerates public/video-effects/effects/avatars-3d.js. Every model follows the engine convention:
 *
 *   - 1 unit = distance between the outer eye corners, origin between the eyes,
 *     +X subject's left, +Y up, +Z out of the face (see public/video-effects/model-renderer.js)
 *   - morph targets named like the MediaPipe/ARKit blendshapes (eyeBlinkLeft, jawOpen, ...)
 *   - busts: a 2 joint skin, "avatarBody" (root) and "avatarHead" (pivot in the neck), so the
 *     head can follow the user while the shoulders stay calmer
 *   - WebP textures, quantized + meshopt compressed geometry
 *
 * Sources (see public/video-effects/assets/avatars-3d/LICENSE.md):
 *   - Microsoft Rocketbox avatars (MIT): FBX -> FBX2glTF, arms lowered, cropped to a bust,
 *     only the 52 ARKit blendshapes kept ("AK_09_EyeBlinkLeft" -> "eyeBlinkLeft")
 *   - MediaPipe raccoon head (Apache-2.0): already uses the MediaPipe blendshape names
 *
 * Usage (the tools are not project dependencies):
 *   npm i --no-save fbx2gltf @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp three
 *   node scripts/generate-video-effects-3d-avatars.js
 *
 * Thumbnails are rendered by Chrome (needs puppeteer-core; set CHROME_PATH if Chrome is elsewhere):
 *   npm i --no-save puppeteer-core sharp
 *   node scripts/generate-video-effects-3d-avatars.js --thumbs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const PUBLIC_DIR = path.join(__dirname, '../public');
const OUTPUT_DIR = path.join(PUBLIC_DIR, 'video-effects/assets/avatars-3d');
const EFFECTS_FILE = path.join(PUBLIC_DIR, 'video-effects/effects/avatars-3d.js');
const CACHE_DIR = path.join(os.tmpdir(), 'mirotalk-vfx-avatars-3d');
const ROCKETBOX = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars/Adults';
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.181.0';

const AVATARS = [
    { id: 'man', label: 'Man', source: 'rocketbox', name: 'Male_Adult_01' },
    { id: 'man-2', label: 'Man 2', source: 'rocketbox', name: 'Male_Adult_12' },
    { id: 'woman', label: 'Woman', source: 'rocketbox', name: 'Female_Adult_01' },
    { id: 'woman-2', label: 'Woman 2', source: 'rocketbox', name: 'Female_Adult_11' },
    { id: 'man-3', label: 'Man 3', source: 'rocketbox', name: 'Male_Adult_04' },
    { id: 'woman-3', label: 'Woman 3', source: 'rocketbox', name: 'Female_Adult_15' },
    { id: 'man-4', label: 'Man 4', source: 'rocketbox', name: 'Male_Adult_10' },
    { id: 'woman-4', label: 'Woman 4', source: 'rocketbox', name: 'Female_Adult_12' },
    {
        id: 'man-5',
        label: 'Man 5',
        source: 'rocketbox',
        name: 'Male_Adult_03',
        // Brown hair cards over a grey scalp texture
        hair: { saturation: 0.35, brightness: 1.3 },
    },
    {
        id: 'raccoon',
        label: 'Raccoon',
        source: 'url',
        url: 'https://storage.googleapis.com/mediapipe-tasks/face_landmarker/raccoon_head_small.glb',
        // Cartoon eyes are far apart: grown so its mouth lands on the user's mouth and it covers the face
        scale: 1.7,
    },
];

// MediaPipe blendshape names in the ARKit order used by Rocketbox (AK_01 ... AK_52)
const ARKIT = [
    'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff',
    'cheekSquintLeft', 'cheekSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft',
    'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
    'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
    'jawForward', 'jawLeft', 'jawOpen', 'jawRight', 'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight',
    'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft',
    'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight',
    'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper', 'mouthSmileLeft',
    'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
    'noseSneerLeft', 'noseSneerRight', 'tongueOut',
]; // prettier-ignore

// Outer eye corners are ~1.43x further apart than the eye centres (adult average)
const EYE_CENTER_DISTANCE = 1 / 1.43;
// Rocketbox bust: arms lowered to this angle below horizontal, cut this far (m) below the neck joint
const ARM_ANGLE = 78;
const BUST_DEPTH = 0.2;
// Triangles are kept a little below the cut: the renderer clips the bust with a straight plane
const BUST_MARGIN = 0.03;
const TEXTURE_SIZE = { head: 1024, body: 512, opacity: 1024 };
const THUMB_SIZE = 256;

// ---------------------------------------------------------------------------------------------
// Column-major 4x4 matrix helpers (glTF layout)

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mat4Multiply(a, b) {
    const out = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
            out[c * 4 + r] = sum;
        }
    }
    return out;
}

function mat4Invert(m) {
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
    return [
        (a11 * b11 - a12 * b10 + a13 * b09) * det,
        (a02 * b10 - a01 * b11 - a03 * b09) * det,
        (a31 * b05 - a32 * b04 + a33 * b03) * det,
        (a22 * b04 - a21 * b05 - a23 * b03) * det,
        (a12 * b08 - a10 * b11 - a13 * b07) * det,
        (a00 * b11 - a02 * b08 + a03 * b07) * det,
        (a32 * b02 - a30 * b05 - a33 * b01) * det,
        (a20 * b05 - a22 * b02 + a23 * b01) * det,
        (a10 * b10 - a11 * b08 + a13 * b06) * det,
        (a01 * b08 - a00 * b10 - a03 * b06) * det,
        (a30 * b04 - a31 * b02 + a33 * b00) * det,
        (a21 * b02 - a20 * b04 - a23 * b00) * det,
        (a11 * b07 - a10 * b09 - a12 * b06) * det,
        (a00 * b09 - a01 * b07 + a02 * b06) * det,
        (a31 * b01 - a30 * b03 - a32 * b00) * det,
        (a20 * b03 - a21 * b01 + a22 * b00) * det,
    ];
}

// Rotation by `angle` (radians) around the world Z axis through `pivot`
function mat4RotateZAround(angle, [px, py, pz]) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, px - c * px + s * py, py - s * px - c * py, pz, 1];
}

function transformPoint(m, [x, y, z]) {
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    ];
}

function transformVector(m, [x, y, z]) {
    return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
}

function normalize([x, y, z]) {
    const length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length];
}

const round = (value, digits = 3) => Number(value.toFixed(digits));

// ---------------------------------------------------------------------------------------------
// Downloads and tools

async function download(url, file) {
    if (fs.existsSync(file)) return file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    console.log(`  downloaded ${path.basename(file)}`);
    return file;
}

function resolveTool(specifier) {
    try {
        return require.resolve(specifier);
    } catch {
        throw new Error(`Missing dev tool "${specifier}": see the usage notes at the top of this script`);
    }
}

async function loadTools() {
    const core = require(resolveTool('@gltf-transform/core'));
    const extensions = require(resolveTool('@gltf-transform/extensions'));
    const functions = require(resolveTool('@gltf-transform/functions'));
    const { MeshoptDecoder, MeshoptEncoder } = require(resolveTool('meshoptimizer'));
    await MeshoptDecoder.ready;
    await MeshoptEncoder.ready;
    const io = new core.NodeIO().registerExtensions(extensions.ALL_EXTENSIONS).registerDependencies({
        'meshopt.decoder': MeshoptDecoder,
        'meshopt.encoder': MeshoptEncoder,
    });
    return { functions, MeshoptEncoder, io, sharp: require(resolveTool('sharp')) };
}

// The three.js loaders expect a browser: these stubs are enough to parse binary data in Node
async function loadThree() {
    globalThis.self = globalThis.self || globalThis;
    globalThis.window = globalThis.window || globalThis;
    globalThis.document = globalThis.document || {
        createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {} }),
    };
    // Import the same ES module instance the loaders use ("three" -> build/three.module.js)
    const loaders = path.dirname(resolveTool('three/examples/jsm/loaders/FBXLoader.js'));
    const load = (file) => import(pathToFileURL(path.resolve(loaders, file)).href);
    const THREE = await load('../../../build/three.module.js');
    THREE.ImageLoader.prototype.load = () => ({});
    const { FBXLoader } = await load('FBXLoader.js');
    const { TGALoader } = await load('TGALoader.js');
    return { FBXLoader, TGALoader };
}

function toArrayBuffer(buffer) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

// ---------------------------------------------------------------------------------------------
// Rocketbox: FBX -> GLB, morph target names, posed rest pose, head weights, bust crop, textures

function convertFbx(fbxFile) {
    const glbBase = fbxFile.replace(/\.fbx$/, '');
    if (!fs.existsSync(`${glbBase}.glb`)) {
        const fbx2gltf = path.join(path.dirname(resolveTool('fbx2gltf')), 'bin', os.type(), 'FBX2glTF');
        execFileSync(fbx2gltf, ['--binary', '--blend-shape-normals', '-i', fbxFile, '-o', glbBase], {
            stdio: 'ignore',
        });
    }
    return `${glbBase}.glb`;
}

/**
 * FBX2glTF drops the morph target names: read them (in order) with the three.js FBXLoader, with
 * the number of moved vertices per target to check that both tools use the same order.
 */
function readFbxTargets(three, fbxFile) {
    let mesh = null;
    new three.FBXLoader().parse(toArrayBuffer(fs.readFileSync(fbxFile)), '').traverse((object) => {
        if (object.isMesh && object.morphTargetDictionary && !mesh) mesh = object;
    });
    if (!mesh) throw new Error(`${fbxFile}: no morph targets`);
    const dictionary = mesh.morphTargetDictionary;
    const names = Object.keys(dictionary).sort((a, b) => dictionary[a] - dictionary[b]);
    const moved = mesh.geometry.morphAttributes.position.map((attribute) => {
        let count = 0;
        for (let i = 0; i < attribute.count; i++) {
            if (Math.abs(attribute.getX(i)) + Math.abs(attribute.getY(i)) + Math.abs(attribute.getZ(i)) > 1e-4) {
                count++;
            }
        }
        return count;
    });
    return { names: names.map((name) => name.replace(/^.*\./, '')), moved };
}

function correlation(a, b) {
    const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const ma = mean(a);
    const mb = mean(b);
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < a.length; i++) {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma) ** 2;
        db += (b[i] - mb) ** 2;
    }
    return num / Math.sqrt(da * db);
}

function countMovedVertices(primitives, targetIndex) {
    const delta = [0, 0, 0];
    return primitives.reduce((total, primitive) => {
        const attribute = primitive.listTargets()[targetIndex].getAttribute('POSITION');
        for (let i = 0; i < attribute.getCount(); i++) {
            attribute.getElement(i, delta);
            if (Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2]) > 1e-6) total++;
        }
        return total;
    }, 0);
}

function findNode(document, name) {
    const node = document
        .getRoot()
        .listNodes()
        .find((n) => n.getName() === name);
    if (!node) throw new Error(`Node "${name}" not found`);
    return node;
}

function worldPosition(node) {
    return transformPoint(node.getWorldMatrix(), [0, 0, 0]);
}

// Lower the T/A-pose arms: rotate each upper arm around the world Z axis at its shoulder joint
function lowerArms(document) {
    for (const side of ['L', 'R']) {
        const upperArm = findNode(document, `Bip01 ${side} UpperArm`);
        const shoulder = worldPosition(upperArm);
        const elbow = worldPosition(findNode(document, `Bip01 ${side} Forearm`));
        const current = Math.atan2(elbow[1] - shoulder[1], Math.abs(elbow[0] - shoulder[0]));
        // Mirrored for the arm pointing towards -X
        const direction = Math.sign(elbow[0] - shoulder[0]);
        const rotation = mat4RotateZAround((-(ARM_ANGLE * Math.PI) / 180 - current) * direction, shoulder);
        const parentWorld = upperArm.getParentNode().getWorldMatrix();
        upperArm.setMatrix(mat4Multiply(mat4Invert(parentWorld), mat4Multiply(rotation, upperArm.getWorldMatrix())));
    }
}

function subtree(node, out = new Set()) {
    out.add(node);
    node.listChildren().forEach((child) => subtree(child, out));
    return out;
}

/**
 * Bake the (posed) skinned rest pose into static vertices and return, per primitive, how much each
 * vertex follows the head (head bones 1, neck 0.5). glTF skinning ignores the mesh node transform:
 * world = sum(weight * jointWorld * inverseBind) * vertex.
 */
function bakeSkin(node, headJoints, neckJoint) {
    const skin = node.getSkin();
    const joints = skin.listJoints();
    const inverseBind = skin.getInverseBindMatrices();
    const jointMatrices = joints.map((joint, index) =>
        mat4Multiply(joint.getWorldMatrix(), inverseBind.getElement(index, new Array(16)))
    );
    const jointHead = joints.map((joint) => (headJoints.has(joint) ? 1 : joint === neckJoint ? 0.5 : 0));
    const headWeights = new Map();
    for (const primitive of node.getMesh().listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        const normal = primitive.getAttribute('NORMAL');
        const jointsAttribute = primitive.getAttribute('JOINTS_0');
        const weightsAttribute = primitive.getAttribute('WEIGHTS_0');
        const targets = primitive.listTargets();
        const weights = new Float32Array(position.getCount());
        const j = [0, 0, 0, 0];
        const w = [0, 0, 0, 0];
        const v = [0, 0, 0];
        for (let i = 0; i < position.getCount(); i++) {
            jointsAttribute.getElement(i, j);
            weightsAttribute.getElement(i, w);
            const m = new Array(16).fill(0);
            for (let k = 0; k < 4; k++) {
                if (!w[k]) continue;
                weights[i] += w[k] * jointHead[j[k]];
                const jm = jointMatrices[j[k]];
                for (let e = 0; e < 16; e++) m[e] += w[k] * jm[e];
            }
            position.setElement(i, transformPoint(m, position.getElement(i, v)));
            if (normal) normal.setElement(i, normalize(transformVector(m, normal.getElement(i, v))));
            for (const target of targets) {
                for (const semantic of ['POSITION', 'NORMAL']) {
                    const attribute = target.getAttribute(semantic);
                    if (attribute) attribute.setElement(i, transformVector(m, attribute.getElement(i, v)));
                }
            }
        }
        for (const semantic of ['JOINTS_0', 'WEIGHTS_0', 'TANGENT']) primitive.setAttribute(semantic, null);
        for (const target of targets) target.setAttribute('TANGENT', null);
        headWeights.set(primitive, weights);
    }
    node.setSkin(null);
    node.setMatrix(IDENTITY);
    return headWeights;
}

// Skin attributes for the 2 joint rig: joint 0 = body, joint 1 = head
function setHeadSkinAttributes(document, primitive, headWeights) {
    const buffer = document.getRoot().listBuffers()[0];
    const count = headWeights.length;
    const joints = new Uint8Array(count * 4);
    const weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        const head = Math.min(1, Math.max(0, headWeights[i]));
        joints[i * 4 + 1] = 1;
        weights[i * 4] = 1 - head;
        weights[i * 4 + 1] = head;
    }
    primitive.setAttribute('JOINTS_0', document.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer));
    primitive.setAttribute('WEIGHTS_0', document.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
}

// Keep the triangles whose vertices all pass `keep(position)`
function cropPrimitive(primitive, keep) {
    const position = primitive.getAttribute('POSITION');
    const indices = primitive.getIndices();
    const v = [0, 0, 0];
    const inside = new Uint8Array(position.getCount());
    for (let i = 0; i < inside.length; i++) inside[i] = keep(position.getElement(i, v)) ? 1 : 0;
    const kept = [];
    for (let i = 0; i < indices.getCount(); i += 3) {
        const a = indices.getScalar(i);
        const b = indices.getScalar(i + 1);
        const c = indices.getScalar(i + 2);
        if (inside[a] && inside[b] && inside[c]) kept.push(a, b, c);
    }
    indices.setArray(new Uint32Array(kept));
}

function decodeTga(three, sharp, file, size) {
    // TGALoader returns top-down rows, as glTF images expect
    const texture = new three.TGALoader().parse(toArrayBuffer(fs.readFileSync(file)));
    return sharp(Buffer.from(texture.data.buffer), {
        raw: { width: texture.width, height: texture.height, channels: 4 },
    }).resize(size, size);
}

async function setRocketboxTextures(document, three, sharp, avatar, dir) {
    const webpTexture = async (name, image) =>
        document
            .createTexture(name)
            .setMimeType('image/webp')
            .setImage(await image.toBuffer());
    for (const material of document.getRoot().listMaterials()) {
        const name = material.getName();
        const kind = /opacity/.test(name) ? 'opacity' : /head/.test(name) ? 'head' : 'body';
        // <material>_color.tga (+ _normal.tga) next to the FBX in the Rocketbox repository
        const textureUrl = (suffix) => `${ROCKETBOX}/${avatar.name}/Textures/${name}_${suffix}.tga`;
        const color = await download(textureUrl('color'), path.join(dir, `${name}_color.tga`));
        let colorImage = decodeTga(three, sharp, color, TEXTURE_SIZE[kind]);
        // Some hair cards do not match the hair painted on the scalp texture: recolour them
        if (kind === 'opacity' && avatar.hair) colorImage = colorImage.modulate(avatar.hair);
        material
            .setBaseColorTexture(await webpTexture(`${name}_color`, colorImage.webp({ quality: 88, alphaQuality: 90 })))
            .setBaseColorFactor([1, 1, 1, 1])
            .setEmissiveTexture(null)
            .setEmissiveFactor([0, 0, 0])
            .setMetallicRoughnessTexture(null)
            .setMetallicFactor(0)
            .setRoughnessFactor(kind === 'head' ? 0.55 : 0.8)
            .setOcclusionTexture(null);
        if (kind === 'opacity') {
            // Hair, eyelashes and eyebrows: alpha tested, so they need no sorting
            material.setAlphaMode('MASK').setAlphaCutoff(0.35).setDoubleSided(true).setNormalTexture(null);
            continue;
        }
        material.setAlphaMode('OPAQUE').setDoubleSided(false);
        const normal = await download(textureUrl('normal'), path.join(dir, `${name}_normal.tga`));
        const normalImage = decodeTga(three, sharp, normal, TEXTURE_SIZE[kind]).removeAlpha();
        material.setNormalTexture(await webpTexture(`${name}_normal`, normalImage.webp({ quality: 90 })));
    }
}

async function buildRocketbox(tools, three, avatar) {
    const dir = path.join(CACHE_DIR, avatar.name);
    const fbxFile = await download(
        `${ROCKETBOX}/${avatar.name}/Export/${avatar.name}_facial.fbx`,
        path.join(dir, `${avatar.name}.fbx`)
    );
    const document = await tools.io.read(convertFbx(fbxFile));
    const root = document.getRoot();
    const scene = root.listScenes()[0];
    const node = root.listNodes().find((n) => n.getSkin() && n.getMesh());
    const mesh = node.getMesh();
    const primitives = mesh.listPrimitives();

    const fbx = readFbxTargets(three, fbxFile);
    if (fbx.names.length !== primitives[0].listTargets().length) throw new Error(`${avatar.name}: target count`);
    const score = correlation(
        fbx.moved,
        fbx.names.map((_, index) => countMovedVertices(primitives, index))
    );
    if (score < 0.95) throw new Error(`${avatar.name}: morph target order mismatch (${score.toFixed(3)})`);
    const keepTargets = ARKIT.map((name, index) => {
        const source = `AK_${String(index + 1).padStart(2, '0')}_${name}`.toLowerCase();
        const found = fbx.names.findIndex((n) => n.toLowerCase() === source);
        if (found < 0) throw new Error(`${avatar.name}: blendshape ${source} not found`);
        return found;
    });

    lowerArms(document);
    const neck = findNode(document, 'Bip01 Neck');
    const head = findNode(document, 'Bip01 Head');
    const neckPosition = worldPosition(neck);
    const headPosition = worldPosition(head);
    // One pivot between the neck and the skull base: the head turns there, the shoulders stay
    const pivot = neckPosition.map((value, i) => (value + headPosition[i]) / 2);
    const cutY = neckPosition[1] - BUST_DEPTH;
    const headWeights = bakeSkin(node, subtree(head), neck);

    root.listAnimations().forEach((animation) => animation.dispose());
    root.listSkins().forEach((skin) => skin.dispose());
    scene.listChildren().forEach((child) => scene.removeChild(child));
    scene.addChild(node);

    for (const primitive of primitives) {
        const targets = primitive.listTargets();
        targets.forEach((target) => primitive.removeTarget(target));
        // gltf-transform writes mesh.extras.targetNames from the target names
        keepTargets.forEach((index, k) => primitive.addTarget(targets[index].setName(ARKIT[k])));
        setHeadSkinAttributes(document, primitive, headWeights.get(primitive));
        cropPrimitive(primitive, ([, y]) => y > cutY - BUST_MARGIN);
        tools.functions.compactPrimitive(primitive);
    }
    mesh.setWeights(new Array(ARKIT.length).fill(0));
    await setRocketboxTextures(document, three, tools.sharp, avatar, dir);
    await document.transform(tools.functions.prune());
    return { document, pivot, cutY };
}

async function buildFromUrl(tools, avatar) {
    const file = await download(avatar.url, path.join(CACHE_DIR, avatar.id, path.basename(avatar.url)));
    const document = await tools.io.read(file);
    for (const texture of document.getRoot().listTextures()) {
        if (texture.getMimeType() !== 'image/png') continue;
        texture.setImage(await tools.sharp(texture.getImage()).webp({ quality: 90 }).toBuffer());
        texture.setMimeType('image/webp');
    }
    return { document, pivot: null, cutY: null };
}

// ---------------------------------------------------------------------------------------------
// Normalization to the engine convention

function morphCentroid(document, targetName) {
    const sum = [0, 0, 0];
    let total = 0;
    const v = [0, 0, 0];
    const d = [0, 0, 0];
    for (const node of document.getRoot().listNodes()) {
        const mesh = node.getMesh();
        if (!mesh) continue;
        const world = node.getWorldMatrix();
        for (const primitive of mesh.listPrimitives()) {
            const target = primitive.listTargets().find((t) => t.getName() === targetName);
            const delta = target?.getAttribute('POSITION');
            if (!delta) continue;
            const position = primitive.getAttribute('POSITION');
            for (let i = 0; i < position.getCount(); i++) {
                const weight = Math.hypot(...transformVector(world, delta.getElement(i, d)));
                if (weight < 1e-6) continue;
                const p = transformPoint(world, position.getElement(i, v));
                sum[0] += p[0] * weight;
                sum[1] += p[1] * weight;
                sum[2] += p[2] * weight;
                total += weight;
            }
        }
    }
    if (!total) throw new Error(`No vertices move with ${targetName}`);
    return sum.map((value) => value / total);
}

/**
 * Apply `matrix` to the vertices of a mesh. Unlike gltf-transform's transformMesh, morph target
 * deltas only get the linear part (a translation would move the whole mesh with every blendshape).
 */
function transformMeshVertices(mesh, matrix) {
    const linear = [...matrix.slice(0, 12), 0, 0, 0, 1];
    const inverseTranspose = mat4Invert(linear);
    const normalMatrix = [
        inverseTranspose[0], inverseTranspose[4], inverseTranspose[8], 0,
        inverseTranspose[1], inverseTranspose[5], inverseTranspose[9], 0,
        inverseTranspose[2], inverseTranspose[6], inverseTranspose[10], 0,
        0, 0, 0, 1,
    ]; // prettier-ignore
    // Normal deltas rotate with the mesh but must not shrink with its (uniform) scale
    const [a, b, c, , d, e, f, , g, h, k] = linear;
    const scale = Math.cbrt(Math.abs(a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g)));
    const v = [0, 0, 0];
    const apply = (attribute, fn) => {
        if (!attribute) return;
        for (let i = 0; i < attribute.getCount(); i++) attribute.setElement(i, fn(attribute.getElement(i, v)));
    };
    for (const primitive of mesh.listPrimitives()) {
        apply(primitive.getAttribute('POSITION'), (p) => transformPoint(matrix, p));
        apply(primitive.getAttribute('NORMAL'), (n) => normalize(transformVector(normalMatrix, n)));
        primitive.setAttribute('TANGENT', null);
        for (const target of primitive.listTargets()) {
            apply(target.getAttribute('POSITION'), (d) => transformVector(linear, d));
            apply(target.getAttribute('NORMAL'), (n) => transformVector(normalMatrix, n).map((x) => x * scale));
            target.setAttribute('TANGENT', null);
        }
    }
}

/**
 * Bake into the vertices the transform that moves the point between the eyes to the origin,
 * scales the outer eye distance to 1 and turns the face towards +Z with the subject's left eye on
 * +X. Mesh nodes end up at the scene root with an identity transform.
 */
function normalizeAvatar(document) {
    const scene = document.getRoot().listScenes()[0];
    const left = morphCentroid(document, 'eyeBlinkLeft');
    const right = morphCentroid(document, 'eyeBlinkRight');
    const center = left.map((value, i) => (value + right[i]) / 2);
    const scale = EYE_CENTER_DISTANCE / Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
    // A face looking at the viewer has its left eye on the viewer's right (+X): else turn it 180°
    const flip = left[0] > right[0] ? 1 : -1;
    const sx = scale * flip;
    const matrix = [sx, 0, 0, 0, 0, scale, 0, 0, 0, 0, sx, 0, -center[0] * sx, -center[1] * scale, -center[2] * sx, 1];
    const meshNodes = document
        .getRoot()
        .listNodes()
        .filter((node) => node.getMesh());
    const worlds = meshNodes.map((node) => node.getWorldMatrix());
    meshNodes.forEach((node, index) => {
        transformMeshVertices(node.getMesh(), mat4Multiply(matrix, worlds[index]));
        node.setMatrix(IDENTITY);
    });
    scene.listChildren().forEach((child) => scene.removeChild(child));
    meshNodes.forEach((node) => {
        node.getParentNode()?.removeChild(node);
        scene.addChild(node);
    });
    return { toModel: (point) => transformPoint(matrix, point), scale };
}

// Busts: "avatarBody" -> "avatarHead" skeleton bound to the head weights set while baking
function addHeadSkin(document, pivot) {
    const root = document.getRoot();
    const scene = root.listScenes()[0];
    const buffer = root.listBuffers()[0];
    const body = document.createNode('avatarBody');
    const head = document.createNode('avatarHead').setTranslation(pivot);
    body.addChild(head);
    scene.addChild(body);
    const inverseBind = [...IDENTITY, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -pivot[0], -pivot[1], -pivot[2], 1];
    const skin = document
        .createSkin('avatar')
        .addJoint(body)
        .addJoint(head)
        .setSkeleton(body)
        .setInverseBindMatrices(
            document.createAccessor().setType('MAT4').setArray(new Float32Array(inverseBind)).setBuffer(buffer)
        );
    root.listNodes()
        .filter((node) => node.getMesh())
        .forEach((node) => node.setSkin(skin));
}

async function finalize(tools, document, file) {
    const { functions, MeshoptEncoder } = tools;
    await document.transform(
        functions.dedup(),
        functions.prune(),
        functions.reorder({ encoder: MeshoptEncoder }),
        functions.quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
        functions.meshopt({ encoder: MeshoptEncoder, level: 'medium' })
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await tools.io.write(file, document);
    return fs.statSync(file).size;
}

function writeEffectsFile(entries) {
    const lines = entries.map((entry, index) => {
        const model = { asset: `assets/avatars-3d/${entry.id}/model.glb` };
        if (entry.scale && entry.scale !== 1) model.scale = entry.scale;
        if (entry.clipY !== null) model.clipY = entry.clipY;
        const modelText = Object.entries(model)
            .map(([key, value]) => `${key}: ${typeof value === 'string' ? `'${value}'` : value}`)
            .join(', ');
        return [
            '    VFX.registerAvatar3D({',
            `        id: 'avatar3d-${entry.id}',`,
            `        label: '${entry.label}',`,
            `        order: ${410 + index * 10},`,
            `        thumbnail: 'assets/avatars-3d/${entry.id}/thumb.webp',`,
            `        model: { ${modelText} },`,
            '    });',
        ].join('\n');
    });
    const source = `'use strict';

/**
 * MiroTalk Video Effects - realistic 3D avatars ("3D Avatars" tab).
 *
 * GENERATED by scripts/generate-video-effects-3d-avatars.js: edit the generator, not this file.
 *
 * Rigged GLB heads and busts rendered by the 3D model renderer: the face follows the user's head
 * and the 52 MediaPipe blendshapes (blinks, gaze, brows, smile, jaw...). Busts turn the head at the
 * neck and are cut by a straight plane at \`clipY\`. Licenses: assets/avatars-3d/LICENSE.md.
 */
(function (root) {
    const VFX = root.MiroTalkVFX;
    if (!VFX?.registerAvatar3D) return;

${lines.join('\n')}
})(typeof globalThis !== 'undefined' ? globalThis : self);
`;
    fs.writeFileSync(EFFECTS_FILE, source);
}

async function buildModels() {
    const tools = await loadTools();
    const three = await loadThree();
    const entries = [];
    for (const avatar of AVATARS) {
        console.log(`${avatar.id}:`);
        const built =
            avatar.source === 'rocketbox'
                ? await buildRocketbox(tools, three, avatar)
                : await buildFromUrl(tools, avatar);
        const { toModel } = normalizeAvatar(built.document);
        let clipY = null;
        if (built.pivot) {
            addHeadSkin(built.document, toModel(built.pivot));
            clipY = round(toModel([0, built.cutY, 0])[1]);
        }
        const file = path.join(OUTPUT_DIR, avatar.id, 'model.glb');
        const size = await finalize(tools, built.document, file);
        console.log(`  ${path.relative(process.cwd(), file)} ${(size / 1024).toFixed(0)} KB`);
        entries.push({ id: avatar.id, label: avatar.label, scale: avatar.scale, clipY });
    }
    writeEffectsFile(entries);
    console.log(`wrote ${path.relative(process.cwd(), EFFECTS_FILE)}`);
}

// ---------------------------------------------------------------------------------------------
// Thumbnails: rendered by Chrome with the same lighting as the engine (transparent WebP)

const THUMBS_PAGE = `<!doctype html><html><body><canvas width="${THUMB_SIZE * 2}" height="${THUMB_SIZE * 2}"></canvas>
<script type="module">
import * as THREE from '${THREE_CDN}/+esm';
import { GLTFLoader } from '${THREE_CDN}/examples/jsm/loaders/GLTFLoader.js/+esm';
import { MeshoptDecoder } from '${THREE_CDN}/examples/jsm/libs/meshopt_decoder.module.js/+esm';
import { RoomEnvironment } from '${THREE_CDN}/examples/jsm/environments/RoomEnvironment.js/+esm';
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.localClippingEnabled = true;
const environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
window.renderThumb = async (url, clipY) => {
    const gltf = await loader.loadAsync(url);
    const scene = new THREE.Scene();
    scene.environment = environment;
    scene.environmentIntensity = 0.8;
    const light = new THREE.DirectionalLight(0xffffff, 1.4);
    light.position.set(0.4, 0.8, 1);
    scene.add(light, gltf.scene);
    const plane = clipY === null ? null : new THREE.Plane(new THREE.Vector3(0, 1, 0), -clipY);
    gltf.scene.traverse((o) => { if (o.material && plane) o.material.clippingPlanes = [plane]; o.frustumCulled = false; });
    const box = new THREE.Box3().setFromObject(gltf.scene);
    if (plane) box.min.y = Math.max(box.min.y, clipY);
    // Heads are framed whole; busts on the head and the top of the shoulders (like a portrait)
    const size = plane ? 2.1 : Math.max(box.max.x - box.min.x, box.max.y - box.min.y) * 0.54;
    const cx = plane ? 0 : (box.min.x + box.max.x) / 2;
    const cy = plane ? box.max.y + 0.15 - size : (box.min.y + box.max.y) / 2;
    const camera = new THREE.OrthographicCamera(cx - size, cx + size, cy + size, cy - size, -100, 100);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
};
document.title = 'ready';
</script></body></html>`;

function serveThumbs() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const url = decodeURIComponent(req.url.split('?')[0]);
            if (url === '/__thumbs.html') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                return res.end(THUMBS_PAGE);
            }
            const file = path.join(PUBLIC_DIR, path.normalize(url));
            if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) {
                res.writeHead(404);
                return res.end();
            }
            res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
            fs.createReadStream(file).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

function readEntries() {
    // The generated effects file is the source of truth for ids and clip planes
    const source = fs.readFileSync(EFFECTS_FILE, 'utf8');
    return [
        ...source.matchAll(/assets\/avatars-3d\/([\w-]+)\/model\.glb'(?:, scale: [\d.]+)?(?:, clipY: (-?[\d.]+))?/g),
    ].map(([, id, clipY]) => ({ id, clipY: clipY === undefined ? null : Number(clipY) }));
}

async function buildThumbs() {
    const puppeteer = require(resolveTool('puppeteer-core'));
    const sharp = require(resolveTool('sharp'));
    const executablePath =
        process.env.CHROME_PATH ||
        {
            darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        }[process.platform] ||
        '/usr/bin/google-chrome';
    const server = await serveThumbs();
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await puppeteer.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage();
        page.on('pageerror', (error) => console.error('page error:', error.message));
        await page.goto(`${base}/__thumbs.html`);
        await page.waitForFunction('document.title === "ready"', { timeout: 60000 });
        for (const { id, clipY } of readEntries()) {
            const dataUrl = await page.evaluate(
                (url, clip) => window.renderThumb(url, clip),
                `${base}/video-effects/assets/avatars-3d/${id}/model.glb`,
                clipY
            );
            const file = path.join(OUTPUT_DIR, id, 'thumb.webp');
            await sharp(Buffer.from(dataUrl.split(',')[1], 'base64'))
                .resize(THUMB_SIZE, THUMB_SIZE)
                .webp({ quality: 86, alphaQuality: 90 })
                .toFile(file);
            console.log(`${path.relative(process.cwd(), file)} ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
        }
    } finally {
        await browser.close();
        server.close();
    }
}

if (require.main === module) {
    (process.argv.includes('--thumbs') ? buildThumbs() : buildModels()).catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

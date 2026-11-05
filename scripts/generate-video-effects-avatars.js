'use strict';

/**
 * Dev helper: generate the animated head avatars of the video effects engine.
 *
 * Writes public/video-effects/assets/avatars/<id>/*.svg (head, brows, eyes, mouths, thumbnail) and
 * public/video-effects/effects/avatars.js. The artwork is clean cartoon vector art (outlines, gradients,
 * soft shading, detailed eyes), original and reproducible: run again after editing to regenerate.
 *
 * Every avatar is drawn on a 600x640 canvas whose point (300, 300) is placed between the user's eyes.
 * The eyes are centred at (235, 300) and (365, 300); parts are positioned with boxes on that canvas.
 *
 * Usage: node scripts/generate-video-effects-avatars.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public/video-effects/assets/avatars');
const JS = path.join(ROOT, 'public/video-effects/effects/avatars.js');

const W = 600;
const H = 640;
const EYES = [300, 300];
const EYE_RIGHT = [235, 300]; // image left = subject's right
const EYE_LEFT = [365, 300];
const CANVAS_WIDTH_IN_EYE_DISTANCES = 3.15;

// ####################################################
// HELPERS
// ####################################################

function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const fmt = (n) => {
    const v = Math.round(n * 10) / 10;
    return Object.is(v, -0) ? '0' : String(v);
};

function catmull(points) {
    const n = points.length;
    let d = `M${fmt(points[0][0])} ${fmt(points[0][1])}`;
    for (let i = 0; i < n; i++) {
        const p0 = points[(i - 1 + n) % n];
        const p1 = points[i];
        const p2 = points[(i + 1) % n];
        const p3 = points[(i + 2) % n];
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += `C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p2[0])} ${fmt(p2[1])}`;
    }
    return `${d}Z`;
}

function ellipse(cx, cy, rx, ry, n = 28, rotation = 0) {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        const x = Math.cos(a) * rx;
        const y = Math.sin(a) * ry;
        return [cx + x * cos - y * sin, cy + x * sin + y * cos];
    });
}

const mirror = (points) => points.map(([x, y]) => [W - x, y]);

function svg(width, height, body) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${body}\n</svg>\n`;
}

// Soft shading on a shape: darker rim (ambient occlusion) and a light from the top left
function shading(id, d, { rim = 0.35, light = 0.22, rimColor = '#000000' } = {}) {
    return `    <defs>
        <radialGradient id="${id}-rim" cx="0.5" cy="0.45" r="0.62">
            <stop offset="0.62" stop-color="${rimColor}" stop-opacity="0" />
            <stop offset="1" stop-color="${rimColor}" stop-opacity="${rim}" />
        </radialGradient>
        <radialGradient id="${id}-light" cx="0.36" cy="0.26" r="0.55">
            <stop offset="0" stop-color="#ffffff" stop-opacity="${light}" />
            <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
        </radialGradient>
    </defs>
    <path d="${d}" fill="url(#${id}-rim)" />
    <path d="${d}" fill="url(#${id}-light)" />`;
}

function softFilter(id, deviation) {
    return `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${deviation}" /></filter>`;
}

// ####################################################
// SHARED PARTS: EYES, BROWS, MOUTHS
// ####################################################

const EYE_BOX = 110;

/**
 * Detailed eye: iris with radial fibres and limbal ring, pupil, upper-lid shadow, outline and
 * highlights, clipped to the eye shape.
 */
function eye({
    id,
    shape,
    center,
    irisRadius,
    iris,
    pupil = 'round',
    pupilSize = 0.45,
    sclera = null,
    outline,
    crease = null,
}) {
    const [cx, cy] = center;
    const random = rng(id.length * 97 + irisRadius * 13);
    const fibres = [];
    for (let i = 0; i < 44; i++) {
        const a = (i / 44) * Math.PI * 2 + random() * 0.08;
        const r0 = irisRadius * (0.38 + random() * 0.1);
        const r1 = irisRadius * (0.82 + random() * 0.14);
        fibres.push(
            `M${fmt(cx + Math.cos(a) * r0)} ${fmt(cy + Math.sin(a) * r0)}L${fmt(cx + Math.cos(a) * r1)} ${fmt(cy + Math.sin(a) * r1)}`
        );
    }
    const pupilShape =
        pupil === 'slit'
            ? `<ellipse cx="${cx}" cy="${cy}" rx="${fmt(irisRadius * 0.16)}" ry="${fmt(irisRadius * 0.82)}" fill="#0a0806" />`
            : `<circle cx="${cx}" cy="${cy}" r="${fmt(irisRadius * pupilSize)}" fill="#0a0806" />`;
    return `    <defs>
        <clipPath id="${id}-clip"><path d="${shape}" /></clipPath>
        <radialGradient id="${id}-iris" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stop-color="${iris[0]}" />
            <stop offset="0.55" stop-color="${iris[1]}" />
            <stop offset="1" stop-color="${iris[2]}" />
        </radialGradient>
        <linearGradient id="${id}-lid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#000000" stop-opacity="0.5" />
            <stop offset="0.42" stop-color="#000000" stop-opacity="0" />
        </linearGradient>
    </defs>
    <g clip-path="url(#${id}-clip)">
        ${sclera ? `<path d="${shape}" fill="${sclera}" />` : ''}
        <circle cx="${cx}" cy="${cy}" r="${irisRadius}" fill="url(#${id}-iris)" />
        <path d="${fibres.join('')}" stroke="${iris[2]}" stroke-width="1.3" stroke-opacity="0.35" fill="none" />
        <circle cx="${cx}" cy="${cy}" r="${fmt(irisRadius * 0.62)}" fill="none" stroke="${iris[0]}" stroke-width="2" stroke-opacity="0.35" />
        <circle cx="${cx}" cy="${cy}" r="${fmt(irisRadius - 1.5)}" fill="none" stroke="${iris[2]}" stroke-width="3" stroke-opacity="0.8" />
        ${pupilShape}
        <path d="${shape}" fill="url(#${id}-lid)" />
    </g>
    <path d="${shape}" fill="none" stroke="${outline}" stroke-width="4" stroke-linejoin="round" />
    ${crease ? `<path d="${crease}" fill="none" stroke="${outline}" stroke-width="2.5" stroke-opacity="0.45" stroke-linecap="round" />` : ''}
    <ellipse cx="${fmt(cx - irisRadius * 0.38)}" cy="${fmt(cy - irisRadius * 0.4)}" rx="${fmt(irisRadius * 0.24)}" ry="${fmt(irisRadius * 0.18)}" fill="#ffffff" fill-opacity="0.92" />
    <circle cx="${fmt(cx + irisRadius * 0.32)}" cy="${fmt(cy + irisRadius * 0.36)}" r="${fmt(irisRadius * 0.09)}" fill="#ffffff" fill-opacity="0.75" />`;
}

function closedEye({ lid, color, width = 5, lashes = true, crease = null }) {
    const lashLines = lashes
        ? `<path d="M30 70 L24 80 M55 75 L55 86 M80 70 L86 80" stroke="${color}" stroke-width="${fmt(width * 0.6)}" stroke-linecap="round" />`
        : '';
    return `    <path d="${lid}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" />
    ${lashLines}
    ${crease ? `<path d="${crease}" fill="none" stroke="${color}" stroke-width="2.5" stroke-opacity="0.45" stroke-linecap="round" />` : ''}`;
}

// Cartoon brow (100x40): tapered solid stroke, mirrored for the other eye
function cartoonBrow({ color, opacity = 0.9 }) {
    return `    <path d="M8 31 Q48 2 92 22 Q50 14 8 31 Z" fill="${color}" fill-opacity="${opacity}" />`;
}

// Animal mouths (100x90 box, nose bottom at the top centre): neutral, smile and open
function animalMouths(id, { color, inside = ['#6a1c28', '#2a070d'], tongue = ['#f59aae', '#d5607a'], fangs = false }) {
    const lines = `fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round"`;
    const stroke = `${lines} stroke-width="4.5"`;
    const neutral = `    <path d="M50 2 L50 18 M50 18 Q39 33 22 27 M50 18 Q61 33 78 27" ${stroke} />`;
    const smile = `    <path d="M50 2 L50 15 M50 15 Q35 38 12 20 M50 15 Q65 38 88 20" ${stroke} />
    <path d="M12 20 Q8 16 9 11 M88 20 Q92 16 91 11" ${lines} stroke-width="3.5" />`;
    const fangPaths = fangs
        ? `<path d="M29 15 L33 30 L37 15 Z M63 15 L67 30 L71 15 Z" fill="#fffdf6" stroke="${color}" stroke-width="1" />`
        : '';
    const open = `    <defs>
        <radialGradient id="${id}-inside" cx="0.5" cy="0.35" r="0.7">
            <stop offset="0" stop-color="${inside[0]}" />
            <stop offset="1" stop-color="${inside[1]}" />
        </radialGradient>
        <linearGradient id="${id}-tongue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${tongue[0]}" />
            <stop offset="1" stop-color="${tongue[1]}" />
        </linearGradient>
    </defs>
    <path d="M50 1 L50 11" ${stroke} />
    <path d="M17 13 Q50 4 83 13 Q88 56 50 84 Q12 56 17 13 Z" fill="url(#${id}-inside)" stroke="${color}" stroke-width="4" stroke-linejoin="round" />
    <path d="M28 60 Q50 46 72 60 Q68 80 50 83 Q32 80 28 60 Z" fill="url(#${id}-tongue)" />
    <path d="M50 52 L50 74" stroke="${tongue[1]}" stroke-width="2" stroke-opacity="0.7" stroke-linecap="round" />
    ${fangPaths}`;
    return { neutral, smile, open };
}

// ####################################################
// CHARACTERS
// ####################################################

const characters = [];
const builders = [];

// ---------------- Cat (orange tabby) ----------------
builders.push(() => {
    const id = 'cat';
    const head = [
        [300, 62], [392, 74], [466, 128], [508, 214], [522, 306], [540, 372], [508, 404], [526, 444], [478, 478],
        [462, 522], [406, 562], [352, 586], [300, 592], [248, 586], [194, 562], [138, 522], [122, 478], [74, 444],
        [92, 404], [60, 372], [78, 306], [92, 214], [134, 128], [208, 74],
    ]; // prettier-ignore
    const earOuter = [
        [92, 252],
        [100, 128],
        [132, 22],
        [204, 62],
        [272, 118],
    ];
    const earInner = [
        [128, 212],
        [136, 120],
        [152, 62],
        [204, 96],
        [240, 132],
    ];
    const muzzle = [ellipse(262, 446, 66, 48), ellipse(338, 446, 66, 48), ellipse(300, 494, 72, 54)];
    const d = catmull(head);
    const ears = [earOuter, mirror(earOuter)];
    const inners = [earInner, mirror(earInner)];
    const stripe = (x1, y1, x2, y2, w) => {
        const nx = -(y2 - y1);
        const ny = x2 - x1;
        const len = Math.hypot(nx, ny);
        const ox = (nx / len) * w;
        const oy = (ny / len) * w;
        return `M${fmt(x1)} ${fmt(y1)}Q${fmt((x1 + x2) / 2 + ox)} ${fmt((y1 + y2) / 2 + oy)} ${fmt(x2)} ${fmt(y2)}Q${fmt((x1 + x2) / 2 - ox)} ${fmt((y1 + y2) / 2 - oy)} ${fmt(x1)} ${fmt(y1)}Z`;
    };
    const stripes = [
        stripe(300, 96, 300, 178, 9),
        stripe(262, 102, 274, 172, 7),
        stripe(338, 102, 326, 172, 7),
        stripe(82, 318, 150, 330, 8),
        stripe(88, 368, 152, 366, 7),
        stripe(518, 318, 450, 330, 8),
        stripe(512, 368, 448, 366, 7),
        stripe(214, 128, 236, 186, 5),
        stripe(386, 128, 364, 186, 5),
    ].join('');
    const muzzleD = muzzle.map((m) => catmull(m)).join('');
    const whiskers = [];
    for (const [i, dy] of [-12, 2, 16].entries()) {
        whiskers.push(`M226 ${448 + dy / 2}Q168 ${436 + dy * 1.2} ${112 - i * 6} ${430 + dy * 2.2}`);
        whiskers.push(`M374 ${448 + dy / 2}Q432 ${436 + dy * 1.2} ${488 + i * 6} ${430 + dy * 2.2}`);
    }
    const headSvg = `    <defs>
        <radialGradient id="${id}-fur" cx="0.5" cy="0.42" r="0.62">
            <stop offset="0" stop-color="#ffb25a" />
            <stop offset="0.7" stop-color="#ef8b33" />
            <stop offset="1" stop-color="#c8661e" />
        </radialGradient>
        <linearGradient id="${id}-inner" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stop-color="#e9879a" />
            <stop offset="1" stop-color="#ffc7d0" />
        </linearGradient>
        <linearGradient id="${id}-muzzle" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fffaf3" />
            <stop offset="1" stop-color="#ecd9c2" />
        </linearGradient>
        <linearGradient id="${id}-nose" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#f7a3b4" />
            <stop offset="1" stop-color="#d4607b" />
        </linearGradient>
        ${softFilter(`${id}-soft`, 2.5)}
    </defs>
    ${ears.map((ear) => `<path d="${catmull(ear)}" fill="url(#${id}-fur)" stroke="#a9520f" stroke-width="3" />`).join('\n    ')}
    ${inners.map((ear) => `<path d="${catmull(ear)}" fill="url(#${id}-inner)" />`).join('\n    ')}
    <path d="${d}" fill="url(#${id}-fur)" />
${shading(`${id}-head`, d, { rim: 0.32, light: 0.25, rimColor: '#6b2e05' })}
    <path d="${d}" fill="none" stroke="#a9520f" stroke-width="5" />
    <path d="${stripes}" fill="#b4520f" fill-opacity="0.55" />
    <path d="${muzzleD}" fill="url(#${id}-muzzle)" />
    <g fill="#c89a7a" fill-opacity="0.7">
        <circle cx="252" cy="440" r="2.4" /><circle cx="240" cy="452" r="2.4" /><circle cx="256" cy="462" r="2.4" />
        <circle cx="348" cy="440" r="2.4" /><circle cx="360" cy="452" r="2.4" /><circle cx="344" cy="462" r="2.4" />
    </g>
    <ellipse cx="196" cy="428" rx="34" ry="18" fill="#ff8fa3" fill-opacity="0.22" filter="url(#${id}-soft)" />
    <ellipse cx="404" cy="428" rx="34" ry="18" fill="#ff8fa3" fill-opacity="0.22" filter="url(#${id}-soft)" />
    <path d="M276 392 Q300 383 324 392 Q322 408 306 420 Q300 425 294 420 Q278 408 276 392 Z" fill="url(#${id}-nose)" stroke="#b44a64" stroke-width="2" />
    <ellipse cx="292" cy="394" rx="9" ry="4" fill="#ffffff" fill-opacity="0.55" />
    <path d="M290 410 Q294 414 297 410 M303 410 Q306 414 310 410" fill="none" stroke="#a83d58" stroke-width="2" stroke-linecap="round" />
    <path d="${whiskers.join('')}" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-opacity="0.9" stroke-linecap="round" />`;
    characters.push({
        id,
        label: 'Cat',
        order: 210,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: 'M8 58 C22 24 84 20 102 52 C88 88 26 92 8 58 Z',
                center: [55, 56],
                irisRadius: 40,
                iris: ['#e6f792', '#86c232', '#3c7410'],
                pupil: 'slit',
                outline: '#2a1608',
            }),
            closed: closedEye({ lid: 'M8 58 C30 76 80 74 102 52', color: '#5a2a0c', lashes: false }),
        },
        brow: { box: [185, 214, 100, 40], svg: cartoonBrow({ color: '#a9520f' }), lift: 14 },
        mouth: { box: [250, 421, 100, 90], ...animalMouths(`${id}-mouth`, { color: '#6b3a1e', fangs: true }) },
    });
});

// ---------------- Bear ----------------
builders.push(() => {
    const id = 'bear';
    const head = ellipse(300, 320, 232, 270, 32);
    const ears = [ellipse(138, 112, 72, 70), ellipse(462, 112, 72, 70)];
    const earInner = [ellipse(140, 118, 40, 38), ellipse(460, 118, 40, 38)];
    const muzzle = [ellipse(300, 452, 110, 86, 28)];
    const d = catmull(head);
    const headSvg = `    <defs>
        <radialGradient id="${id}-fur" cx="0.5" cy="0.4" r="0.62">
            <stop offset="0" stop-color="#a9733f" />
            <stop offset="0.7" stop-color="#83532a" />
            <stop offset="1" stop-color="#5f3b1a" />
        </radialGradient>
        <radialGradient id="${id}-muzzle" cx="0.5" cy="0.35" r="0.65">
            <stop offset="0" stop-color="#f0d4a8" />
            <stop offset="1" stop-color="#c79a66" />
        </radialGradient>
        <radialGradient id="${id}-nose" cx="0.4" cy="0.3" r="0.75">
            <stop offset="0" stop-color="#4a3628" />
            <stop offset="1" stop-color="#0d0805" />
        </radialGradient>
        ${softFilter(`${id}-soft`, 2.5)}
    </defs>
    ${ears.map((ear) => `<path d="${catmull(ear)}" fill="url(#${id}-fur)" stroke="#4a2c10" stroke-width="5" />`).join('\n    ')}
    ${earInner.map((ear) => `<path d="${catmull(ear)}" fill="#d9a777" />`).join('\n    ')}
    <path d="${d}" fill="url(#${id}-fur)" />
${shading(`${id}-head`, d, { rim: 0.38, light: 0.2, rimColor: '#2a1504' })}
    <path d="${d}" fill="none" stroke="#4a2c10" stroke-width="5" />
    <path d="${catmull(muzzle[0])}" fill="url(#${id}-muzzle)" stroke="#b88a58" stroke-width="3" />
    <ellipse cx="190" cy="420" rx="32" ry="18" fill="#ff8f8f" fill-opacity="0.2" filter="url(#${id}-soft)" />
    <ellipse cx="410" cy="420" rx="32" ry="18" fill="#ff8f8f" fill-opacity="0.2" filter="url(#${id}-soft)" />
    <path d="M262 396 C262 378 338 378 338 396 C338 418 318 432 300 434 C282 432 262 418 262 396 Z" fill="url(#${id}-nose)" />
    <ellipse cx="287" cy="390" rx="13" ry="6" fill="#ffffff" fill-opacity="0.5" />
    <path d="M282 412 Q288 418 294 413 M306 413 Q312 418 318 412" fill="none" stroke="#000000" stroke-width="3" stroke-opacity="0.6" stroke-linecap="round" />`;
    characters.push({
        id,
        label: 'Bear',
        order: 240,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: 'M30 55 a25 25 0 1 0 50 0 a25 25 0 1 0 -50 0 Z',
                center: [55, 55],
                irisRadius: 24,
                iris: ['#8a5a32', '#4a2a12', '#1a0c04'],
                pupilSize: 0.55,
                outline: '#1a0c04',
            }),
            closed: closedEye({ lid: 'M28 54 Q55 74 82 54', color: '#2a1608', lashes: false }),
        },
        brow: { box: [185, 220, 100, 40], svg: cartoonBrow({ color: '#3e220c' }), lift: 14 },
        mouth: { box: [250, 431, 100, 90], ...animalMouths(`${id}-mouth`, { color: '#2a1608' }) },
    });
});

// ---------------- Panda ----------------
builders.push(() => {
    const id = 'panda';
    const head = ellipse(300, 318, 230, 268, 32);
    const ears = [ellipse(140, 110, 70, 68), ellipse(460, 110, 70, 68)];
    const patchRight = ellipse(232, 314, 64, 84, 24, 0.56);
    const patchLeft = mirror(patchRight);
    const muzzle = [ellipse(300, 452, 98, 74, 24)];
    const d = catmull(head);
    const headSvg = `    <defs>
        <radialGradient id="${id}-fur" cx="0.5" cy="0.42" r="0.62">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="0.75" stop-color="#f1efea" />
            <stop offset="1" stop-color="#cfcbc2" />
        </radialGradient>
        <radialGradient id="${id}-black" cx="0.45" cy="0.4" r="0.7">
            <stop offset="0" stop-color="#2c2c2c" />
            <stop offset="1" stop-color="#070707" />
        </radialGradient>
        <radialGradient id="${id}-nose" cx="0.4" cy="0.3" r="0.75">
            <stop offset="0" stop-color="#3c3c3c" />
            <stop offset="1" stop-color="#050505" />
        </radialGradient>
        ${softFilter(`${id}-soft`, 2.5)}
    </defs>
    ${ears.map((ear) => `<path d="${catmull(ear)}" fill="url(#${id}-black)" />`).join('\n    ')}
    <path d="${d}" fill="url(#${id}-fur)" />
${shading(`${id}-head`, d, { rim: 0.22, light: 0.15, rimColor: '#4a4436' })}
    <path d="${d}" fill="none" stroke="#a8a397" stroke-width="5" />
    <path d="${catmull(patchRight)}${catmull(patchLeft)}" fill="url(#${id}-black)" />
    <path d="${catmull(muzzle[0])}" fill="#f7f4ee" />
    <ellipse cx="190" cy="430" rx="30" ry="17" fill="#ff9fb0" fill-opacity="0.35" filter="url(#${id}-soft)" />
    <ellipse cx="410" cy="430" rx="30" ry="17" fill="#ff9fb0" fill-opacity="0.35" filter="url(#${id}-soft)" />
    <path d="M270 400 Q300 386 330 400 Q326 424 300 432 Q274 424 270 400 Z" fill="url(#${id}-nose)" />
    <ellipse cx="290" cy="398" rx="10" ry="5" fill="#ffffff" fill-opacity="0.5" />`;
    characters.push({
        id,
        label: 'Panda',
        order: 250,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: 'M33 56 a22 22 0 1 0 44 0 a22 22 0 1 0 -44 0 Z',
                center: [55, 56],
                irisRadius: 21,
                iris: ['#6a4630', '#3a2012', '#140904'],
                pupilSize: 0.55,
                outline: '#5a5a5a',
            }),
            closed: closedEye({ lid: 'M30 56 Q55 74 80 56', color: '#d6d6d6', lashes: true }),
        },
        brow: {
            box: [185, 208, 100, 40],
            svg: cartoonBrow({ color: '#7c7870', opacity: 0.6 }),
            lift: 12,
        },
        mouth: { box: [250, 429, 100, 90], ...animalMouths(`${id}-mouth`, { color: '#1c1c1c' }) },
    });
});

// ---------------- Fox ----------------
builders.push(() => {
    const id = 'fox';
    const head = [
        [300, 44], [424, 56], [500, 140], [516, 260], [534, 360], [556, 416], [500, 438], [440, 488], [372, 552],
        [300, 598], [228, 552], [160, 488], [100, 438], [44, 416], [66, 360], [84, 260], [100, 140], [176, 56],
    ]; // prettier-ignore
    const cheeks = [
        [70, 414], [150, 396], [226, 392], [300, 412], [374, 392], [450, 396], [530, 414], [470, 446], [410, 500],
        [350, 560], [300, 592], [250, 560], [190, 500], [130, 446],
    ]; // prettier-ignore
    const earOuter = [[100, 250], [62, 112], [92, 6], [196, 50], [262, 128]]; // prettier-ignore
    const earInner = [[118, 206], [90, 118], [104, 44], [178, 74], [220, 128]]; // prettier-ignore
    const earTip = [[74, 64], [92, 6], [134, 26], [120, 54], [92, 76]]; // prettier-ignore
    const d = catmull(head);
    const ears = [earOuter, mirror(earOuter)];
    const inners = [earInner, mirror(earInner)];
    const tips = [earTip, mirror(earTip)];
    const headSvg = `    <defs>
        <radialGradient id="${id}-fur" cx="0.5" cy="0.38" r="0.65">
            <stop offset="0" stop-color="#ff9e42" />
            <stop offset="0.7" stop-color="#ee7a22" />
            <stop offset="1" stop-color="#c55a10" />
        </radialGradient>
        <linearGradient id="${id}-white" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fffaf3" />
            <stop offset="1" stop-color="#ecdfd0" />
        </linearGradient>
        <radialGradient id="${id}-nose" cx="0.4" cy="0.3" r="0.75">
            <stop offset="0" stop-color="#3a2a22" />
            <stop offset="1" stop-color="#050302" />
        </radialGradient>
        ${softFilter(`${id}-blur`, 1.4)}
    </defs>
    ${ears.map((ear) => `<path d="${catmull(ear)}" fill="url(#${id}-fur)" stroke="#9a420a" stroke-width="3" />`).join('\n    ')}
    ${inners.map((ear) => `<path d="${catmull(ear)}" fill="#fff0e2" />`).join('\n    ')}
    ${tips.map((tip) => `<path d="${catmull(tip)}" fill="#1f140e" />`).join('\n    ')}
    <path d="${d}" fill="url(#${id}-fur)" />
${shading(`${id}-head`, d, { rim: 0.3, light: 0.25, rimColor: '#5a2004' })}
    <path d="${d}" fill="none" stroke="#9a420a" stroke-width="5" stroke-linejoin="round" />
    <path d="${catmull(cheeks)}" fill="url(#${id}-white)" />
    <path d="M278 476 Q300 466 322 476 Q318 497 300 503 Q282 497 278 476 Z" fill="url(#${id}-nose)" />
    <ellipse cx="292" cy="475" rx="8" ry="4" fill="#ffffff" fill-opacity="0.5" />
    <path d="M232 268 Q206 286 196 316 M368 268 Q394 286 404 316" fill="none" stroke="#3a1a08" stroke-width="5" stroke-opacity="0.4" stroke-linecap="round" filter="url(#${id}-blur)" />`;
    characters.push({
        id,
        label: 'Fox',
        order: 260,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: 'M6 64 C20 34 76 22 104 40 C96 74 40 92 6 64 Z',
                center: [56, 57],
                irisRadius: 36,
                iris: ['#ffe08a', '#f0a018', '#9c5000'],
                pupil: 'slit',
                outline: '#2a1206',
            }),
            closed: closedEye({ lid: 'M6 64 C34 82 82 66 104 40', color: '#3a1606', lashes: false }),
        },
        brow: { box: [185, 214, 100, 40], svg: cartoonBrow({ color: '#8f3806' }), lift: 14 },
        mouth: { box: [250, 501, 100, 80], ...animalMouths(`${id}-mouth`, { color: '#1a1210', fangs: true }) },
    });
});

// ---------------- Monkey (chimpanzee) ----------------
builders.push(() => {
    const id = 'monkey';
    const head = ellipse(300, 314, 214, 270, 32);
    const ears = [ellipse(84, 330, 66, 72), ellipse(516, 330, 66, 72)];
    const earInner = [ellipse(90, 332, 38, 44), ellipse(510, 332, 38, 44)];
    const faceD =
        'M300 238 C258 194 154 212 156 310 C158 360 188 382 194 402 C188 472 236 542 300 542 C364 542 412 472 406 402 C412 382 442 360 444 310 C446 212 342 194 300 238 Z';
    const headSvg = `    <defs>
        <radialGradient id="${id}-fur" cx="0.5" cy="0.38" r="0.62">
            <stop offset="0" stop-color="#6a4322" />
            <stop offset="1" stop-color="#3a2210" />
        </radialGradient>
        <radialGradient id="${id}-skin" cx="0.5" cy="0.42" r="0.6">
            <stop offset="0" stop-color="#f3d4b0" />
            <stop offset="0.75" stop-color="#deb08a" />
            <stop offset="1" stop-color="#b98560" />
        </radialGradient>
        <radialGradient id="${id}-ear" cx="0.5" cy="0.5" r="0.55">
            <stop offset="0" stop-color="#c28c66" />
            <stop offset="1" stop-color="#e5bf98" />
        </radialGradient>
        ${softFilter(`${id}-soft`, 3)}
        ${softFilter(`${id}-blur`, 1.2)}
    </defs>
    ${ears.map((ear) => `<path d="${catmull(ear)}" fill="#e2b892" stroke="#9a6a46" stroke-width="3" />`).join('\n    ')}
    ${earInner.map((ear) => `<path d="${catmull(ear)}" fill="url(#${id}-ear)" />`).join('\n    ')}
    <path d="${catmull(head)}" fill="url(#${id}-fur)" />
${shading(`${id}-head`, catmull(head), { rim: 0.35, light: 0.18, rimColor: '#120802' })}
    <path d="${catmull(head)}" fill="none" stroke="#2e1a0b" stroke-width="5" />
    <path d="${faceD}" fill="url(#${id}-skin)" />
    <path d="${faceD}" fill="none" stroke="#3a2210" stroke-width="6" stroke-opacity="0.35" filter="url(#${id}-blur)" />
    <path d="M176 262 Q236 236 290 262 M310 262 Q364 236 424 262" fill="none" stroke="#8a5a36" stroke-width="10" stroke-opacity="0.35" stroke-linecap="round" filter="url(#${id}-soft)" />
    <path d="M196 340 Q234 356 270 342 M330 342 Q366 356 404 340" fill="none" stroke="#a87650" stroke-width="2.5" stroke-opacity="0.5" stroke-linecap="round" />
    <path d="M300 320 Q290 370 288 404 M300 320 Q310 370 312 404" fill="none" stroke="#b07c56" stroke-width="5" stroke-opacity="0.35" stroke-linecap="round" filter="url(#${id}-blur)" />
    <ellipse cx="287" cy="418" rx="8" ry="10" fill="#5a3418" />
    <ellipse cx="313" cy="418" rx="8" ry="10" fill="#5a3418" />
    <ellipse cx="300" cy="404" rx="30" ry="14" fill="#ffffff" fill-opacity="0.12" filter="url(#${id}-soft)" />
    <ellipse cx="222" cy="404" rx="32" ry="20" fill="#e88f7a" fill-opacity="0.25" filter="url(#${id}-soft)" />
    <ellipse cx="378" cy="404" rx="32" ry="20" fill="#e88f7a" fill-opacity="0.25" filter="url(#${id}-soft)" />
    <path d="M282 60 Q296 14 318 58 Q332 26 346 64" fill="none" stroke="#3a2210" stroke-width="12" stroke-linecap="round" />`;
    const stroke = 'fill="none" stroke="#6a3e22" stroke-linecap="round"';
    characters.push({
        id,
        label: 'Monkey',
        order: 270,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: 'M10 58 C26 34 84 32 100 56 C84 80 26 82 10 58 Z',
                center: [55, 57],
                irisRadius: 21,
                iris: ['#b77a44', '#6a3c18', '#2a1406'],
                sclera: '#f4e8d2',
                outline: '#3a2210',
                crease: 'M14 44 C34 26 78 26 96 42',
            }),
            closed: closedEye({
                lid: 'M10 58 C30 74 80 74 100 56',
                color: '#4a2a14',
                lashes: true,
                crease: 'M14 44 C34 26 78 26 96 42',
            }),
        },
        brow: {
            box: [185, 218, 100, 40],
            svg: cartoonBrow({ color: '#7a4e2c', opacity: 0.6 }),
            lift: 12,
        },
        mouth: {
            box: [240, 446, 120, 80],
            neutral: `    <path d="M16 28 Q60 40 104 28" ${stroke} stroke-width="5" />`,
            smile: `    <path d="M10 18 Q60 62 110 18" ${stroke} stroke-width="6" />
    <path d="M10 18 Q6 14 8 9 M110 18 Q114 14 112 9" ${stroke} stroke-width="4" />`,
            open: `    <defs>
        <radialGradient id="${id}-mouth-inside" cx="0.5" cy="0.35" r="0.7">
            <stop offset="0" stop-color="#6a1c28" />
            <stop offset="1" stop-color="#2a070d" />
        </radialGradient>
    </defs>
    <path d="M14 10 Q60 0 106 10 Q106 56 60 76 Q14 56 14 10 Z" fill="url(#${id}-mouth-inside)" stroke="#6a3e22" stroke-width="4" stroke-linejoin="round" />
    <path d="M24 12 Q60 5 96 12 L94 22 Q60 15 26 22 Z" fill="#fbf6e9" />
    <path d="M34 56 Q60 44 86 56 Q80 72 60 75 Q40 72 34 56 Z" fill="#e17c8e" />`,
        },
    });
});

// ---------------- Robot ----------------
builders.push(() => {
    const id = 'robot';
    const random = rng(61);
    const brushed = [];
    for (let i = 0; i < 160; i++) {
        const y = 74 + random() * 500;
        const x = 104 + random() * 300;
        brushed.push(`M${fmt(x)} ${fmt(y)}h${fmt(40 + random() * 140)}`);
    }
    const screw = (x, y) =>
        `<g transform="translate(${x} ${y})"><circle r="10" fill="url(#${id}-screw)" stroke="#5f6b80" stroke-width="1.5" /><path d="M-6 -2 L6 2" stroke="#4a5568" stroke-width="2.5" stroke-linecap="round" /></g>`;
    const vents = (x) =>
        Array.from(
            { length: 6 },
            (_, i) =>
                `<rect x="${x}" y="${290 + i * 12}" width="30" height="5" rx="2.5" fill="#4a5568" fill-opacity="0.7" />`
        ).join('');
    const headSvg = `    <defs>
        <linearGradient id="${id}-metal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#f4f7fb" />
            <stop offset="0.45" stop-color="#c3cbd8" />
            <stop offset="0.75" stop-color="#9ca6b8" />
            <stop offset="1" stop-color="#7a8598" />
        </linearGradient>
        <linearGradient id="${id}-side" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#7a8598" />
            <stop offset="0.5" stop-color="#b9c2d0" />
            <stop offset="1" stop-color="#6d778a" />
        </linearGradient>
        <linearGradient id="${id}-visor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#1d2b44" />
            <stop offset="1" stop-color="#070b14" />
        </linearGradient>
        <linearGradient id="${id}-glare" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#ffffff" stop-opacity="0.22" />
            <stop offset="0.5" stop-color="#ffffff" stop-opacity="0" />
        </linearGradient>
        <radialGradient id="${id}-screw" cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="1" stop-color="#8a95a8" />
        </radialGradient>
        <radialGradient id="${id}-bulb" cx="0.38" cy="0.32" r="0.65">
            <stop offset="0" stop-color="#ffe0e0" />
            <stop offset="0.5" stop-color="#ff4d4d" />
            <stop offset="1" stop-color="#a51515" />
        </radialGradient>
        <clipPath id="${id}-clip"><rect x="100" y="70" width="400" height="510" rx="80" /></clipPath>
        ${softFilter(`${id}-glow`, 7)}
        ${softFilter(`${id}-shadow`, 6)}
    </defs>
    <rect x="290" y="24" width="20" height="56" rx="6" fill="url(#${id}-side)" stroke="#5f6b80" stroke-width="2" />
    <circle cx="300" cy="22" r="26" fill="#ff4d4d" fill-opacity="0.45" filter="url(#${id}-glow)" />
    <circle cx="300" cy="22" r="17" fill="url(#${id}-bulb)" />
    <rect x="46" y="250" width="78" height="150" rx="26" fill="url(#${id}-side)" stroke="#5f6b80" stroke-width="4" />
    <rect x="476" y="250" width="78" height="150" rx="26" fill="url(#${id}-side)" stroke="#5f6b80" stroke-width="4" />
    ${vents(70)}${vents(500)}
    <rect x="108" y="84" width="400" height="510" rx="80" fill="#000000" fill-opacity="0.35" filter="url(#${id}-shadow)" />
    <rect x="100" y="70" width="400" height="510" rx="80" fill="url(#${id}-metal)" />
    <g clip-path="url(#${id}-clip)">
        <path d="${brushed.join('')}" stroke="#ffffff" stroke-width="1" stroke-opacity="0.18" />
        <path d="M100 196 H500 M100 524 H500" stroke="#7a8598" stroke-width="3" stroke-opacity="0.5" />
        <path d="M100 198 H500 M100 526 H500" stroke="#ffffff" stroke-width="2" stroke-opacity="0.6" />
    </g>
    <rect x="100" y="70" width="400" height="510" rx="80" fill="none" stroke="#5f6b80" stroke-width="6" />
    <rect x="108" y="78" width="384" height="494" rx="74" fill="none" stroke="#ffffff" stroke-width="3" stroke-opacity="0.55" />
    <rect x="146" y="218" width="308" height="168" rx="48" fill="#5f6b80" />
    <rect x="152" y="224" width="296" height="156" rx="44" fill="url(#${id}-visor)" />
    <rect x="152" y="224" width="296" height="156" rx="44" fill="url(#${id}-glare)" />
    <rect x="208" y="410" width="184" height="92" rx="24" fill="#5f6b80" />
    <rect x="214" y="416" width="172" height="80" rx="20" fill="url(#${id}-visor)" />
    ${screw(140, 116)}${screw(460, 116)}${screw(140, 534)}${screw(460, 534)}
    <path d="M150 150 Q300 120 450 150" fill="none" stroke="#ffffff" stroke-width="5" stroke-opacity="0.45" stroke-linecap="round" />`;
    const cyan = '#5ef2ff';
    characters.push({
        id,
        label: 'Robot',
        order: 370,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: `    <defs>
        ${softFilter(`${id}-eye-glow`, 6)}
        <radialGradient id="${id}-eye-lens" cx="0.4" cy="0.35" r="0.65">
            <stop offset="0" stop-color="#e9feff" />
            <stop offset="0.5" stop-color="${cyan}" />
            <stop offset="1" stop-color="#0e8fa3" />
        </radialGradient>
    </defs>
    <circle cx="55" cy="55" r="36" fill="${cyan}" fill-opacity="0.5" filter="url(#${id}-eye-glow)" />
    <circle cx="55" cy="55" r="30" fill="#0b2a36" stroke="#2bd5e8" stroke-width="3" />
    <circle cx="55" cy="55" r="22" fill="url(#${id}-eye-lens)" />
    <circle cx="55" cy="55" r="9" fill="#0b2a36" fill-opacity="0.55" />
    <circle cx="46" cy="45" r="6" fill="#ffffff" fill-opacity="0.9" />`,
            closed: `    <defs>${softFilter(`${id}-eye-glow-closed`, 5)}</defs>
    <rect x="16" y="48" width="78" height="14" rx="7" fill="${cyan}" fill-opacity="0.5" filter="url(#${id}-eye-glow-closed)" />
    <rect x="20" y="50" width="70" height="10" rx="5" fill="${cyan}" />`,
        },
        brow: {
            box: [190, 230, 90, 20],
            svg: `    <rect x="8" y="6" width="74" height="8" rx="4" fill="${cyan}" fill-opacity="0.85" />`,
            lift: 6,
        },
        mouth: {
            box: [230, 426, 140, 60],
            neutral: `    <rect x="14" y="26" width="112" height="8" rx="4" fill="${cyan}" />`,
            smile: `    <path d="M16 16 Q70 52 124 16" fill="none" stroke="${cyan}" stroke-width="8" stroke-linecap="round" />`,
            open: `    <g fill="${cyan}">
        <rect x="8" y="14" width="14" height="32" rx="5" /><rect x="28" y="6" width="14" height="48" rx="5" />
        <rect x="48" y="0" width="14" height="60" rx="5" /><rect x="68" y="2" width="14" height="56" rx="5" />
        <rect x="88" y="6" width="14" height="48" rx="5" /><rect x="108" y="14" width="14" height="32" rx="5" />
    </g>`,
        },
    });
});

// ---------------- Alien ----------------
builders.push(() => {
    const id = 'alien';
    const d =
        'M300 34 C480 34 540 190 512 320 C490 450 390 590 300 600 C210 590 110 450 88 320 C60 190 120 34 300 34 Z';
    const random = rng(71);
    const spots = [];
    for (let i = 0; i < 60; i++) {
        const x = 150 + random() * 300;
        const y = 70 + random() * 180;
        spots.push(
            `<ellipse cx="${fmt(x)}" cy="${fmt(y)}" rx="${fmt(3 + random() * 9)}" ry="${fmt(2 + random() * 6)}" />`
        );
    }
    const headSvg = `    <defs>
        <radialGradient id="${id}-skin" cx="0.5" cy="0.38" r="0.68">
            <stop offset="0" stop-color="#c8f7a6" />
            <stop offset="0.55" stop-color="#7fd16a" />
            <stop offset="1" stop-color="#3f8f3c" />
        </radialGradient>
        <radialGradient id="${id}-sss" cx="0.5" cy="0.85" r="0.5">
            <stop offset="0" stop-color="#d9ff8a" stop-opacity="0.35" />
            <stop offset="1" stop-color="#d9ff8a" stop-opacity="0" />
        </radialGradient>
        ${softFilter(`${id}-blur`, 1.5)}
    </defs>
    <path d="${d}" fill="url(#${id}-skin)" />
    <path d="${d}" fill="url(#${id}-sss)" />
${shading(`${id}-head`, d, { rim: 0.3, light: 0.3, rimColor: '#0f3a12' })}
    <g fill="#2e7d32" fill-opacity="0.16">${spots.join('')}</g>
    <path d="M196 182 Q300 150 404 182" fill="none" stroke="#ffffff" stroke-width="10" stroke-opacity="0.22" stroke-linecap="round" filter="url(#${id}-blur)" />
    <path d="M286 352 Q300 380 314 352" fill="none" stroke="#2e6b2e" stroke-width="4" stroke-opacity="0.35" stroke-linecap="round" filter="url(#${id}-blur)" />
    <path d="M283 414 Q287 424 291 414 M309 414 Q313 424 317 414" fill="none" stroke="#1b5e20" stroke-width="4" stroke-linecap="round" />
    <path d="M300 34 C480 34 540 190 512 320" fill="none" stroke="#e5ffd0" stroke-width="5" stroke-opacity="0.35" filter="url(#${id}-blur)" />`;
    const eyeShape =
        'M5.1 20.6 C34.1 1.9 95.5 9.4 121.1 48.6 C128 86 92.1 114.1 59.7 108.5 C23.9 102.9 0 65.5 5.1 20.6 Z';
    characters.push({
        id,
        label: 'Alien',
        order: 380,
        head: headSvg,
        eye: {
            box: [128, 116],
            spread: 12,
            open: `    <defs>
        <radialGradient id="${id}-eye" cx="0.38" cy="0.32" r="0.8">
            <stop offset="0" stop-color="#4a5464" />
            <stop offset="0.5" stop-color="#121722" />
            <stop offset="1" stop-color="#020306" />
        </radialGradient>
        <linearGradient id="${id}-eye-rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.6" stop-color="#7fffd4" stop-opacity="0" />
            <stop offset="1" stop-color="#7fffd4" stop-opacity="0.35" />
        </linearGradient>
    </defs>
    <path d="${eyeShape}" fill="url(#${id}-eye)" stroke="#1f4d22" stroke-width="3" />
    <path d="${eyeShape}" fill="url(#${id}-eye-rim)" />
    <g fill="#ffffff" fill-opacity="0.85" transform="rotate(18 40 34)">
        <rect x="24" y="22" width="14" height="18" rx="3" /><rect x="41" y="22" width="14" height="18" rx="3" />
    </g>
    <ellipse cx="88" cy="80" rx="8" ry="4" fill="#ffffff" fill-opacity="0.45" transform="rotate(30 88 80)" />`,
            closed: `    <defs>
        <radialGradient id="${id}-lid" cx="0.5" cy="0.3" r="0.8">
            <stop offset="0" stop-color="#a6e88c" />
            <stop offset="1" stop-color="#5cb85c" />
        </radialGradient>
    </defs>
    <path d="${eyeShape}" fill="url(#${id}-lid)" stroke="#2e7d32" stroke-width="2" />
    <path d="M10 60 C38 96 98 104 124 62" fill="none" stroke="#1b5e20" stroke-width="6" stroke-linecap="round" />`,
        },
        brow: {
            box: [168, 204, 120, 40],
            svg: `    <defs>${softFilter(`${id}-brow-soft`, 2)}</defs>
    <path d="M10 32 Q60 4 112 22" fill="none" stroke="#2e7d32" stroke-width="8" stroke-opacity="0.45" stroke-linecap="round" filter="url(#${id}-brow-soft)" />
    <path d="M12 28 Q60 2 110 18" fill="none" stroke="#e5ffd0" stroke-width="3" stroke-opacity="0.4" stroke-linecap="round" />`,
            lift: 14,
        },
        mouth: {
            box: [240, 450, 120, 70],
            neutral: `    <path d="M24 24 Q60 32 96 24" fill="none" stroke="#1b5e20" stroke-width="6" stroke-linecap="round" />`,
            smile: `    <path d="M14 14 Q60 54 106 14" fill="none" stroke="#1b5e20" stroke-width="7" stroke-linecap="round" />`,
            open: `    <defs>
        <radialGradient id="${id}-mouth" cx="0.5" cy="0.35" r="0.7">
            <stop offset="0" stop-color="#1f4a22" />
            <stop offset="1" stop-color="#061208" />
        </radialGradient>
    </defs>
    <path d="M24 10 Q60 2 96 10 Q100 46 60 66 Q20 46 24 10 Z" fill="url(#${id}-mouth)" stroke="#1b5e20" stroke-width="4" stroke-linejoin="round" />
    <path d="M38 46 Q60 36 82 46 Q76 60 60 63 Q44 60 38 46 Z" fill="#7ad67a" fill-opacity="0.85" />`,
        },
    });
});

// ####################################################
// HUMANS AND FANTASY CREATURES
// ####################################################

// Human mouths (130x80 box, centred on the lip line): closed, smiling with teeth and open
function humanMouths(id, { lip, lipDark, inside = ['#7a1f2b', '#2e080e'], tongue = '#e8667f' }) {
    const neutral = `    <path d="M14 36 Q36 24 65 31 Q94 24 116 36 Q92 56 65 58 Q38 56 14 36 Z" fill="${lip}" stroke="${lipDark}" stroke-width="3" stroke-linejoin="round" />
    <path d="M14 36 Q65 46 116 36" fill="none" stroke="${lipDark}" stroke-width="3.5" stroke-linecap="round" />
    <path d="M44 33 Q65 28 86 33" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="3" stroke-linecap="round" />`;
    const smile = `    <defs><clipPath id="${id}-smile-clip"><path d="M8 24 Q65 34 122 24 Q114 66 65 70 Q16 66 8 24 Z" /></clipPath></defs>
    <path d="M8 24 Q65 34 122 24 Q114 66 65 70 Q16 66 8 24 Z" fill="${inside[1]}" />
    <g clip-path="url(#${id}-smile-clip)">
        <path d="M6 22 Q65 34 124 22 L124 44 Q65 54 6 44 Z" fill="#fffdf8" />
        <path d="M30 70 Q65 48 100 70 Z" fill="${tongue}" />
    </g>
    <path d="M8 24 Q65 34 122 24 Q114 66 65 70 Q16 66 8 24 Z" fill="none" stroke="${lipDark}" stroke-width="5" stroke-linejoin="round" />
    <path d="M8 24 Q4 20 5 14 M122 24 Q126 20 125 14" fill="none" stroke="${lipDark}" stroke-width="4" stroke-linecap="round" />`;
    const open = `    <defs>
        <radialGradient id="${id}-inside" cx="0.5" cy="0.4" r="0.7">
            <stop offset="0" stop-color="${inside[0]}" />
            <stop offset="1" stop-color="${inside[1]}" />
        </radialGradient>
        <clipPath id="${id}-open-clip"><path d="M18 14 Q65 2 112 14 Q120 54 65 76 Q10 54 18 14 Z" /></clipPath>
    </defs>
    <path d="M18 14 Q65 2 112 14 Q120 54 65 76 Q10 54 18 14 Z" fill="url(#${id}-inside)" />
    <g clip-path="url(#${id}-open-clip)">
        <path d="M14 12 Q65 0 116 12 L116 28 Q65 18 14 28 Z" fill="#fffdf8" />
        <path d="M32 70 Q65 44 98 70 Q82 82 65 82 Q48 82 32 70 Z" fill="${tongue}" />
    </g>
    <path d="M18 14 Q65 2 112 14 Q120 54 65 76 Q10 54 18 14 Z" fill="none" stroke="${lipDark}" stroke-width="5" stroke-linejoin="round" />`;
    return { neutral, smile, open };
}

// Shared drawing of the human-like heads (man, woman, elf): ears, face, nose and cheeks
function humanFace(id, { skin, skinDark, outline, blush, earPoints = null, extraDefs = '' }) {
    const head = [
        [300, 66], [396, 80], [458, 140], [482, 236], [482, 330], [468, 418], [428, 498], [366, 556], [300, 578],
        [234, 556], [172, 498], [132, 418], [118, 330], [118, 236], [142, 140], [204, 80],
    ]; // prettier-ignore
    const d = catmull(head);
    const ear = earPoints || [ellipse(112, 336, 30, 52, 20, -0.1), ellipse(488, 336, 30, 52, 20, 0.1)].map(catmull);
    return {
        d,
        back: `    <defs>
        <radialGradient id="${id}-skin" cx="0.5" cy="0.4" r="0.66">
            <stop offset="0" stop-color="${skin[0]}" />
            <stop offset="0.75" stop-color="${skin[1]}" />
            <stop offset="1" stop-color="${skin[2]}" />
        </radialGradient>
        ${softFilter(`${id}-soft`, 5)}
        ${softFilter(`${id}-blur`, 1.6)}
        ${extraDefs}
    </defs>
    ${ear.map((e) => `<path d="${e}" fill="url(#${id}-skin)" stroke="${outline}" stroke-width="4" stroke-linejoin="round" />`).join('\n    ')}`,
        face: `    <path d="${d}" fill="url(#${id}-skin)" />
${shading(`${id}-face`, d, { rim: 0.2, light: 0.2, rimColor: skinDark })}
    <path d="${d}" fill="none" stroke="${outline}" stroke-width="5" stroke-linejoin="round" />
    <ellipse cx="190" cy="420" rx="40" ry="24" fill="${blush}" fill-opacity="0.3" filter="url(#${id}-soft)" />
    <ellipse cx="410" cy="420" rx="40" ry="24" fill="${blush}" fill-opacity="0.3" filter="url(#${id}-soft)" />
    <path d="M308 322 Q320 366 326 396" fill="none" stroke="${skinDark}" stroke-width="9" stroke-opacity="0.22" stroke-linecap="round" filter="url(#${id}-blur)" />
    <path d="M276 398 Q300 418 324 398" fill="none" stroke="${outline}" stroke-width="4.5" stroke-linecap="round" />
    <path d="M280 404 Q288 410 294 404 M306 404 Q312 410 320 404" fill="none" stroke="${outline}" stroke-width="3" stroke-linecap="round" />
    <ellipse cx="296" cy="388" rx="10" ry="6" fill="#ffffff" fill-opacity="0.28" filter="url(#${id}-blur)" />`,
    };
}

const humanEyeShape = 'M8 58 C26 32 84 30 102 56 C84 82 26 84 8 58 Z';
const humanCrease = 'M12 46 C32 22 80 22 98 44';

// ---------------- Man ----------------
builders.push(() => {
    const id = 'man';
    const { back, face } = humanFace(id, {
        skin: ['#ffe0c4', '#f1bf98', '#d79c74'],
        skinDark: '#8a4f2a',
        outline: '#a8683f',
        blush: '#f08a78',
    });
    const random = rng(137);
    const strands = [];
    for (let i = 0; i < 26; i++) {
        const x = 150 + random() * 300;
        const y = 70 + random() * 70;
        strands.push(
            `M${fmt(x)} ${fmt(y)}q${fmt((random() - 0.5) * 30)} ${fmt(20 + random() * 18)} ${fmt((random() - 0.5) * 44)} ${fmt(40 + random() * 22)}`
        );
    }
    const hair = `    <defs>
        <linearGradient id="${id}-hair" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#7a4a2a" />
            <stop offset="1" stop-color="#3a2010" />
        </linearGradient>
    </defs>
    <path d="M118 300 C84 130 190 30 300 30 C410 30 516 130 482 300 C476 240 462 214 440 196 C400 150 360 138 300 138 C240 138 200 150 160 196 C138 214 124 240 118 300 Z" fill="url(#${id}-hair)" stroke="#2a1608" stroke-width="5" stroke-linejoin="round" />
    <path d="M214 120 C250 104 330 100 396 126" fill="none" stroke="#ffffff" stroke-opacity="0.3" stroke-width="10" stroke-linecap="round" filter="url(#${id}-blur)" />
    <path d="${strands.join('')}" fill="none" stroke="#2a1608" stroke-opacity="0.3" stroke-width="3" stroke-linecap="round" />
    <path d="M118 300 C124 330 130 338 136 340 L142 270 Z M482 300 C476 330 470 338 464 340 L458 270 Z" fill="#3a2010" />
    <path d="M232 540 Q300 590 368 540 Q330 566 300 566 Q270 566 232 540 Z" fill="#6b4226" fill-opacity="0.28" />`;
    characters.push({
        id,
        label: 'Man',
        order: 430,
        head: `${back}\n${face}\n${hair}`,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: humanEyeShape,
                center: [55, 57],
                irisRadius: 22,
                iris: ['#b98a52', '#6a4220', '#2a1608'],
                sclera: '#fffaf4',
                outline: '#3a2010',
                crease: humanCrease,
            }),
            closed: closedEye({
                lid: 'M10 58 C30 76 80 76 100 56',
                color: '#4a2a14',
                lashes: false,
                crease: humanCrease,
            }),
        },
        brow: {
            box: [185, 218, 100, 40],
            svg: `    <path d="M6 32 Q42 4 94 20 Q96 30 90 32 Q46 18 12 38 Z" fill="#3a2010" fill-opacity="0.92" />`,
            lift: 14,
        },
        mouth: { box: [235, 456, 130, 80], ...humanMouths(`${id}-mouth`, { lip: '#d98a7a', lipDark: '#8a3f36' }) },
    });
});

// ---------------- Woman ----------------
builders.push(() => {
    const id = 'woman';
    const { back, face } = humanFace(id, {
        skin: ['#ffe6d2', '#f5c9a6', '#dca682'],
        skinDark: '#945634',
        outline: '#b4724a',
        blush: '#ff7f9a',
    });
    const hairBack = `    <defs>
        <linearGradient id="${id}-hair" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0" stop-color="#b8551f" />
            <stop offset="0.55" stop-color="#8f3a12" />
            <stop offset="1" stop-color="#5a2108" />
        </linearGradient>
    </defs>
    <path d="M300 30 C136 30 60 160 74 320 C80 380 78 424 94 456 C130 480 176 456 184 420 L416 420 C424 456 470 480 506 456 C522 424 520 380 526 320 C540 160 464 30 300 30 Z" fill="url(#${id}-hair)" stroke="#4a1a06" stroke-width="5" stroke-linejoin="round" />
    <path d="M92 360 C96 410 94 436 104 452 M508 360 C504 410 506 436 496 452" fill="none" stroke="#3a1304" stroke-opacity="0.35" stroke-width="4" stroke-linecap="round" />`;
    const fringe = `    <path d="M112 330 C86 150 190 46 300 46 C410 46 514 150 488 330 C482 262 462 214 430 186 C384 226 322 220 276 168 C236 214 170 232 138 270 C126 290 118 308 112 330 Z" fill="url(#${id}-hair)" stroke="#4a1a06" stroke-width="5" stroke-linejoin="round" />
    <path d="M276 168 C262 120 262 84 280 52 M330 176 C340 124 360 92 392 66 M200 200 C170 160 160 120 170 90" fill="none" stroke="#3a1304" stroke-opacity="0.3" stroke-width="4" stroke-linecap="round" />
    <path d="M188 110 C230 80 330 74 400 100" fill="none" stroke="#ffd0a0" stroke-opacity="0.45" stroke-width="10" stroke-linecap="round" filter="url(#${id}-blur)" />`;
    const lashed = (
        shape,
        flicks
    ) => `<path d="${shape}" fill="none" stroke="#2a1008" stroke-width="7" stroke-linecap="round" />
    <path d="${flicks}" fill="none" stroke="#2a1008" stroke-width="4.5" stroke-linecap="round" />`;
    characters.push({
        id,
        label: 'Woman',
        order: 450,
        head: `${hairBack}\n${back}\n${face}\n${fringe}`,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: `${eye({
                id: `${id}-eye`,
                shape: humanEyeShape,
                center: [55, 57],
                irisRadius: 23,
                iris: ['#8fd0b0', '#2f8f6a', '#0e3d2c'],
                sclera: '#fffaf4',
                outline: '#2a1008',
                crease: humanCrease,
            })}
    ${lashed('M8 58 C26 32 84 30 102 56', 'M12 48 L2 40 M24 38 L16 28 M92 40 L100 30')}`,
            closed: `${closedEye({ lid: 'M10 58 C30 76 80 76 100 56', color: '#2a1008', lashes: true, width: 5 })}`,
        },
        brow: {
            box: [185, 216, 100, 40],
            svg: `    <path d="M8 30 Q44 2 94 24 Q48 12 8 34 Z" fill="#5a2108" fill-opacity="0.85" />`,
            lift: 14,
        },
        mouth: { box: [235, 456, 130, 80], ...humanMouths(`${id}-mouth`, { lip: '#e0405f', lipDark: '#8c1731' }) },
    });
});

// ---------------- Man 2 (short cropped hair) ----------------
builders.push(() => {
    const id = 'blackman';
    const { back, face } = humanFace(id, {
        skin: ['#b57a54', '#8f5a38', '#693d22'],
        skinDark: '#2e140a',
        outline: '#3f1f0e',
        blush: '#c0584a',
    });
    const random = rng(331);
    const curls = [];
    for (let i = 0; i < 90; i++) {
        const x = 150 + random() * 300;
        const y = 64 + random() * 90;
        curls.push(`<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(2 + random() * 2.5)}" />`);
    }
    const hair = `    <defs>
        <linearGradient id="${id}-hair" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#2e2623" />
            <stop offset="1" stop-color="#0a0605" />
        </linearGradient>
        <clipPath id="${id}-hair-clip"><path d="M120 292 C96 150 188 52 300 52 C412 52 504 150 480 292 C474 244 460 210 440 192 C402 160 360 152 300 152 C240 152 198 160 160 192 C140 210 126 244 120 292 Z" /></clipPath>
    </defs>
    <path d="M120 292 C96 150 188 52 300 52 C412 52 504 150 480 292 C474 244 460 210 440 192 C402 160 360 152 300 152 C240 152 198 160 160 192 C140 210 126 244 120 292 Z" fill="url(#${id}-hair)" stroke="#050303" stroke-width="5" stroke-linejoin="round" />
    <g fill="#ffffff" fill-opacity="0.16" clip-path="url(#${id}-hair-clip)">${curls.join('')}</g>
    <path d="M204 104 C250 82 340 80 400 106" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="10" stroke-linecap="round" filter="url(#${id}-blur)" />
    <path d="M120 292 C124 322 130 332 136 334 L142 266 Z M480 292 C476 322 470 332 464 334 L458 266 Z" fill="#0a0605" />
    <path d="M232 540 Q300 590 368 540 Q330 566 300 566 Q270 566 232 540 Z" fill="#1a0c06" fill-opacity="0.3" />`;
    characters.push({
        id,
        label: 'Man 2',
        order: 440,
        head: `${back}\n${face}\n${hair}`,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: humanEyeShape,
                center: [55, 57],
                irisRadius: 22,
                iris: ['#8a5a30', '#3a2010', '#140a04'],
                sclera: '#fff6e8',
                outline: '#1a0c06',
                crease: humanCrease,
            }),
            closed: closedEye({
                lid: 'M10 58 C30 76 80 76 100 56',
                color: '#1a0c06',
                lashes: false,
                crease: humanCrease,
            }),
        },
        brow: {
            box: [185, 218, 100, 40],
            svg: `    <path d="M6 32 Q42 4 94 20 Q96 30 90 32 Q46 18 12 38 Z" fill="#0a0605" fill-opacity="0.92" />`,
            lift: 14,
        },
        mouth: { box: [235, 456, 130, 80], ...humanMouths(`${id}-mouth`, { lip: '#a8504a', lipDark: '#4a1814' }) },
    });
});

// ---------------- Woman 2 (short natural hair) ----------------
builders.push(() => {
    const id = 'blackwoman';
    const { back, face } = humanFace(id, {
        skin: ['#b98058', '#935d3a', '#6c4024'],
        skinDark: '#2e140a',
        outline: '#3f1f0e',
        blush: '#d4586a',
    });
    const random = rng(417);
    const puffs = [];
    for (let i = 0; i < 19; i++) {
        const t = ((166 + (i / 18) * 208) * Math.PI) / 180;
        const r = 24 + random() * 8;
        puffs.push(
            `<circle cx="${fmt(300 + Math.cos(t) * 224)}" cy="${fmt(250 + Math.sin(t) * 196)}" r="${fmt(r)}" />`
        );
    }
    const hair = `    <defs>
        <linearGradient id="${id}-hair" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#34292a" />
            <stop offset="1" stop-color="#0a0605" />
        </linearGradient>
        <linearGradient id="${id}-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#fff2a8" />
            <stop offset="1" stop-color="#c78e12" />
        </linearGradient>
    </defs>
    <g fill="url(#${id}-hair)" stroke="#050303" stroke-width="10">${puffs.join('')}</g>
    <g fill="url(#${id}-hair)">${puffs.join('')}</g>
    <path d="M122 330 C84 250 82 140 170 80 C230 38 370 38 430 80 C518 140 516 250 478 330 C476 264 454 216 424 192 C384 156 216 156 176 192 C146 216 124 264 122 330 Z" fill="url(#${id}-hair)" />
    <path d="M122 330 C124 264 146 216 176 192 C216 156 384 156 424 192 C454 216 476 264 478 330" fill="none" stroke="#050303" stroke-width="4" stroke-linejoin="round" />
    <path d="M150 112 C210 60 390 60 450 112" fill="none" stroke="#ffffff" stroke-opacity="0.2" stroke-width="12" stroke-linecap="round" filter="url(#${id}-blur)" />
    <g fill="none" stroke="url(#${id}-gold)" stroke-width="7">
        <circle cx="110" cy="402" r="20" /><circle cx="490" cy="402" r="20" />
    </g>`;
    const lashed = (
        shape,
        flicks
    ) => `<path d="${shape}" fill="none" stroke="#0a0605" stroke-width="7" stroke-linecap="round" />
    <path d="${flicks}" fill="none" stroke="#0a0605" stroke-width="4.5" stroke-linecap="round" />`;
    characters.push({
        id,
        label: 'Woman 2',
        order: 460,
        head: `${back}\n${face}\n${hair}`,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: `${eye({
                id: `${id}-eye`,
                shape: humanEyeShape,
                center: [55, 57],
                irisRadius: 23,
                iris: ['#a8743c', '#4a2a10', '#160a04'],
                sclera: '#fff6e8',
                outline: '#0a0605',
                crease: humanCrease,
            })}
    ${lashed('M8 58 C26 32 84 30 102 56', 'M12 48 L2 40 M24 38 L16 28 M92 40 L100 30')}`,
            closed: closedEye({ lid: 'M10 58 C30 76 80 76 100 56', color: '#0a0605', lashes: true, width: 5 }),
        },
        brow: {
            box: [185, 216, 100, 40],
            svg: `    <path d="M8 30 Q44 2 94 24 Q48 12 8 34 Z" fill="#0a0605" fill-opacity="0.85" />`,
            lift: 14,
        },
        mouth: { box: [235, 456, 130, 80], ...humanMouths(`${id}-mouth`, { lip: '#b0304f', lipDark: '#560f26' }) },
    });
});

// ---------------- Elf ----------------
builders.push(() => {
    const id = 'elf';
    const earRight = 'M126 290 C84 262 50 222 14 168 C54 214 88 268 108 302 C106 336 112 366 134 378 Z';
    const earLeft = 'M474 290 C516 262 550 222 586 168 C546 214 512 268 492 302 C494 336 488 366 466 378 Z';
    const earInner =
        'M118 296 C86 270 62 242 38 204 C70 240 94 278 108 308 Z M482 296 C514 270 538 242 562 204 C530 240 506 278 492 308 Z';
    const { back, face } = humanFace(id, {
        skin: ['#fff1e6', '#f4d6c4', '#d8b09c'],
        skinDark: '#8a5a52',
        outline: '#b88a7a',
        blush: '#f6a0c0',
        earPoints: [earRight, earLeft],
    });
    const hairBack = `    <defs>
        <linearGradient id="${id}-hair" x1="0" y1="0" x2="0.5" y2="1">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="0.5" stop-color="#e4e9f6" />
            <stop offset="1" stop-color="#aab4d4" />
        </linearGradient>
        <radialGradient id="${id}-gem" cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stop-color="#d6ffe4" />
            <stop offset="0.5" stop-color="#27c46a" />
            <stop offset="1" stop-color="#0b6a38" />
        </radialGradient>
        <linearGradient id="${id}-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff2a8" />
            <stop offset="1" stop-color="#c78e12" />
        </linearGradient>
    </defs>
    <path d="M300 34 C148 34 76 150 90 296 C94 330 108 344 124 336 L476 336 C492 344 506 330 510 296 C524 150 452 34 300 34 Z" fill="url(#${id}-hair)" stroke="#8a93b5" stroke-width="5" stroke-linejoin="round" />`;
    const front = `    <path d="${earInner}" fill="#f2aebd" fill-opacity="0.55" />
    <path d="M112 320 C86 150 190 44 300 44 C410 44 514 150 488 320 C480 252 454 206 420 178 C380 214 336 200 300 160 C264 200 220 214 180 178 C146 206 120 252 112 320 Z" fill="url(#${id}-hair)" stroke="#8a93b5" stroke-width="5" stroke-linejoin="round" />
    <path d="M300 160 C292 118 296 84 310 50 M230 190 C206 150 198 112 206 78 M370 190 C394 150 402 112 394 78" fill="none" stroke="#8a93b5" stroke-opacity="0.45" stroke-width="3.5" stroke-linecap="round" />
    <path d="M150 196 Q300 128 450 196" fill="none" stroke="url(#${id}-gold)" stroke-width="9" stroke-linecap="round" />
    <path d="M300 154 L322 178 L300 204 L278 178 Z" fill="url(#${id}-gem)" stroke="#a97a10" stroke-width="3.5" stroke-linejoin="round" />
    <circle cx="293" cy="172" r="4" fill="#ffffff" fill-opacity="0.85" />
    <path d="M236 150 q4 10 14 12 q-10 2 -14 12 q-4 -10 -14 -12 q10 -2 14 -12 Z M368 142 q3 8 11 9 q-8 2 -11 9 q-3 -7 -11 -9 q8 -1 11 -9 Z" fill="#fff6c4" />`;
    characters.push({
        id,
        label: 'Elf',
        order: 360,
        head: `${hairBack}\n${back}\n${face}\n${front}`,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: `${eye({
                id: `${id}-eye`,
                shape: humanEyeShape,
                center: [55, 57],
                irisRadius: 24,
                iris: ['#e0c8ff', '#8b5de0', '#3a1f7a'],
                sclera: '#ffffff',
                outline: '#3a2a5a',
                crease: humanCrease,
            })}
    <path d="M8 58 C26 32 84 30 102 56" fill="none" stroke="#3a2a5a" stroke-width="6" stroke-linecap="round" />
    <path d="M10 52 L0 44 M96 44 L108 38" fill="none" stroke="#3a2a5a" stroke-width="4" stroke-linecap="round" />`,
            closed: closedEye({ lid: 'M10 58 C30 76 80 76 100 56', color: '#3a2a5a', lashes: true }),
        },
        brow: {
            box: [185, 212, 100, 40],
            svg: `    <path d="M8 32 Q46 2 96 14 Q50 12 8 36 Z" fill="#aab4d4" fill-opacity="0.9" />`,
            lift: 14,
        },
        mouth: { box: [235, 456, 130, 80], ...humanMouths(`${id}-mouth`, { lip: '#e98aa6', lipDark: '#9a3f5e' }) },
    });
});

// ---------------- Dragon ----------------
builders.push(() => {
    const id = 'dragon';
    const head = [
        [300, 70], [402, 82], [472, 148], [506, 250], [512, 340], [492, 432], [442, 510], [380, 566], [300, 592],
        [220, 566], [158, 510], [108, 432], [88, 340], [94, 250], [128, 148], [198, 82],
    ]; // prettier-ignore
    const d = catmull(head);
    const hornOuter = 'M222 120 C150 90 128 40 140 2 C196 28 250 66 270 112 Z';
    const fin = 'M96 238 L16 196 L58 248 L2 276 L62 296 L18 344 L100 330 Z';
    const random = rng(211);
    const scales = [];
    for (let i = 0; i < 90; i++) {
        const x = 110 + random() * 380;
        const y = 90 + random() * 250;
        scales.push(`M${fmt(x)} ${fmt(y)}q7 8 14 0`);
    }
    const spikes = (x) => `M${x - 24} 84 L${x} 20 L${x + 24} 84 Z`;
    const headSvg = `    <defs>
        <radialGradient id="${id}-skin" cx="0.5" cy="0.42" r="0.64">
            <stop offset="0" stop-color="#7ae28f" />
            <stop offset="0.65" stop-color="#34a853" />
            <stop offset="1" stop-color="#1b6f35" />
        </radialGradient>
        <radialGradient id="${id}-snout" cx="0.5" cy="0.4" r="0.6">
            <stop offset="0" stop-color="#f4f9a8" />
            <stop offset="1" stop-color="#b6d86a" />
        </radialGradient>
        <linearGradient id="${id}-horn" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stop-color="#c8651b" />
            <stop offset="1" stop-color="#fff0c4" />
        </linearGradient>
        <linearGradient id="${id}-fin" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#ff9a3c" />
            <stop offset="1" stop-color="#d8541a" />
        </linearGradient>
        ${softFilter(`${id}-soft`, 3)}
    </defs>
    <path d="${fin}" fill="url(#${id}-fin)" stroke="#8a3410" stroke-width="4" stroke-linejoin="round" />
    <path d="${fin}" fill="url(#${id}-fin)" stroke="#8a3410" stroke-width="4" stroke-linejoin="round" transform="translate(600 0) scale(-1 1)" />
    <path d="${hornOuter}" fill="url(#${id}-horn)" stroke="#8a4a12" stroke-width="4" stroke-linejoin="round" />
    <path d="${hornOuter}" fill="url(#${id}-horn)" stroke="#8a4a12" stroke-width="4" stroke-linejoin="round" transform="translate(600 0) scale(-1 1)" />
    <path d="${spikes(300)}" fill="url(#${id}-fin)" stroke="#8a3410" stroke-width="4" stroke-linejoin="round" />
    <path d="${spikes(238)}" fill="url(#${id}-fin)" stroke="#8a3410" stroke-width="4" stroke-linejoin="round" transform="translate(0 20) scale(1 0.8)" />
    <path d="${spikes(362)}" fill="url(#${id}-fin)" stroke="#8a3410" stroke-width="4" stroke-linejoin="round" transform="translate(0 20) scale(1 0.8)" />
    <path d="${d}" fill="url(#${id}-skin)" />
${shading(`${id}-head`, d, { rim: 0.34, light: 0.26, rimColor: '#06240f' })}
    <path d="${d}" fill="none" stroke="#12512a" stroke-width="5" stroke-linejoin="round" />
    <path d="${scales.join('')}" fill="none" stroke="#0f5a28" stroke-opacity="0.35" stroke-width="2.5" stroke-linecap="round" />
    <path d="${catmull(ellipse(300, 478, 130, 96, 28))}" fill="url(#${id}-snout)" />
    <path d="M200 420 Q300 392 400 420" fill="none" stroke="#6fa02c" stroke-opacity="0.45" stroke-width="3" stroke-linecap="round" />
    <ellipse cx="270" cy="410" rx="13" ry="8" fill="#1a3d17" transform="rotate(20 270 410)" />
    <ellipse cx="330" cy="410" rx="13" ry="8" fill="#1a3d17" transform="rotate(-20 330 410)" />
    <ellipse cx="266" cy="407" rx="4" ry="2" fill="#ffffff" fill-opacity="0.5" />
    <ellipse cx="334" cy="407" rx="4" ry="2" fill="#ffffff" fill-opacity="0.5" />
    <path d="M166 226 Q236 196 286 232 M314 232 Q364 196 434 226" fill="none" stroke="#0f5a28" stroke-opacity="0.4" stroke-width="9" stroke-linecap="round" filter="url(#${id}-soft)" />
    <ellipse cx="182" cy="418" rx="30" ry="16" fill="#ffb347" fill-opacity="0.25" filter="url(#${id}-soft)" />
    <ellipse cx="418" cy="418" rx="30" ry="16" fill="#ffb347" fill-opacity="0.25" filter="url(#${id}-soft)" />`;
    characters.push({
        id,
        label: 'Dragon',
        order: 340,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: 'M6 60 C20 24 86 20 104 50 C90 90 26 96 6 60 Z',
                center: [55, 57],
                irisRadius: 40,
                iris: ['#fff59a', '#ffb81f', '#c25a00'],
                pupil: 'slit',
                outline: '#0d3b1c',
            }),
            closed: closedEye({ lid: 'M6 60 C30 78 82 76 104 50', color: '#0d3b1c', lashes: false, width: 6 }),
        },
        brow: { box: [180, 206, 100, 40], svg: cartoonBrow({ color: '#e07a1f', opacity: 0.95 }), lift: 14 },
        mouth: {
            box: [250, 421, 100, 90],
            ...animalMouths(`${id}-mouth`, { color: '#0d3b1c', fangs: true, tongue: ['#ff8a5a', '#d6442a'] }),
        },
    });
});

// ---------------- Unicorn ----------------
builders.push(() => {
    const id = 'unicorn';
    const head = ellipse(300, 336, 206, 262, 32);
    const earShape = 'M176 150 C150 100 160 40 196 14 C236 54 258 96 262 138 Z';
    const earInner = 'M190 134 C174 100 180 62 198 42 C222 70 238 100 242 128 Z';
    const manes = [
        ['#ff6fb5', 'M196 70 C74 74 22 210 52 330 C70 410 22 490 40 608 C132 580 154 480 150 392 Z'],
        ['#b07cff', 'M206 86 C110 96 66 214 90 322 C104 394 70 470 84 568 C150 540 168 462 162 390 Z'],
        ['#5ec6ff', 'M214 104 C140 118 108 218 126 308 C136 366 116 430 126 510 C172 486 184 428 178 372 Z'],
    ];
    const fringe = [
        ['#ff6fb5', 'M214 124 C190 150 200 196 244 214 C230 190 232 160 262 132 Z'],
        ['#b07cff', 'M262 112 C238 150 252 190 300 202 C284 176 288 148 318 118 Z'],
        ['#5ec6ff', 'M318 112 C300 150 318 186 366 192 C350 168 352 144 372 118 Z'],
        ['#7be3a8', 'M372 124 C362 150 376 184 412 190 C400 168 404 148 416 130 Z'],
    ];
    const headSvg = `    <defs>
        <radialGradient id="${id}-coat" cx="0.5" cy="0.4" r="0.64">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="0.7" stop-color="#f7f0ff" />
            <stop offset="1" stop-color="#d8c8ee" />
        </radialGradient>
        <linearGradient id="${id}-horn" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stop-color="#e8a317" />
            <stop offset="0.5" stop-color="#ffe27a" />
            <stop offset="1" stop-color="#fff8d6" />
        </linearGradient>
        <radialGradient id="${id}-muzzle" cx="0.5" cy="0.35" r="0.7">
            <stop offset="0" stop-color="#fff2f6" />
            <stop offset="1" stop-color="#ffc9dc" />
        </radialGradient>
        ${softFilter(`${id}-soft`, 3)}
    </defs>
    ${manes.map(([color, shape]) => `<path d="${shape}" fill="${color}" stroke="#ffffff" stroke-opacity="0.5" stroke-width="3" /><path d="${shape}" fill="${color}" transform="translate(600 0) scale(-1 1)" stroke="#ffffff" stroke-opacity="0.5" stroke-width="3" />`).join('\n    ')}
    <path d="${earShape}" fill="url(#${id}-coat)" stroke="#b9a4d8" stroke-width="3.5" stroke-linejoin="round" />
    <path d="${earShape}" fill="url(#${id}-coat)" stroke="#b9a4d8" stroke-width="3.5" stroke-linejoin="round" transform="translate(600 0) scale(-1 1)" />
    <path d="${earInner}" fill="#ffb6cf" />
    <path d="${earInner}" fill="#ffb6cf" transform="translate(600 0) scale(-1 1)" />
    <path d="${catmull(head)}" fill="url(#${id}-coat)" />
${shading(`${id}-head`, catmull(head), { rim: 0.22, light: 0.22, rimColor: '#6a4a9a' })}
    <path d="${catmull(head)}" fill="none" stroke="#b9a4d8" stroke-width="5" />
    <path d="${catmull(ellipse(300, 500, 112, 84, 28))}" fill="url(#${id}-muzzle)" stroke="#f0a8c4" stroke-width="3" stroke-opacity="0.6" />
    <ellipse cx="272" cy="468" rx="9" ry="6" fill="#e07aa0" transform="rotate(25 272 468)" />
    <ellipse cx="328" cy="468" rx="9" ry="6" fill="#e07aa0" transform="rotate(-25 328 468)" />
    <ellipse cx="190" cy="430" rx="34" ry="19" fill="#ff8fb8" fill-opacity="0.35" filter="url(#${id}-soft)" />
    <ellipse cx="410" cy="430" rx="34" ry="19" fill="#ff8fb8" fill-opacity="0.35" filter="url(#${id}-soft)" />
    ${fringe.map(([color, shape]) => `<path d="${shape}" fill="${color}" stroke="#ffffff" stroke-opacity="0.5" stroke-width="3" />`).join('\n    ')}
    <path d="M268 124 L300 4 L332 124 Z" fill="url(#${id}-horn)" stroke="#b8820a" stroke-width="4" stroke-linejoin="round" />
    <path d="M276 100 L322 92 M281 76 L317 70 M287 52 L312 48 M292 30 L307 28" fill="none" stroke="#b8820a" stroke-width="5" stroke-linecap="round" />
    <path d="M252 62 q4 10 14 12 q-10 2 -14 12 q-4 -10 -14 -12 q10 -2 14 -12 Z M356 52 q3 8 11 9 q-8 2 -11 9 q-3 -7 -11 -9 q8 -1 11 -9 Z" fill="#ffffff" />`;
    characters.push({
        id,
        label: 'Unicorn',
        order: 350,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: `${eye({
                id: `${id}-eye`,
                shape: humanEyeShape,
                center: [55, 57],
                irisRadius: 25,
                iris: ['#e6d0ff', '#9a63f0', '#3a1d8a'],
                sclera: '#ffffff',
                outline: '#4a2c8a',
                crease: humanCrease,
            })}
    <path d="M8 58 C26 32 84 30 102 56" fill="none" stroke="#4a2c8a" stroke-width="6" stroke-linecap="round" />
    <path d="M12 48 L2 40 M24 38 L16 28 M92 40 L100 30" fill="none" stroke="#4a2c8a" stroke-width="4.5" stroke-linecap="round" />`,
            closed: closedEye({ lid: 'M10 58 C30 76 80 76 100 56', color: '#4a2c8a', lashes: true }),
        },
        brow: { box: [185, 214, 100, 40], svg: cartoonBrow({ color: '#c9a8f0', opacity: 0.85 }), lift: 14 },
        mouth: {
            box: [250, 478, 100, 90],
            ...animalMouths(`${id}-mouth`, { color: '#a84470', tongue: ['#ff9ab8', '#e0507e'] }),
        },
    });
});

// ---------------- Lion ----------------
builders.push(() => {
    const id = 'lion';
    const random = rng(523);
    const puffs = (count, rx, ry, min, max) =>
        Array.from({ length: count }, (_, i) => {
            const t = (i / count) * Math.PI * 2 + random() * 0.08;
            const r = min + random() * (max - min);
            return `<circle cx="${fmt(300 + Math.cos(t) * rx)}" cy="${fmt(322 + Math.sin(t) * ry)}" r="${fmt(r)}" />`;
        }).join('');
    const maneOuter = puffs(30, 232, 252, 42, 52);
    const maneInner = puffs(26, 196, 214, 36, 44);
    const head = ellipse(300, 338, 182, 218, 32);
    const muzzle = [ellipse(262, 452, 64, 46), ellipse(338, 452, 64, 46), ellipse(300, 498, 70, 52)];
    const ears = [ellipse(156, 168, 44, 42), ellipse(444, 168, 44, 42)];
    const earInner = [ellipse(158, 172, 24, 22), ellipse(442, 172, 24, 22)];
    const headSvg = `    <defs>
        <radialGradient id="${id}-mane" cx="0.5" cy="0.5" r="0.55">
            <stop offset="0.45" stop-color="#d9731c" />
            <stop offset="1" stop-color="#8a3f0c" />
        </radialGradient>
        <radialGradient id="${id}-mane-in" cx="0.5" cy="0.5" r="0.55">
            <stop offset="0.4" stop-color="#f0922c" />
            <stop offset="1" stop-color="#b9560f" />
        </radialGradient>
        <radialGradient id="${id}-fur" cx="0.5" cy="0.42" r="0.62">
            <stop offset="0" stop-color="#ffd58a" />
            <stop offset="0.7" stop-color="#f0b052" />
            <stop offset="1" stop-color="#cf8a2c" />
        </radialGradient>
        <linearGradient id="${id}-muzzle" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff6e0" />
            <stop offset="1" stop-color="#f0d9a8" />
        </linearGradient>
        <linearGradient id="${id}-nose" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#a0605a" />
            <stop offset="1" stop-color="#5a2e26" />
        </linearGradient>
        ${softFilter(`${id}-soft`, 2.5)}
    </defs>
    <g fill="url(#${id}-mane)" stroke="#4a2008" stroke-width="8">${maneOuter}</g>
    <g fill="url(#${id}-mane)">${maneOuter}</g>
    <ellipse cx="300" cy="322" rx="236" ry="256" fill="url(#${id}-mane)" />
    <g fill="url(#${id}-mane-in)" stroke="#8a3f0c" stroke-width="3" stroke-opacity="0.6">${maneInner}</g>
    <path d="M110 300 C80 380 100 470 150 540 M490 300 C520 380 500 470 450 540" fill="none" stroke="#8a3f0c" stroke-opacity="0.45" stroke-width="4" stroke-linecap="round" />
    ${ears.map((ear) => `<path d="${catmull(ear)}" fill="url(#${id}-fur)" stroke="#a8601c" stroke-width="4" />`).join('\n    ')}
    ${earInner.map((ear) => `<path d="${catmull(ear)}" fill="#e98fa0" fill-opacity="0.8" />`).join('\n    ')}
    <path d="${catmull(head)}" fill="url(#${id}-fur)" />
${shading(`${id}-head`, catmull(head), { rim: 0.28, light: 0.22, rimColor: '#6b3a05' })}
    <path d="${catmull(head)}" fill="none" stroke="#a8601c" stroke-width="5" />
    <path d="M300 130 L300 190 M262 138 L274 190 M338 138 L326 190" fill="none" stroke="#b8701c" stroke-opacity="0.5" stroke-width="6" stroke-linecap="round" />
    <path d="${muzzle.map((m) => catmull(m)).join('')}" fill="url(#${id}-muzzle)" />
    <g fill="#b88a5a" fill-opacity="0.7">
        <circle cx="244" cy="446" r="2.6" /><circle cx="232" cy="458" r="2.6" /><circle cx="248" cy="468" r="2.6" />
        <circle cx="356" cy="446" r="2.6" /><circle cx="368" cy="458" r="2.6" /><circle cx="352" cy="468" r="2.6" />
    </g>
    <ellipse cx="190" cy="430" rx="32" ry="18" fill="#ff8f6a" fill-opacity="0.22" filter="url(#${id}-soft)" />
    <ellipse cx="410" cy="430" rx="32" ry="18" fill="#ff8f6a" fill-opacity="0.22" filter="url(#${id}-soft)" />
    <path d="M300 340 L300 392" fill="none" stroke="#b8701c" stroke-opacity="0.35" stroke-width="22" stroke-linecap="round" filter="url(#${id}-soft)" />
    <path d="M264 394 Q300 378 336 394 Q330 420 300 434 Q270 420 264 394 Z" fill="url(#${id}-nose)" stroke="#3a1c16" stroke-width="2.5" />
    <ellipse cx="288" cy="394" rx="12" ry="5" fill="#ffffff" fill-opacity="0.4" />`;
    characters.push({
        id,
        label: 'Lion',
        order: 220,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: 'M8 58 C22 28 84 26 102 54 C88 86 26 90 8 58 Z',
                center: [55, 57],
                irisRadius: 36,
                iris: ['#fff0a8', '#e0961f', '#7a4408'],
                pupilSize: 0.42,
                outline: '#3a1c08',
            }),
            closed: closedEye({ lid: 'M8 58 C30 76 80 74 102 54', color: '#5a2a0c', lashes: false }),
        },
        brow: { box: [185, 212, 100, 40], svg: cartoonBrow({ color: '#a8601c' }), lift: 14 },
        mouth: {
            box: [250, 431, 100, 90],
            ...animalMouths(`${id}-mouth`, { color: '#4a2410', fangs: true }),
        },
    });
});

// ---------------- Astronaut helmet (the user's face shows through the visor) ----------------
const astronautHelmet = `    <defs>
        <linearGradient id="astronaut-shell" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="0.55" stop-color="#e3e8ef" />
            <stop offset="1" stop-color="#a9b4c4" />
        </linearGradient>
        <linearGradient id="astronaut-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#d7dee8" />
            <stop offset="0.5" stop-color="#8994a6" />
            <stop offset="1" stop-color="#4f5a6c" />
        </linearGradient>
        <linearGradient id="astronaut-glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#cfeaff" stop-opacity="0.28" />
            <stop offset="0.45" stop-color="#ffffff" stop-opacity="0" />
            <stop offset="0.85" stop-color="#ffcf7a" stop-opacity="0.08" />
            <stop offset="1" stop-color="#ffb347" stop-opacity="0.22" />
        </linearGradient>
        <radialGradient id="astronaut-ao" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.86" stop-color="#000000" stop-opacity="0" />
            <stop offset="1" stop-color="#000000" stop-opacity="0.35" />
        </radialGradient>
        <radialGradient id="astronaut-lamp" cx="0.4" cy="0.35" r="0.65">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="0.6" stop-color="#ffe08a" />
            <stop offset="1" stop-color="#c9a227" />
        </radialGradient>
        ${softFilter('astronaut-soft', 4)}
    </defs>
    <path fill="#c3ccd8" stroke="#8994a6" stroke-width="4" d="M104 556 Q300 516 496 556 L524 640 L76 640 Z" />
    <path d="M110 586 H490" stroke="#8994a6" stroke-width="4" stroke-opacity="0.6" />
    <path fill="url(#astronaut-shell)" stroke="#8994a6" stroke-width="5" fill-rule="evenodd" d="M300 20 C472 20 592 150 592 318 C592 472 472 592 300 592 C128 592 8 472 8 318 C8 150 128 20 300 20 Z M300 112 C406 112 488 194 488 312 C488 438 406 524 300 524 C194 524 112 438 112 312 C112 194 194 112 300 112 Z" />
    <path d="M300 20 C472 20 592 150 592 318 C592 472 472 592 300 592 C128 592 8 472 8 318 C8 150 128 20 300 20 Z" fill="url(#astronaut-ao)" />
    <path d="M70 230 C100 110 210 40 330 36" fill="none" stroke="#ffffff" stroke-width="16" stroke-linecap="round" stroke-opacity="0.65" filter="url(#astronaut-soft)" />
    <path d="M300 112 C406 112 488 194 488 312 C488 438 406 524 300 524 C194 524 112 438 112 312 C112 194 194 112 300 112 Z" fill="none" stroke="url(#astronaut-ring)" stroke-width="18" />
    <path d="M300 112 C406 112 488 194 488 312 C488 438 406 524 300 524 C194 524 112 438 112 312 C112 194 194 112 300 112 Z" fill="url(#astronaut-glass)" />
    <path d="M162 232 C186 168 238 138 300 132" fill="none" stroke="#ffffff" stroke-width="13" stroke-linecap="round" stroke-opacity="0.55" />
    <path d="M144 300 C144 286 146 272 150 260" fill="none" stroke="#ffffff" stroke-width="9" stroke-linecap="round" stroke-opacity="0.45" />
    <path d="M430 420 C412 452 384 476 352 490" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-opacity="0.25" />
    <g fill="#8994a6">
        <circle cx="300" cy="102" r="5" /><circle cx="300" cy="534" r="5" /><circle cx="102" cy="314" r="5" /><circle cx="498" cy="314" r="5" />
    </g>
    <rect x="16" y="252" width="44" height="110" rx="16" fill="url(#astronaut-ring)" stroke="#5f6b80" stroke-width="3" />
    <rect x="540" y="252" width="44" height="110" rx="16" fill="url(#astronaut-ring)" stroke="#5f6b80" stroke-width="3" />
    <circle cx="38" cy="276" r="9" fill="url(#astronaut-lamp)" />
    <circle cx="562" cy="276" r="9" fill="url(#astronaut-lamp)" />
    <rect x="270" y="44" width="60" height="22" rx="8" fill="url(#astronaut-ring)" />
    <circle cx="300" cy="55" r="7" fill="url(#astronaut-lamp)" />
    <g transform="translate(458 520)">
        <circle r="28" fill="#1e3a8a" stroke="#ffffff" stroke-width="4" />
        <path d="M-22 6 Q0 -10 22 6" fill="none" stroke="#e53935" stroke-width="4" stroke-linecap="round" />
        <path d="M0 -15 L4 -5 L14 -5 L6 2 L9 12 L0 6 L-9 12 L-6 2 L-14 -5 L-4 -5 Z" fill="#ffffff" />
    </g>`;

const astronautThumbFace = `    <defs>
        <radialGradient id="astronaut-thumb-skin" cx="0.45" cy="0.4" r="0.65">
            <stop offset="0" stop-color="#f2c9a5" />
            <stop offset="1" stop-color="#c58d68" />
        </radialGradient>
    </defs>
    <ellipse cx="300" cy="330" rx="150" ry="182" fill="url(#astronaut-thumb-skin)" />
    <path d="M150 300 C150 170 230 140 300 140 C370 140 450 170 450 300 C430 220 380 190 300 190 C220 190 170 220 150 300 Z" fill="#3a2414" />
    <ellipse cx="248" cy="306" rx="14" ry="10" fill="#2b1d16" />
    <ellipse cx="352" cy="306" rx="14" ry="10" fill="#2b1d16" />
    <path d="M226 284 Q248 272 270 282 M330 282 Q352 272 374 284" fill="none" stroke="#3a2414" stroke-width="6" stroke-linecap="round" />
    <path d="M300 320 Q292 360 300 372" fill="none" stroke="#a8704e" stroke-width="5" stroke-linecap="round" />
    <path d="M252 410 Q300 446 348 410" fill="none" stroke="#8a3a33" stroke-width="10" stroke-linecap="round" />`;

// ---------------- Dog (golden floppy-eared) ----------------
builders.push(() => {
    const id = 'dog';
    const head = ellipse(300, 330, 208, 252, 32);
    const muzzle = ellipse(300, 462, 122, 94, 28);
    const d = catmull(head);
    const ear =
        'M150 124 C70 108 22 200 30 330 C36 414 72 474 124 472 C166 462 182 384 176 300 C172 232 176 172 198 134 Z';
    const headSvg = `    <defs>
        <radialGradient id="${id}-fur" cx="0.5" cy="0.38" r="0.66">
            <stop offset="0" stop-color="#f0b868" />
            <stop offset="0.7" stop-color="#d48c3c" />
            <stop offset="1" stop-color="#a8651e" />
        </radialGradient>
        <linearGradient id="${id}-ear" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#9a5e28" />
            <stop offset="1" stop-color="#5e3412" />
        </linearGradient>
        <radialGradient id="${id}-muzzle" cx="0.5" cy="0.35" r="0.65">
            <stop offset="0" stop-color="#fff3dc" />
            <stop offset="1" stop-color="#e9c994" />
        </radialGradient>
        <radialGradient id="${id}-nose" cx="0.4" cy="0.3" r="0.75">
            <stop offset="0" stop-color="#4a3a32" />
            <stop offset="1" stop-color="#0a0605" />
        </radialGradient>
        ${softFilter(`${id}-soft`, 3)}
        ${softFilter(`${id}-blur`, 1.4)}
    </defs>
    <path d="${ear}" fill="url(#${id}-ear)" stroke="#3e200a" stroke-width="5" stroke-linejoin="round" />
    <path d="${ear}" fill="url(#${id}-ear)" stroke="#3e200a" stroke-width="5" stroke-linejoin="round" transform="translate(600 0) scale(-1 1)" />
    <path d="M70 200 C52 280 60 380 96 440 M530 200 C548 280 540 380 504 440" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="10" stroke-linecap="round" filter="url(#${id}-blur)" />
    <path d="${d}" fill="url(#${id}-fur)" />
${shading(`${id}-head`, d, { rim: 0.34, light: 0.22, rimColor: '#4a2404' })}
    <path d="${d}" fill="none" stroke="#6a3a10" stroke-width="5" stroke-linejoin="round" />
    <path d="M300 88 C346 126 350 260 338 352 L262 352 C250 260 254 126 300 88 Z" fill="#fff3dc" fill-opacity="0.85" filter="url(#${id}-soft)" />
    <path d="M232 264 Q206 286 196 318 M368 264 Q394 286 404 318" fill="none" stroke="#6a3a10" stroke-width="5" stroke-opacity="0.3" stroke-linecap="round" filter="url(#${id}-blur)" />
    <path d="${catmull(muzzle)}" fill="url(#${id}-muzzle)" stroke="#c9a06a" stroke-width="3" />
    <ellipse cx="184" cy="426" rx="30" ry="16" fill="#ff8f8f" fill-opacity="0.22" filter="url(#${id}-soft)" />
    <ellipse cx="416" cy="426" rx="30" ry="16" fill="#ff8f8f" fill-opacity="0.22" filter="url(#${id}-soft)" />
    <path d="M256 396 C256 372 344 372 344 396 C344 424 322 440 300 442 C278 440 256 424 256 396 Z" fill="url(#${id}-nose)" />
    <ellipse cx="282" cy="388" rx="16" ry="7" fill="#ffffff" fill-opacity="0.5" />
    <g fill="#8a5a2a" fill-opacity="0.55">
        <circle cx="236" cy="452" r="3.5" /><circle cx="250" cy="468" r="3.5" /><circle cx="232" cy="474" r="3.5" />
        <circle cx="364" cy="452" r="3.5" /><circle cx="350" cy="468" r="3.5" /><circle cx="368" cy="474" r="3.5" />
    </g>`;
    characters.push({
        id,
        label: 'Dog',
        order: 230,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: 'M28 55 a27 27 0 1 0 54 0 a27 27 0 1 0 -54 0 Z',
                center: [55, 55],
                irisRadius: 26,
                iris: ['#b87a3c', '#5a3214', '#1c0e04'],
                pupilSize: 0.55,
                outline: '#1c0e04',
            }),
            closed: closedEye({ lid: 'M28 54 Q55 74 82 54', color: '#2a1608', lashes: false }),
        },
        brow: { box: [185, 214, 100, 40], svg: cartoonBrow({ color: '#6a3a10' }), lift: 14 },
        mouth: { box: [250, 436, 100, 90], ...animalMouths(`${id}-mouth`, { color: '#2a1608' }) },
    });
});

// ---------------- Santa Claus ----------------
builders.push(() => {
    const id = 'santa';
    const { back, face } = humanFace(id, {
        skin: ['#ffd9c0', '#f4b394', '#d98a6c'],
        skinDark: '#8a3f2a',
        outline: '#a8583f',
        blush: '#ff5f5f',
    });
    const beard = `M118 300 C128 380 170 428 250 452 Q300 462 350 452 C430 428 472 380 482 300 C502 400 500 500 440 560 C400 608 350 636 300 636 C250 636 200 608 160 560 C100 500 98 400 118 300 Z`;
    const mustache = 'M300 432 C268 410 220 416 184 450 C166 470 178 496 204 488 C230 480 264 472 300 470 Z';
    const sideHair = 'M114 180 C94 256 96 318 122 346 C136 334 144 300 148 250 L156 184 Z';
    const trim =
        'M92 172 C92 120 150 90 300 90 C450 90 508 120 508 172 C508 208 472 216 440 202 C380 218 220 218 160 202 C128 216 92 208 92 172 Z';
    const hatBody =
        'M108 176 C102 70 200 12 300 12 C396 12 462 54 500 116 C524 156 540 204 536 242 C516 250 498 246 486 236 C484 210 470 180 440 164 Z';
    const hatBack = `    <defs>
        <linearGradient id="${id}-hat" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#ff5a52" />
            <stop offset="0.6" stop-color="#d9202c" />
            <stop offset="1" stop-color="#8f0f1c" />
        </linearGradient>
        <linearGradient id="${id}-fur" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="1" stop-color="#dfe6f1" />
        </linearGradient>
        <radialGradient id="${id}-pom" cx="0.4" cy="0.35" r="0.7">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="1" stop-color="#d4dcea" />
        </radialGradient>
    </defs>`;
    const whiteStrokeColor = '#aab4c6';
    const beardSvg = `    <path d="${sideHair}" fill="url(#${id}-fur)" stroke="${whiteStrokeColor}" stroke-width="4" stroke-linejoin="round" />
    <path d="${sideHair}" fill="url(#${id}-fur)" stroke="${whiteStrokeColor}" stroke-width="4" stroke-linejoin="round" transform="translate(600 0) scale(-1 1)" />
    <path d="${beard}" fill="url(#${id}-fur)" stroke="${whiteStrokeColor}" stroke-width="5" stroke-linejoin="round" />
    <g fill="none" stroke="${whiteStrokeColor}" stroke-width="3.5" stroke-linecap="round" stroke-opacity="0.8">
        <path d="M168 440 Q140 500 176 540 Q196 560 214 574" />
        <path d="M432 440 Q460 500 424 540 Q404 560 386 574" />
        <path d="M300 540 Q276 566 300 600 Q324 566 300 540 Z" />
        <path d="M236 520 Q222 552 246 584 M364 520 Q378 552 354 584" />
    </g>
    <ellipse cx="300" cy="392" rx="26" ry="18" fill="#ff5f5f" fill-opacity="0.28" filter="url(#${id}-soft)" />
    <path d="${mustache}" fill="url(#${id}-fur)" stroke="${whiteStrokeColor}" stroke-width="5" stroke-linejoin="round" />
    <path d="${mustache}" fill="url(#${id}-fur)" stroke="${whiteStrokeColor}" stroke-width="5" stroke-linejoin="round" transform="translate(600 0) scale(-1 1)" />
    <path d="M276 438 Q232 440 198 468 M324 438 Q368 440 402 468" fill="none" stroke="${whiteStrokeColor}" stroke-opacity="0.7" stroke-width="3" stroke-linecap="round" />`;
    const hatSvg = `    <path d="${hatBody}" fill="url(#${id}-hat)" stroke="#6e0a14" stroke-width="5" stroke-linejoin="round" />
    <path d="M168 110 C200 56 270 36 340 40" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="12" stroke-linecap="round" filter="url(#${id}-blur)" />
    <circle cx="512" cy="258" r="32" fill="url(#${id}-pom)" stroke="${whiteStrokeColor}" stroke-width="5" />
    <path d="${trim}" fill="url(#${id}-fur)" stroke="${whiteStrokeColor}" stroke-width="5" stroke-linejoin="round" />
    <path d="M150 150 Q300 130 450 150" fill="none" stroke="${whiteStrokeColor}" stroke-opacity="0.45" stroke-width="4" stroke-linecap="round" />`;
    characters.push({
        id,
        label: 'Santa Claus',
        order: 400,
        head: `${back}\n${hatBack}\n${face}\n${beardSvg}\n${hatSvg}`,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: humanEyeShape,
                center: [55, 57],
                irisRadius: 22,
                iris: ['#8fc4ff', '#3f7fd0', '#1d3f7a'],
                sclera: '#fffaf4',
                outline: '#3a2010',
                crease: humanCrease,
            }),
            closed: closedEye({
                lid: 'M10 58 C30 76 80 76 100 56',
                color: '#6a3a24',
                lashes: false,
                crease: humanCrease,
            }),
        },
        brow: {
            box: [185, 214, 100, 44],
            svg: `    <path d="M4 36 Q40 0 96 18 Q100 30 92 34 Q46 16 14 42 Z" fill="#ffffff" stroke="${whiteStrokeColor}" stroke-width="3" stroke-linejoin="round" />`,
            lift: 14,
        },
        mouth: { box: [235, 456, 130, 80], ...humanMouths(`${id}-mouth`, { lip: '#d9786a', lipDark: '#8a3f36' }) },
    });
});

// ####################################################
// SEASONAL CHARACTERS AND MORE ANIMALS
// ####################################################

// The same element drawn again mirrored around the centre line
const mirrored = (element) => `${element}\n    <g transform="translate(600 0) scale(-1 1)">${element}</g>`;

const ROUND_EYE = 'M28 55 a27 27 0 1 0 54 0 a27 27 0 1 0 -54 0 Z';

// ---------------- Reindeer ----------------
builders.push(() => {
    const id = 'reindeer';
    const d = catmull(ellipse(300, 346, 196, 240, 32));
    const muzzle = catmull(ellipse(300, 462, 112, 82, 28));
    const antler = (
        stroke,
        width
    ) => `<g fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">
        <path d="M226 130 C196 96 184 56 192 14" />
        <path d="M205 96 C178 90 156 70 144 40" />
        <path d="M193 58 C214 46 224 30 224 12" />
        <path d="M212 112 C240 100 258 78 262 52" />
    </g>`;
    const ear = 'M118 262 C70 214 24 220 8 252 C30 296 84 298 122 284 Z';
    const earInner = 'M104 262 C72 238 44 240 32 254 C50 276 82 278 108 270 Z';
    const headSvg = `    <defs>
        <radialGradient id="${id}-fur" cx="0.5" cy="0.38" r="0.66">
            <stop offset="0" stop-color="#b9824f" />
            <stop offset="0.7" stop-color="#8f5a30" />
            <stop offset="1" stop-color="#683d1c" />
        </radialGradient>
        <radialGradient id="${id}-muzzle" cx="0.5" cy="0.35" r="0.65">
            <stop offset="0" stop-color="#f6e3c4" />
            <stop offset="1" stop-color="#d7b184" />
        </radialGradient>
        <radialGradient id="${id}-nose" cx="0.36" cy="0.3" r="0.8">
            <stop offset="0" stop-color="#ff7a7a" />
            <stop offset="0.55" stop-color="#e5232d" />
            <stop offset="1" stop-color="#a30f1c" />
        </radialGradient>
        ${softFilter(`${id}-soft`, 3)}
    </defs>
    ${mirrored(antler('#6a4420', 28))}
    ${mirrored(antler('#e1bf8c', 15))}
    ${mirrored(`<path d="${ear}" fill="url(#${id}-fur)" stroke="#4a2a10" stroke-width="5" stroke-linejoin="round" />`)}
    ${mirrored(`<path d="${earInner}" fill="#e8a39a" />`)}
    <path d="${d}" fill="url(#${id}-fur)" />
${shading(`${id}-head`, d, { rim: 0.36, light: 0.22, rimColor: '#2a1204' })}
    <path d="${d}" fill="none" stroke="#4a2a10" stroke-width="5" stroke-linejoin="round" />
    <path d="${muzzle}" fill="url(#${id}-muzzle)" stroke="#b58c5c" stroke-width="3" />
    <ellipse cx="180" cy="424" rx="30" ry="16" fill="#ff8f8f" fill-opacity="0.22" filter="url(#${id}-soft)" />
    <ellipse cx="420" cy="424" rx="30" ry="16" fill="#ff8f8f" fill-opacity="0.22" filter="url(#${id}-soft)" />
    <circle cx="300" cy="430" r="46" fill="#ff3b3b" fill-opacity="0.3" filter="url(#${id}-soft)" />
    <circle cx="300" cy="430" r="38" fill="url(#${id}-nose)" stroke="#7a0c18" stroke-width="3" />
    <ellipse cx="287" cy="416" rx="13" ry="8" fill="#ffffff" fill-opacity="0.65" transform="rotate(-24 287 416)" />`;
    characters.push({
        id,
        label: 'Reindeer',
        order: 320,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: ROUND_EYE,
                center: [55, 55],
                irisRadius: 26,
                iris: ['#9a6a3a', '#4a2810', '#160a02'],
                pupilSize: 0.55,
                outline: '#160a02',
            }),
            closed: closedEye({ lid: 'M28 54 Q55 74 82 54', color: '#2a1608', lashes: false }),
        },
        brow: { box: [185, 214, 100, 40], svg: cartoonBrow({ color: '#4a2a10' }), lift: 14 },
        mouth: { box: [250, 466, 100, 90], ...animalMouths(`${id}-mouth`, { color: '#3a2008' }) },
    });
});

// ---------------- Snowman ----------------
builders.push(() => {
    const id = 'snowman';
    const d = catmull(ellipse(300, 360, 224, 232, 32));
    const headSvg = `    <defs>
        <radialGradient id="${id}-snow" cx="0.42" cy="0.34" r="0.7">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="0.7" stop-color="#eaf3fb" />
            <stop offset="1" stop-color="#b7cbe0" />
        </radialGradient>
        <linearGradient id="${id}-carrot" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ffb54a" />
            <stop offset="1" stop-color="#e2641a" />
        </linearGradient>
        <linearGradient id="${id}-scarf" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#e8323c" />
            <stop offset="1" stop-color="#b3141f" />
        </linearGradient>
        <linearGradient id="${id}-hat" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#3a3a46" />
            <stop offset="0.45" stop-color="#1c1c24" />
            <stop offset="1" stop-color="#0a0a10" />
        </linearGradient>
        ${softFilter(`${id}-soft`, 3)}
    </defs>
    <path d="${d}" fill="url(#${id}-snow)" />
${shading(`${id}-head`, d, { rim: 0.3, light: 0.3, rimColor: '#4a6a8a' })}
    <path d="${d}" fill="none" stroke="#8aa3bd" stroke-width="5" stroke-linejoin="round" />
    <ellipse cx="170" cy="430" rx="34" ry="18" fill="#ff8f8f" fill-opacity="0.35" filter="url(#${id}-soft)" />
    <ellipse cx="430" cy="430" rx="34" ry="18" fill="#ff8f8f" fill-opacity="0.35" filter="url(#${id}-soft)" />
    <path d="M300 358 C334 360 372 380 440 404 C372 420 334 432 300 430 C278 420 272 372 300 358 Z" fill="url(#${id}-carrot)" stroke="#a8480c" stroke-width="4" stroke-linejoin="round" />
    <path d="M318 372 L326 398 M346 384 L352 408 M376 392 L380 410" fill="none" stroke="#a8480c" stroke-opacity="0.6" stroke-width="3" stroke-linecap="round" />
    <path d="M308 372 C330 372 358 386 400 400" fill="none" stroke="#ffffff" stroke-opacity="0.45" stroke-width="5" stroke-linecap="round" />
    <path d="M118 534 C200 576 400 576 482 534 L498 584 C410 628 190 628 102 584 Z" fill="url(#${id}-scarf)" stroke="#6e0a14" stroke-width="5" stroke-linejoin="round" />
    <path d="M396 596 L430 636 L492 626 L470 574 Z" fill="url(#${id}-scarf)" stroke="#6e0a14" stroke-width="5" stroke-linejoin="round" />
    <path d="M150 556 L158 600 M214 574 L220 618 M290 580 L292 626 M366 574 L362 618 M436 556 L430 600" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="5" stroke-linecap="round" />
    <ellipse cx="300" cy="150" rx="176" ry="34" fill="url(#${id}-hat)" stroke="#000000" stroke-width="5" />
    <path d="M214 150 L224 30 Q300 6 376 30 L386 150 Q300 174 214 150 Z" fill="url(#${id}-hat)" stroke="#000000" stroke-width="5" stroke-linejoin="round" />
    <path d="M216 120 Q300 148 384 120 L386 150 Q300 174 214 150 Z" fill="#d9202c" stroke="#6e0a14" stroke-width="4" stroke-linejoin="round" />
    <ellipse cx="300" cy="32" rx="76" ry="14" fill="#2c2c36" stroke="#000000" stroke-width="4" />
    <path d="M240 60 L244 118" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="8" stroke-linecap="round" />`;
    characters.push({
        id,
        label: 'Snowman',
        order: 410,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: ROUND_EYE,
                center: [55, 55],
                irisRadius: 27,
                iris: ['#4a4a52', '#1c1c22', '#050507'],
                pupilSize: 0.01,
                outline: '#050507',
            }),
            closed: closedEye({ lid: 'M28 54 Q55 72 82 54', color: '#1c1c22', lashes: false, width: 6 }),
        },
        brow: { box: [185, 214, 100, 40], svg: cartoonBrow({ color: '#4a3a2a', opacity: 0.9 }), lift: 14 },
        mouth: { box: [250, 436, 100, 90], ...animalMouths(`${id}-mouth`, { color: '#2a2a32' }) },
    });
});

// ---------------- Pumpkin ----------------
builders.push(() => {
    const id = 'pumpkin';
    const lobe = (cx, rx) => catmull(ellipse(cx, 356, rx, 236, 32));
    const outline = '#8a3a06';
    const headSvg = `    <defs>
        <radialGradient id="${id}-skin" cx="0.5" cy="0.38" r="0.7">
            <stop offset="0" stop-color="#ffb347" />
            <stop offset="0.7" stop-color="#f08a1c" />
            <stop offset="1" stop-color="#c25a08" />
        </radialGradient>
        <linearGradient id="${id}-stem" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#8a9a3a" />
            <stop offset="1" stop-color="#4a5a1c" />
        </linearGradient>
        ${softFilter(`${id}-soft`, 3)}
    </defs>
    <path d="M276 134 C268 88 280 44 310 18 L356 34 C336 62 330 98 342 134 Z" fill="url(#${id}-stem)" stroke="#2e3a0e" stroke-width="5" stroke-linejoin="round" />
    <path d="M344 56 C388 34 440 56 422 98 C410 124 380 112 392 92" fill="none" stroke="#4a7a1c" stroke-width="7" stroke-linecap="round" />
    <path d="M404 84 C440 56 490 70 484 108 C450 118 420 108 404 84 Z" fill="#5a9a22" stroke="#2e5a0c" stroke-width="4" stroke-linejoin="round" />
    ${[lobe(132, 118), lobe(468, 118), lobe(214, 128), lobe(386, 128), lobe(300, 128)]
        .map(
            (lobePath) =>
                `<path d="${lobePath}" fill="url(#${id}-skin)" stroke="${outline}" stroke-width="5" stroke-linejoin="round" />`
        )
        .join('\n    ')}
${shading(`${id}-head`, lobe(300, 128), { rim: 0.2, light: 0.28, rimColor: '#6a2a02' })}
    <path d="M214 130 C170 230 170 480 214 584 M386 130 C430 230 430 480 386 584 M300 120 C260 230 260 480 300 592 M300 120 C340 230 340 480 300 592" fill="none" stroke="${outline}" stroke-opacity="0.3" stroke-width="6" stroke-linecap="round" />
    <ellipse cx="170" cy="430" rx="34" ry="18" fill="#ff6a4a" fill-opacity="0.3" filter="url(#${id}-soft)" />
    <ellipse cx="430" cy="430" rx="34" ry="18" fill="#ff6a4a" fill-opacity="0.3" filter="url(#${id}-soft)" />
    <path d="M276 392 L324 392 L300 424 Z" fill="#7a3004" stroke="#4a1c02" stroke-width="3" stroke-linejoin="round" />`;
    characters.push({
        id,
        label: 'Pumpkin',
        order: 420,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: ROUND_EYE,
                center: [55, 55],
                irisRadius: 26,
                iris: ['#8a5a2a', '#3a1c08', '#120802'],
                sclera: '#fffaf0',
                pupilSize: 0.5,
                outline: '#3a1c08',
            }),
            closed: closedEye({ lid: 'M28 54 Q55 74 82 54', color: '#4a1c02', lashes: false }),
        },
        brow: { box: [185, 214, 100, 40], svg: cartoonBrow({ color: '#6a2a02' }), lift: 14 },
        mouth: { box: [250, 428, 100, 90], ...animalMouths(`${id}-mouth`, { color: '#3a1602' }) },
    });
});

// ---------------- Rabbit ----------------
builders.push(() => {
    const id = 'rabbit';
    const d = catmull(ellipse(300, 358, 206, 230, 32));
    const muzzle = catmull(ellipse(300, 456, 96, 70, 28));
    const ear = 'M178 214 C126 140 122 50 158 10 C202 2 256 76 270 190 Z';
    const earInner = 'M188 186 C158 130 156 70 172 36 C198 42 234 98 248 170 Z';
    const headSvg = `    <defs>
        <radialGradient id="${id}-fur" cx="0.5" cy="0.38" r="0.68">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="0.7" stop-color="#f1e8dc" />
            <stop offset="1" stop-color="#cdbfae" />
        </radialGradient>
        ${softFilter(`${id}-soft`, 3)}
    </defs>
    ${mirrored(`<path d="${ear}" fill="url(#${id}-fur)" stroke="#9a8672" stroke-width="5" stroke-linejoin="round" />`)}
    ${mirrored(`<path d="${earInner}" fill="#f6a9b8" />`)}
    <path d="${d}" fill="url(#${id}-fur)" />
${shading(`${id}-head`, d, { rim: 0.28, light: 0.2, rimColor: '#6a5640' })}
    <path d="${d}" fill="none" stroke="#9a8672" stroke-width="5" stroke-linejoin="round" />
    <ellipse cx="180" cy="430" rx="34" ry="18" fill="#ff8fa8" fill-opacity="0.4" filter="url(#${id}-soft)" />
    <ellipse cx="420" cy="430" rx="34" ry="18" fill="#ff8fa8" fill-opacity="0.4" filter="url(#${id}-soft)" />
    <path d="${muzzle}" fill="#fffdf8" stroke="#d9cbb8" stroke-width="3" />
    <path d="M283 484 L299 484 L299 518 Q291 524 283 518 Z M301 484 L317 484 L317 518 Q309 524 301 518 Z" fill="#fffdf6" stroke="#9a8672" stroke-width="3" stroke-linejoin="round" />
    <path d="M276 406 Q300 394 324 406 Q318 428 300 434 Q282 428 276 406 Z" fill="#f27a94" stroke="#b04860" stroke-width="3" stroke-linejoin="round" />
    <ellipse cx="290" cy="402" rx="8" ry="4" fill="#ffffff" fill-opacity="0.6" />
    <path d="M232 450 L150 438 M232 464 L146 468 M368 450 L450 438 M368 464 L454 468" fill="none" stroke="#9a8672" stroke-opacity="0.55" stroke-width="3" stroke-linecap="round" />`;
    characters.push({
        id,
        label: 'Rabbit',
        order: 280,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: ROUND_EYE,
                center: [55, 55],
                irisRadius: 26,
                iris: ['#c47a8a', '#6a2a3a', '#1c0810'],
                pupilSize: 0.55,
                outline: '#1c0810',
            }),
            closed: closedEye({ lid: 'M28 54 Q55 74 82 54', color: '#4a2a34', lashes: false }),
        },
        brow: { box: [185, 214, 100, 40], svg: cartoonBrow({ color: '#9a8672' }), lift: 14 },
        mouth: { box: [250, 432, 100, 90], ...animalMouths(`${id}-mouth`, { color: '#7a3a4a' }) },
    });
});

// ---------------- Pig ----------------
builders.push(() => {
    const id = 'pig';
    const d = catmull(ellipse(300, 322, 216, 258, 32));
    const snout = catmull(ellipse(300, 428, 104, 74, 28));
    const ear = 'M128 170 C64 126 50 56 82 22 C150 30 216 66 246 120 Z';
    const earInner = 'M126 148 C92 120 84 82 98 56 C140 66 184 90 206 120 Z';
    const headSvg = `    <defs>
        <radialGradient id="${id}-skin" cx="0.5" cy="0.38" r="0.68">
            <stop offset="0" stop-color="#ffc0cc" />
            <stop offset="0.7" stop-color="#f79db0" />
            <stop offset="1" stop-color="#d9708a" />
        </radialGradient>
        <radialGradient id="${id}-snout" cx="0.5" cy="0.35" r="0.7">
            <stop offset="0" stop-color="#ffd0da" />
            <stop offset="1" stop-color="#f48aa2" />
        </radialGradient>
        ${softFilter(`${id}-soft`, 3)}
    </defs>
    ${mirrored(`<path d="${ear}" fill="url(#${id}-skin)" stroke="#a8486a" stroke-width="5" stroke-linejoin="round" />`)}
    ${mirrored(`<path d="${earInner}" fill="#ee7f9a" />`)}
    <path d="${d}" fill="url(#${id}-skin)" />
${shading(`${id}-head`, d, { rim: 0.3, light: 0.26, rimColor: '#8a2a4a' })}
    <path d="${d}" fill="none" stroke="#a8486a" stroke-width="5" stroke-linejoin="round" />
    <ellipse cx="170" cy="400" rx="34" ry="20" fill="#ff5f84" fill-opacity="0.3" filter="url(#${id}-soft)" />
    <ellipse cx="430" cy="400" rx="34" ry="20" fill="#ff5f84" fill-opacity="0.3" filter="url(#${id}-soft)" />
    <path d="${snout}" fill="url(#${id}-snout)" stroke="#a8486a" stroke-width="4" />
    <ellipse cx="266" cy="428" rx="17" ry="25" fill="#9a3a5a" transform="rotate(10 266 428)" />
    <ellipse cx="334" cy="428" rx="17" ry="25" fill="#9a3a5a" transform="rotate(-10 334 428)" />
    <ellipse cx="262" cy="418" rx="5" ry="9" fill="#ffffff" fill-opacity="0.35" />
    <ellipse cx="330" cy="418" rx="5" ry="9" fill="#ffffff" fill-opacity="0.35" />
    <ellipse cx="288" cy="376" rx="22" ry="7" fill="#ffffff" fill-opacity="0.35" />`;
    characters.push({
        id,
        label: 'Pig',
        order: 290,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: ROUND_EYE,
                center: [55, 55],
                irisRadius: 25,
                iris: ['#7a4a4a', '#3a1c22', '#14070a'],
                pupilSize: 0.55,
                outline: '#14070a',
            }),
            closed: closedEye({ lid: 'M28 54 Q55 74 82 54', color: '#4a1c2c', lashes: false }),
        },
        brow: { box: [185, 214, 100, 40], svg: cartoonBrow({ color: '#a8486a' }), lift: 14 },
        mouth: { box: [250, 494, 100, 90], ...animalMouths(`${id}-mouth`, { color: '#7a2a44' }) },
    });
});

// ---------------- Penguin ----------------
builders.push(() => {
    const id = 'penguin';
    const d = catmull(ellipse(300, 336, 220, 250, 32));
    const face = [
        [300, 188], [372, 214], [454, 268], [474, 348], [452, 440], [394, 516], [300, 548], [206, 516],
        [148, 440], [126, 348], [146, 268], [228, 214],
    ]; // prettier-ignore
    const headSvg = `    <defs>
        <radialGradient id="${id}-black" cx="0.5" cy="0.35" r="0.7">
            <stop offset="0" stop-color="#4a5062" />
            <stop offset="0.7" stop-color="#262a36" />
            <stop offset="1" stop-color="#0e1016" />
        </radialGradient>
        <radialGradient id="${id}-white" cx="0.5" cy="0.4" r="0.7">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="1" stop-color="#dfe6ee" />
        </radialGradient>
        <linearGradient id="${id}-beak" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ffc247" />
            <stop offset="1" stop-color="#ee8a14" />
        </linearGradient>
        ${softFilter(`${id}-soft`, 3)}
    </defs>
    <path d="${d}" fill="url(#${id}-black)" />
${shading(`${id}-head`, d, { rim: 0.4, light: 0.2, rimColor: '#000000' })}
    <path d="${d}" fill="none" stroke="#06070a" stroke-width="5" stroke-linejoin="round" />
    <path d="${catmull(face)}" fill="url(#${id}-white)" stroke="#c4cdd8" stroke-width="3" />
    <ellipse cx="170" cy="418" rx="40" ry="22" fill="#ffb04a" fill-opacity="0.55" filter="url(#${id}-soft)" />
    <ellipse cx="430" cy="418" rx="40" ry="22" fill="#ffb04a" fill-opacity="0.55" filter="url(#${id}-soft)" />
    <path d="M244 386 Q300 358 356 386 Q338 432 300 442 Q262 432 244 386 Z" fill="url(#${id}-beak)" stroke="#a8560a" stroke-width="4" stroke-linejoin="round" />
    <path d="M250 392 Q300 408 350 392" fill="none" stroke="#a8560a" stroke-opacity="0.6" stroke-width="3" stroke-linecap="round" />
    <ellipse cx="282" cy="378" rx="22" ry="7" fill="#ffffff" fill-opacity="0.55" />`;
    characters.push({
        id,
        label: 'Penguin',
        order: 300,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: ROUND_EYE,
                center: [55, 55],
                irisRadius: 26,
                iris: ['#6a6a78', '#22222c', '#050508'],
                pupilSize: 0.5,
                outline: '#050508',
            }),
            closed: closedEye({ lid: 'M28 54 Q55 74 82 54', color: '#1c1c26', lashes: false }),
        },
        brow: { box: [185, 214, 100, 40], svg: cartoonBrow({ color: '#2a2e3a' }), lift: 14 },
        mouth: { box: [250, 440, 100, 90], ...animalMouths(`${id}-mouth`, { color: '#8a3c08' }) },
    });
});

// ---------------- Owl ----------------
builders.push(() => {
    const id = 'owl';
    const d = catmull(ellipse(300, 346, 226, 246, 32));
    const tuft = 'M132 170 C112 110 106 66 112 30 C160 50 214 86 244 130 Z';
    const disc = (cx) => catmull(ellipse(cx, 304, 100, 96, 28));
    const feathers = [];
    const random = rng(53);
    for (let i = 0; i < 40; i++) {
        const x = 130 + random() * 340;
        const y = 120 + random() * 260;
        feathers.push(`M${fmt(x)} ${fmt(y)}q7 9 14 0`);
    }
    const headSvg = `    <defs>
        <radialGradient id="${id}-fur" cx="0.5" cy="0.38" r="0.68">
            <stop offset="0" stop-color="#b8895a" />
            <stop offset="0.7" stop-color="#8a5c34" />
            <stop offset="1" stop-color="#5e3a1c" />
        </radialGradient>
        <radialGradient id="${id}-disc" cx="0.5" cy="0.45" r="0.6">
            <stop offset="0" stop-color="#fff3d8" />
            <stop offset="1" stop-color="#ebcf9e" />
        </radialGradient>
        <linearGradient id="${id}-beak" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ffd05a" />
            <stop offset="1" stop-color="#e8921c" />
        </linearGradient>
        ${softFilter(`${id}-soft`, 3)}
    </defs>
    ${mirrored(`<path d="${tuft}" fill="url(#${id}-fur)" stroke="#3e2410" stroke-width="5" stroke-linejoin="round" />`)}
    <path d="${d}" fill="url(#${id}-fur)" />
${shading(`${id}-head`, d, { rim: 0.38, light: 0.2, rimColor: '#2a1404' })}
    <path d="${d}" fill="none" stroke="#3e2410" stroke-width="5" stroke-linejoin="round" />
    <path d="${feathers.join('')}" fill="none" stroke="#3e2410" stroke-opacity="0.4" stroke-width="3" stroke-linecap="round" />
    <path d="${catmull(ellipse(300, 496, 118, 62, 28))}" fill="url(#${id}-disc)" fill-opacity="0.9" />
    <path d="${disc(222)}" fill="url(#${id}-disc)" stroke="#a87a44" stroke-width="5" />
    <path d="${disc(378)}" fill="url(#${id}-disc)" stroke="#a87a44" stroke-width="5" />
    <ellipse cx="170" cy="404" rx="30" ry="16" fill="#e0805a" fill-opacity="0.25" filter="url(#${id}-soft)" />
    <ellipse cx="430" cy="404" rx="30" ry="16" fill="#e0805a" fill-opacity="0.25" filter="url(#${id}-soft)" />
    <path d="M270 360 Q300 344 330 360 Q322 404 300 432 Q278 404 270 360 Z" fill="url(#${id}-beak)" stroke="#a8560a" stroke-width="4" stroke-linejoin="round" />
    <ellipse cx="290" cy="362" rx="9" ry="5" fill="#ffffff" fill-opacity="0.6" />`;
    characters.push({
        id,
        label: 'Owl',
        order: 310,
        head: headSvg,
        eye: {
            box: [EYE_BOX, EYE_BOX],
            open: eye({
                id: `${id}-eye`,
                shape: ROUND_EYE,
                center: [55, 55],
                irisRadius: 27,
                iris: ['#fff2a0', '#f5b81f', '#b05a00'],
                pupilSize: 0.45,
                outline: '#2a1608',
            }),
            closed: closedEye({ lid: 'M28 54 Q55 74 82 54', color: '#4a2a10', lashes: false }),
        },
        brow: { box: [185, 214, 100, 40], svg: cartoonBrow({ color: '#5a3414' }), lift: 14 },
        mouth: { box: [250, 428, 100, 90], ...animalMouths(`${id}-mouth`, { color: '#6a3c10' }) },
    });
});

// ####################################################
// OUTPUT
// ####################################################

const stripSvg = (content) => content.replace(/^<svg[^>]*>\n/, '').replace(/\n<\/svg>\n$/, '');

function nested([x, y, w, h], content, flip = false) {
    const transform = flip ? ` transform="translate(${2 * x + w} 0) scale(-1 1)"` : '';
    return `<g${transform}><svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible">\n${stripSvg(content)}\n</svg></g>`;
}

function writeFile(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function opacity(expression, from, to, invert = false) {
    return `{ expression: '${expression}', from: ${from}, to: ${to}${invert ? ', invert: true' : ''} }`;
}

const descriptors = [];
fs.rmSync(OUT, { recursive: true, force: true });

builders.forEach((build) => build());
for (const character of characters) {
    const dir = path.join(OUT, character.id);
    const base = `assets/avatars/${character.id}`;
    const [ew, eh] = character.eye.box;
    const spread = character.eye.spread || 0;
    const eyeBoxes = [
        [EYE_RIGHT[0] - ew / 2 - spread, EYE_RIGHT[1] - eh / 2, ew, eh],
        [EYE_LEFT[0] - ew / 2 + spread, EYE_LEFT[1] - eh / 2, ew, eh],
    ];
    const browRight = character.brow.box;
    const browLeft = [W - browRight[0] - browRight[2], browRight[1], browRight[2], browRight[3]];
    const files = {
        'head.svg': svg(W, H, character.head),
        'eye-open.svg': svg(ew, eh, character.eye.open),
        'eye-closed.svg': svg(ew, eh, character.eye.closed),
        'brow.svg': svg(browRight[2], browRight[3], character.brow.svg),
        'mouth-neutral.svg': svg(character.mouth.box[2], character.mouth.box[3], character.mouth.neutral),
        'mouth-smile.svg': svg(character.mouth.box[2], character.mouth.box[3], character.mouth.smile),
        'mouth-open.svg': svg(character.mouth.box[2], character.mouth.box[3], character.mouth.open),
    };
    files['thumb.svg'] = svg(
        W,
        H,
        [
            stripSvg(files['head.svg']),
            nested(browRight, files['brow.svg']),
            nested(browLeft, files['brow.svg'], true),
            nested(eyeBoxes[0], files['eye-open.svg']),
            nested(eyeBoxes[1], files['eye-open.svg'], true),
            nested(character.mouth.box, files['mouth-smile.svg']),
        ].join('\n')
    );
    for (const [name, content] of Object.entries(files)) writeFile(path.join(dir, name), content);

    // Slightly gentler brow travel and wider mouth thresholds reduce jitter on low-light cameras.
    const lift = `offsetY: { expression: 'browUp', from: 0.18, to: 0.68, min: 0, max: -${Math.round(character.brow.lift * 1.6)} }`;
    const notTalking = opacity('mouthOpen', 0.08, 0.2, true);
    const parts = [
        `{ asset: '${base}/head.svg', box: [0, 0, ${W}, ${H}] }`,
        `{ asset: '${base}/brow.svg', box: [${browRight}], drive: { ${lift} } }`,
        `{ asset: '${base}/brow.svg', box: [${browLeft}], flipX: true, drive: { ${lift} } }`,
    ];
    for (const [index, expression] of [
        [0, 'blinkRight'],
        [1, 'blinkLeft'],
    ]) {
        const flip = index === 1 ? ', flipX: true' : '';
        parts.push(
            `{ asset: '${base}/eye-open.svg', box: [${eyeBoxes[index]}]${flip}, drive: { opacity: ${opacity(expression, 0.45, 0.6, true)} } }`,
            `{ asset: '${base}/eye-closed.svg', box: [${eyeBoxes[index]}]${flip}, drive: { opacity: ${opacity(expression, 0.45, 0.6)} } }`
        );
    }
    const mouthBox = `[${character.mouth.box}]`;
    parts.push(
        `{ asset: '${base}/mouth-neutral.svg', box: ${mouthBox}, drive: { opacity: [${notTalking}, ${opacity('smile', 0.3, 0.55, true)}] } }`,
        `{ asset: '${base}/mouth-smile.svg', box: ${mouthBox}, drive: { opacity: [${notTalking}, ${opacity('smile', 0.3, 0.55)}] } }`,
        `{ asset: '${base}/mouth-open.svg', box: ${mouthBox}, drive: { opacity: ${opacity('mouthOpen', 0.08, 0.2)}, scaleY: { expression: 'mouthOpen', from: 0.08, to: 0.75, min: 0.42, max: 1 } } }`
    );
    descriptors.push(`    VFX.registerAvatar({
        id: 'avatar-${character.id}',
        label: '${character.label}',
        order: ${character.order},
        thumbnail: '${base}/thumb.svg',
        ...CANVAS,
        parts: [
            ${parts.join(',\n            ')},
        ],
    });`);
}

writeFile(path.join(OUT, 'astronaut/helmet.svg'), svg(W, H, astronautHelmet));
writeFile(path.join(OUT, 'astronaut/thumb.svg'), svg(W, H, `${astronautThumbFace}\n${astronautHelmet}`));
descriptors.push(`    VFX.registerAvatar({
        id: 'avatar-astronaut',
        label: 'Astronaut',
        order: 390,
        thumbnail: 'assets/avatars/astronaut/thumb.svg',
        ...CANVAS,
        parts: [{ asset: 'assets/avatars/astronaut/helmet.svg', box: [0, 0, ${W}, ${H}] }],
    });`);

descriptors.sort((a, b) => Number(a.match(/order: (\d+)/)[1]) - Number(b.match(/order: (\d+)/)[1]));

writeFile(
    JS,
    `'use strict';

/**
 * MiroTalk Video Effects - animated head avatars.
 *
 * GENERATED by scripts/generate-video-effects-avatars.js: edit the generator, not this file.
 *
 * Each avatar is drawn on a ${W}x${H} canvas whose point (${EYES[0]}, ${EYES[1]}) is placed between the user's
 * eyes; \`width\` is the canvas width in eye distances. Eyes blink, brows rise, the mouth smiles
 * and opens while talking (expressions from MediaPipe blendshapes and landmarks). Parts that share
 * a drawing are mirrored with \`flipX\`. Original artwork for MiroTalk.
 */
(function (root) {
    const VFX = root.MiroTalkVFX;
    if (!VFX?.registerAvatar) return;

    const CANVAS = { size: [${W}, ${H}], eyes: [${EYES[0]}, ${EYES[1]}], width: ${CANVAS_WIDTH_IN_EYE_DISTANCES} };

${descriptors.join('\n')}
})(typeof globalThis !== 'undefined' ? globalThis : self);
`
);

const sizes = fs
    .readdirSync(OUT)
    .map((name) => {
        const total = fs
            .readdirSync(path.join(OUT, name))
            .reduce((sum, file) => sum + fs.statSync(path.join(OUT, name, file)).size, 0);
        return `${name} ${Math.round(total / 1024)} KB`;
    })
    .join(', ');
console.log(`Wrote ${path.relative(ROOT, OUT)} (${sizes}) and ${path.relative(ROOT, JS)}`);

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
        order: 220,
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
        order: 230,
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
        order: 240,
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
        order: 250,
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

    const lift = `offsetY: { expression: 'browUp', from: 0.15, to: 0.6, min: 0, max: -${character.brow.lift * 2} }`;
    const notTalking = opacity('mouthOpen', 0.04, 0.12, true);
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
        `{ asset: '${base}/mouth-open.svg', box: ${mouthBox}, drive: { opacity: ${opacity('mouthOpen', 0.04, 0.12)}, scaleY: { expression: 'mouthOpen', from: 0.05, to: 0.7, min: 0.3, max: 1 } } }`
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
        order: 280,
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

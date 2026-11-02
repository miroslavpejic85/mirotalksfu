'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const ENGINE_FILES = [
    'utils',
    'camera',
    'stream-manager',
    'renderer',
    'face-tracker',
    'effects-manager',
    'model-renderer',
    'effects/sunglasses',
    'effects/glasses',
    'effects/hat',
    'effects/mustache',
    'effects/beard',
    'effects/dog-ears',
    'effects/funny-mask',
    'effects/hearts',
    'effects/headwear',
    'effects/avatars',
    'effects/beauty',
    'index',
];

function loadEngine(extraGlobals = {}) {
    const context = vm.createContext({
        console,
        performance,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        URL,
        navigator: { userAgent: 'node' },
        ...extraGlobals,
    });
    for (const file of ENGINE_FILES) {
        const source = fs.readFileSync(path.join(__dirname, `../public/video-effects/${file}.js`), 'utf8');
        vm.runInContext(source, context, { filename: `${file}.js` });
    }
    return context;
}

// Synthetic MediaPipe face: 478 landmarks in camera pixels, only the ones the engine reads are set
function syntheticFace({ cx = 640, cy = 360, eyeDistance = 100, roll = 0 } = {}) {
    const points = new Float32Array(478 * 3);
    const local = {
        33: [-0.5, 0, 0], // right eye outer
        133: [-0.17, 0, 0], // right eye inner
        263: [0.5, 0, 0], // left eye outer
        362: [0.17, 0, 0], // left eye inner
        10: [0, -0.9, 0], // forehead
        152: [0, 1.4, 0], // chin
        168: [0, 0, -0.1], // nose bridge
        1: [0, 0.55, -0.3], // nose tip
        2: [0, 0.65, -0.2], // nose bottom
        0: [0, 0.8, -0.15], // upper lip
        13: [0, 0.88, -0.12],
        14: [0, 0.92, -0.12],
        468: [-0.33, 0, 0],
        473: [0.33, 0, 0],
    };
    const angle = (roll * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    Object.entries(local).forEach(([index, [x, y, z]]) => {
        const i = Number(index) * 3;
        points[i] = cx + (x * cos - y * sin) * eyeDistance;
        points[i + 1] = cy + (x * sin + y * cos) * eyeDistance;
        points[i + 2] = z * eyeDistance;
    });
    return points;
}

function close(actual, expected, tolerance = 1e-3, message) {
    assert.ok(Math.abs(actual - expected) <= tolerance, message || `expected ${actual} to be close to ${expected}`);
}

describe('Video effects engine', () => {
    let context;
    let VFX;

    beforeEach(() => {
        context = loadEngine();
        VFX = context.MiroTalkVFX;
    });

    describe('One Euro smoothing', () => {
        it('removes jitter on a still face and follows fast movements', () => {
            const smoother = new VFX.OneEuroSmoother({ minCutoff: 1.2, beta: 0.02 });
            let output;
            for (let i = 0; i < 60; i++) {
                const noise = i % 2 === 0 ? 2 : -2;
                output = smoother.filter([100 + noise], i * 66);
            }
            assert.ok(Math.abs(output[0] - 100) < 1, 'jitter of +-2px must be reduced below 1px');

            const fast = new VFX.OneEuroSmoother({ minCutoff: 1.2, beta: 0.02 });
            fast.filter([0], 0);
            let value;
            for (let i = 1; i <= 8; i++) value = fast.filter([i * 40], i * 66)[0];
            assert.ok(value > 320 - 60, `fast motion must not lag far behind (got ${value})`);
        });

        it('restarts from the first value after reset', () => {
            const smoother = new VFX.OneEuroSmoother();
            smoother.filter([10], 0);
            smoother.reset();
            assert.equal(smoother.filter([500], 10)[0], 500);
        });
    });

    describe('face pose', () => {
        it('computes the face basis, scale and center of a frontal face', () => {
            const pose = VFX.computeFacePose(syntheticFace());
            close(pose.scale, 100);
            close(pose.center[0], 640);
            close(pose.center[1], 360);
            close(pose.axes.x[0], 1);
            close(pose.axes.y[1], 1);
            close(pose.axes.z[2], 1);
            close(pose.roll, 0);
            close(pose.yaw, 0);
        });

        it('tracks head roll', () => {
            const pose = VFX.computeFacePose(syntheticFace({ roll: 25 }));
            close(pose.roll, 25, 1e-2);
            close(pose.scale, 100, 1e-2);
        });

        it('rejects missing or degenerate landmarks', () => {
            assert.equal(VFX.computeFacePose(null), null);
            assert.equal(VFX.computeFacePose(new Float32Array(478 * 3)), null);
        });
    });

    describe('accessory placement', () => {
        const face = (options) => ({ points: syntheticFace(options), pose: null, opacity: 1 });

        function placed(layer, options, aspect = 0.5) {
            const f = face(options);
            f.pose = VFX.computeFacePose(f.points);
            const normalized = VFX.registerEffect({ id: 'test-layer', layers: [layer] }).layers[0];
            return VFX.computeLayerCorners(f, normalized, aspect);
        }

        it('centers and scales a layer on its anchor', () => {
            const corners = placed({ asset: 'a.svg', anchor: 'eyes', width: 1.5 });
            const [tlx, tly, trx, , , bry] = corners;
            close(trx - tlx, 150); // 1.5 x eye distance
            close(bry - tly, 75); // aspect 0.5
            close((tlx + trx) / 2, 640);
            close((tly + bry) / 2, 360);
        });

        it('applies offsets along the face axes and the pivot', () => {
            const corners = placed({ asset: 'a.svg', anchor: 'eyes', width: 1, offset: [0.2, -0.5, 0], pivot: [0, 1] });
            // pivot bottom-left placed on anchor + offset
            close(corners[6], 640 + 20);
            close(corners[7], 360 - 50);
        });

        it('mirrors flipped layers and follows head roll', () => {
            const normal = placed({ asset: 'a.svg', anchor: 'eyes', width: 1 });
            const flipped = placed({ asset: 'a.svg', anchor: 'eyes', width: 1, flipX: true });
            close(flipped[0], normal[2]);
            close(flipped[2], normal[0]);

            const rolled = placed({ asset: 'a.svg', anchor: 'eyes', width: 1 }, { roll: 90 });
            // x axis now points down: top edge is vertical
            close(rolled[2] - rolled[0], 0, 1e-2);
            close(rolled[3] - rolled[1], 100, 1e-2);
        });
    });

    describe('registry and filters', () => {
        it('registers the built-in effects in display order', () => {
            const manager = new VFX.EffectsManager({ assetBaseUrl: 'https://example.com/video-effects/' });
            const list = manager.list();
            assert.deepEqual(
                [...list.filter((effect) => effect.category === 'face').map((effect) => effect.id)],
                [
                    'sunglasses',
                    'glasses',
                    'glasses-3d',
                    'heart-glasses',
                    'baseball-cap',
                    'crown',
                    'party-hat',
                    'flower-crown',
                    'halo',
                    'dog-ears',
                    'bunny-ears',
                    'mustache',
                    'beard',
                    'funny-mask',
                    'heart-eyes',
                    'heart-crown',
                ]
            );
            assert.equal(list.find((e) => e.id === 'glasses-3d').is3D, true);
            assert.deepEqual(
                [...list.filter((effect) => effect.category === 'avatar').map((effect) => effect.id)],
                [
                    'avatar-cat',
                    'avatar-lion',
                    'avatar-bear',
                    'avatar-panda',
                    'avatar-fox',
                    'avatar-monkey',
                    'avatar-dragon',
                    'avatar-unicorn',
                    'avatar-man',
                    'avatar-blackman',
                    'avatar-woman',
                    'avatar-blackwoman',
                    'avatar-elf',
                    'avatar-robot',
                    'avatar-alien',
                    'avatar-astronaut',
                ]
            );
            assert.equal(list[0].thumbnail, 'https://example.com/video-effects/assets/sunglasses/sunglasses.svg');
        });

        it('rejects invalid effect descriptors', () => {
            assert.throws(() => VFX.registerEffect({}), /string id/);
            assert.throws(() => VFX.registerEffect({ id: 'x', layers: [] }), /image layers or a 3D model/);
            assert.throws(
                () => VFX.registerEffect({ id: 'x', layers: [{ asset: 'a.svg', anchor: 'nowhere', width: 1 }] }),
                /unknown anchor/
            );
            assert.throws(
                () => VFX.registerEffect({ id: 'x', layers: [{ asset: 'a.svg', anchor: [9999], width: 1 }] }),
                /unknown anchor/
            );
            assert.throws(() => VFX.registerEffect({ id: 'x', layers: [{ asset: 'a.svg', width: 0 }] }), /width/);
        });

        it('rejects unknown effects when preparing them', async () => {
            const manager = new VFX.EffectsManager();
            await assert.rejects(manager.prepare('does-not-exist'), (error) => error.code === 'UNKNOWN_EFFECT');
        });

        it('clamps filters and detects the neutral state', () => {
            const filters = VFX.normalizeFilters({ brightness: 9, saturation: -1, smoothing: 0.4, unknown: 3 });
            assert.equal(filters.brightness, 1.5);
            assert.equal(filters.saturation, 0);
            assert.equal(filters.smoothing, 0.4);
            assert.equal(filters.unknown, undefined);
            assert.equal(VFX.isDefaultFilters(VFX.normalizeFilters({})), true);
            assert.equal(VFX.isDefaultFilters(filters), false);
            assert.deepEqual(
                [...VFX.getFilterPresets().map((preset) => preset.id)],
                ['none', 'beauty', 'soft-glow', 'vivid', 'warm', 'cool', 'vintage', 'sepia', 'grayscale']
            );
        });

        it('builds CSS filters matching the shader order', () => {
            assert.equal(
                VFX.cssFilter({ brightness: 1.1, contrast: 0.9, saturation: 1.2, grayscale: 0.5, sepia: 0.3 }),
                'brightness(1.1) contrast(0.9) saturate(1.2) grayscale(0.5) sepia(0.3)'
            );
        });
    });

    describe('avatars and expressions', () => {
        // Adds eyelid and inner-lip landmarks to the synthetic face
        function expressiveFace({ eyeOpen = 0.3, leftEyeOpen = eyeOpen, mouth = 0 } = {}) {
            const points = syntheticFace();
            const set = (index, x, y) => {
                points[index * 3] = 640 + x * 100;
                points[index * 3 + 1] = 360 + y * 100;
            };
            const eyeWidth = 0.33;
            set(159, -0.33, (-eyeOpen * eyeWidth) / 2);
            set(145, -0.33, (eyeOpen * eyeWidth) / 2);
            set(386, 0.33, (-leftEyeOpen * eyeWidth) / 2);
            set(374, 0.33, (leftEyeOpen * eyeWidth) / 2);
            set(13, 0, 0.88);
            set(14, 0, 0.88 + mouth);
            return points;
        }

        function settle(estimator, points, from = 0) {
            let values;
            for (let t = from; t <= from + 500; t += 16) values = estimator.update(points, 100, t);
            return { ...values };
        }

        it('detects blinks, winks and mouth opening', () => {
            const estimator = new VFX.ExpressionEstimator();
            const open = settle(estimator, expressiveFace());
            assert.ok(open.blink < 0.05 && open.mouthOpen < 0.05, JSON.stringify(open));

            const blink = settle(estimator, expressiveFace({ eyeOpen: 0.05 }), 600);
            assert.ok(blink.blinkLeft > 0.95 && blink.blinkRight > 0.95, JSON.stringify(blink));

            const wink = settle(estimator, expressiveFace({ eyeOpen: 0.3, leftEyeOpen: 0.05 }), 1200);
            assert.ok(wink.blinkLeft > 0.95 && wink.blinkRight < 0.05, JSON.stringify(wink));

            const talking = settle(estimator, expressiveFace({ mouth: 0.3 }), 1800);
            assert.ok(talking.mouthOpen > 0.7 && talking.blink < 0.05, JSON.stringify(talking));
        });

        it('adapts the open-eye reference to naturally narrow eyes', () => {
            const estimator = new VFX.ExpressionEstimator();
            let values;
            for (let t = 0; t <= 30000; t += 16) values = estimator.update(expressiveFace({ eyeOpen: 0.18 }), 100, t);
            assert.ok(values.blink < 0.05, `narrow open eyes are not a blink (${values.blink})`);
        });

        it('uses blendshapes for blinks, smile and raised brows', () => {
            const estimator = new VFX.ExpressionEstimator();
            const shapes = (values) => ({
                eyeBlinkLeft: 0,
                eyeBlinkRight: 0,
                mouthSmileLeft: 0,
                mouthSmileRight: 0,
                browInnerUp: 0,
                browOuterUpLeft: 0,
                browOuterUpRight: 0,
                ...values,
            });
            const run = (values, from, points = expressiveFace()) => {
                let out;
                for (let t = from; t <= from + 600; t += 16) out = estimator.update(points, 100, t, shapes(values));
                return { ...out };
            };
            const neutral = run({}, 0);
            assert.ok(neutral.blink < 0.05 && neutral.smile < 0.05 && neutral.browUp < 0.05, JSON.stringify(neutral));
            const happy = run({ mouthSmileLeft: 0.9, mouthSmileRight: 0.8, browInnerUp: 0.7 }, 700);
            assert.ok(happy.smile > 0.8 && happy.browUp > 0.65, JSON.stringify(happy));
            const blink = run({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 }, 1400);
            assert.ok(blink.blinkLeft > 0.95 && blink.blinkRight > 0.95, JSON.stringify(blink));
        });

        it('swaps mirrored blendshape sides after a few clear winks disagree with the landmarks', () => {
            const estimator = new VFX.ExpressionEstimator();
            // Landmarks: the subject's left eye is closed; blendshapes report it on the other side
            const wink = expressiveFace({ eyeOpen: 0.3, leftEyeOpen: 0.03 });
            const shapes = { eyeBlinkLeft: 0, eyeBlinkRight: 0.95 };
            let values;
            for (let t = 0; t <= 2000; t += 16) values = estimator.update(wink, 100, t, shapes);
            assert.ok(values.blinkLeft > 0.95 && values.blinkRight < 0.05, JSON.stringify(values));
        });

        it('combines several expressions and moves layers', () => {
            const effect = VFX.registerEffect({
                id: 'test-drive',
                layers: [
                    {
                        asset: 'mouth.svg',
                        width: 1,
                        drive: {
                            opacity: [
                                { expression: 'mouthOpen', from: 0.04, to: 0.12, invert: true },
                                { expression: 'smile', from: 0.3, to: 0.55, invert: true },
                            ],
                        },
                    },
                    { asset: 'brow.svg', width: 1, drive: { offsetY: { expression: 'browUp', min: 0, max: -0.2 } } },
                ],
            });
            const manager = new VFX.EffectsManager();
            const asset = { image: {}, aspect: 0.5 };
            manager.setActive({ effect, layers: effect.layers.map((layer) => ({ layer, asset })) });
            const face = { points: syntheticFace(), opacity: 1, expressions: { mouthOpen: 0, smile: 0, browUp: 0 } };
            face.pose = VFX.computeFacePose(face.points);
            const [, browDown] = manager.computeLayers(face);
            assert.equal(manager.computeLayers(face).length, 2);
            face.expressions.smile = 1;
            assert.equal(manager.computeLayers(face).length, 1, 'neutral mouth hidden while smiling');
            face.expressions = { mouthOpen: 0.5, smile: 0, browUp: 1 };
            const layers = manager.computeLayers(face);
            assert.equal(layers.length, 1, 'neutral mouth hidden while talking');
            close(layers[0].corners[1], browDown.corners[1] - 20, 1e-6, 'brow raised by 0.2 eye distances');
            assert.throws(
                () => VFX.registerEffect({ id: 'x', layers: [{ asset: 'a', width: 1, drive: { rotate: {} } }] }),
                /unknown drive property/
            );
        });

        it('drives layer opacity and scale from expressions', () => {
            const opacity = { expression: 'mouthOpen', from: 0.04, to: 0.12, invert: false, min: 0, max: 1 };
            assert.equal(VFX.driveValue(opacity, { mouthOpen: 0 }), 0);
            assert.equal(VFX.driveValue(opacity, { mouthOpen: 0.5 }), 1);
            assert.equal(VFX.driveValue({ ...opacity, invert: true }, { mouthOpen: 0.5 }), 0);
            const scale = { expression: 'mouthOpen', from: 0.05, to: 0.7, invert: false, min: 0.3, max: 1 };
            assert.equal(VFX.driveValue(scale, { mouthOpen: 0 }), 0.3);
            assert.equal(VFX.driveValue(scale, {}), 0.3);
        });

        it('maps avatar parts from the drawing canvas to the face and hides undriven states', async () => {
            const effect = VFX.registerAvatar({
                id: 'test-avatar',
                label: 'Test',
                size: [600, 640],
                eyes: [300, 300],
                width: 3,
                parts: [
                    { asset: 'head.svg', box: [0, 0, 600, 640] },
                    { asset: 'eye.svg', box: [310, 245, 110, 110], flipX: true },
                    {
                        asset: 'mouth.svg',
                        box: [250, 444, 100, 84],
                        drive: { opacity: { expression: 'mouthOpen', from: 0.04, to: 0.12 } },
                    },
                ],
            });
            assert.equal(effect.category, 'avatar');
            const [head, eye, mouth] = effect.layers;
            close(head.width, 3);
            close(head.offset[0], -1.5);
            close(head.offset[1], -1.5);
            close(eye.offset[0], (420 - 300) / 200, 1e-9, 'mirrored part anchored on its right edge');

            const face = { points: syntheticFace(), opacity: 1, expressions: { mouthOpen: 0 } };
            face.pose = VFX.computeFacePose(face.points);
            const eyeCorners = VFX.computeLayerCorners(face, eye, 1);
            close(eyeCorners[0], 640 + 60, 1e-6); // image left edge on the box right edge (x=420)
            close(eyeCorners[2], 640 + 5, 1e-6); // image right edge on the box left edge (x=310)

            const manager = new VFX.EffectsManager();
            const asset = { image: {}, aspect: 1 };
            manager.setActive({ effect, layers: effect.layers.map((layer) => ({ layer, asset })) });
            assert.equal(manager.computeLayers(face).length, 2, 'closed mouth: open-mouth layer hidden');
            face.expressions.mouthOpen = 0.5;
            assert.equal(manager.computeLayers(face).length, 3);
        });

        it('rejects invalid avatar descriptors', () => {
            assert.throws(() => VFX.registerAvatar({ id: 'x', parts: [] }), /size, eyes and width/);
            assert.throws(
                () =>
                    VFX.registerAvatar({
                        id: 'x',
                        size: [600, 640],
                        eyes: [300, 300],
                        width: 3,
                        parts: [{ asset: 'a.svg', box: [0, 0, 10] }],
                    }),
                /box/
            );
            assert.throws(
                () =>
                    VFX.registerEffect({
                        id: 'x',
                        layers: [{ asset: 'a.svg', width: 1, drive: { opacity: { expression: 'frown' } } }],
                    }),
                /unknown expression/
            );
        });
    });

    describe('face tracker interpolation and loss handling', () => {
        function readyTracker(options = {}) {
            const tracker = new VFX.FaceTracker({ detectionFps: 15, lossGraceMs: 600, fadeMs: 250, ...options });
            return tracker;
        }

        function normalized(points, width, height) {
            const landmarks = new Float32Array(points.length);
            for (let i = 0; i < points.length; i += 3) {
                landmarks[i] = points[i] / width;
                landmarks[i + 1] = points[i + 1] / height;
                landmarks[i + 2] = points[i + 2] / width;
            }
            return landmarks;
        }

        it('snaps on first detection, then interpolates towards new detections', () => {
            const tracker = readyTracker();
            tracker.handleLandmarks(normalized(syntheticFace({ cx: 600 }), 1280, 720), 1280, 720, 0);
            const first = tracker.getFace(16);
            close(first.pose.center[0], 600, 0.5);

            tracker.handleLandmarks(normalized(syntheticFace({ cx: 700 }), 1280, 720), 1280, 720, 66);
            const next = tracker.getFace(32);
            assert.ok(next.pose.center[0] > 600 && next.pose.center[0] < 700, 'moves part of the way');
        });

        it('extrapolates moving landmarks to hide the detection latency, within a bound', () => {
            const tracker = readyTracker();
            tracker.handleLandmarks(normalized(syntheticFace({ cx: 600 }), 1280, 720), 1280, 720, 0);
            tracker.handleLandmarks(normalized(syntheticFace({ cx: 640 }), 1280, 720), 1280, 720, 66);
            let face = null;
            for (let t = 82; t <= 400; t += 16) face = tracker.getFace(t);
            const target = tracker.target[33 * 3];
            const center = face.pose.center[0];
            assert.ok(center > 600, 'follows the movement');
            assert.ok(tracker.display[33 * 3] > target, 'predicted ahead of the last detection');
            assert.ok(tracker.display[33 * 3] - target < 60, 'prediction is bounded');
        });

        it('scales the landmarks to a downscaled output', () => {
            const tracker = readyTracker();
            tracker.handleLandmarks(normalized(syntheticFace(), 1280, 720), 1280, 720, 0);
            const face = tracker.getFace(16, 0.5);
            close(face.pose.center[0], 320, 0.5);
            close(face.pose.scale, 50, 0.5);
        });

        it('keeps the face during the grace period, then fades it out', () => {
            const tracker = readyTracker();
            const faceEvents = [];
            tracker.on('face', (event) => faceEvents.push(event.detected));
            tracker.handleLandmarks(normalized(syntheticFace(), 1280, 720), 1280, 720, 0);
            for (let t = 16; t <= 400; t += 16) tracker.getFace(t);
            assert.equal(tracker.getFace(416).opacity, 1);

            tracker.handleLandmarks(null, 1280, 720, 500); // face lost at t=500
            assert.equal(tracker.getFace(1000).opacity, 1, 'still visible inside the grace period');
            let face = null;
            for (let t = 1016; t <= 1600; t += 16) face = tracker.getFace(t);
            assert.equal(face, null, 'faded out after the grace period');
            assert.deepEqual(faceEvents, [true, false]);
        });

        it('ignores detections that finish after a source change', async () => {
            const tracker = readyTracker();
            let resolveDetect;
            tracker.state = 'ready';
            tracker.backend = { detect: () => new Promise((resolve) => (resolveDetect = resolve)), close() {} };
            tracker.update({ videoWidth: 1280, videoHeight: 720 }, 1000);
            tracker.reset();
            resolveDetect(normalized(syntheticFace(), 1280, 720));
            await new Promise((resolve) => setImmediate(resolve));
            assert.equal(tracker.getFace(1100), null);
        });

        it('stops after repeated detection errors and reports it', () => {
            const tracker = readyTracker({ maxConsecutiveErrors: 2 });
            const backend = { close: sinon.spy() };
            tracker.state = 'ready';
            tracker.backend = backend;
            const states = [];
            tracker.on('state', (state) => states.push(state.state));
            const warn = sinon.stub(console, 'warn');
            try {
                tracker.handleDetectError(new Error('boom'));
                tracker.handleDetectError(new Error('boom'));
            } finally {
                warn.restore();
            }
            assert.equal(tracker.state, 'error');
            assert.equal(tracker.error.code, 'FACE_TRACKING_FAILED');
            assert.ok(backend.close.calledOnce);
            assert.deepEqual(states, ['error']);
        });
    });

    describe('renderers', () => {
        it('draws accessories with an exact affine transform on Canvas 2D', () => {
            const calls = [];
            const ctx = {
                filter: 'none',
                save: () => calls.push(['save']),
                restore: () => calls.push(['restore']),
                setTransform: (...args) => calls.push(['setTransform', ...args]),
                drawImage: (...args) => calls.push(['drawImage', ...args.slice(1)]),
                set globalAlpha(value) {
                    calls.push(['alpha', value]);
                },
            };
            const canvas = { width: 1280, height: 720, getContext: () => ctx };
            const renderer = new VFX.Canvas2DRenderer(canvas);
            const image = { width: 200, height: 100 };
            renderer.drawImageQuad(image, [100, 50, 300, 50, 300, 150, 100, 150], 0.8);
            assert.deepEqual(
                calls.find((call) => call[0] === 'setTransform'),
                ['setTransform', 1, 0, 0, 1, 100, 50]
            );
            assert.deepEqual(
                calls.find((call) => call[0] === 'alpha'),
                ['alpha', 0.8]
            );
        });

        it('reports missing CSS filter support on old Canvas 2D implementations', () => {
            const ctx = {};
            const renderer = new VFX.Canvas2DRenderer({ width: 10, height: 10, getContext: () => ctx });
            assert.equal(renderer.capabilities.filters, false);
            assert.equal(renderer.capabilities.smoothing, false);
        });
    });

    describe('MiroTalkVideoEffects API', () => {
        it('caps the output size without upscaling and keeps even dimensions', () => {
            const effects = new context.MiroTalkVideoEffects({ width: 1280, height: 720 });
            assert.deepEqual(
                { ...effects.computeOutputSize(1920, 1080) },
                { width: 1280, height: 720, scale: 1280 / 1920 }
            );
            assert.deepEqual({ ...effects.computeOutputSize(640, 480) }, { width: 640, height: 480, scale: 1 });
            const portrait = effects.computeOutputSize(1080, 1920);
            assert.equal(portrait.width, 720);
            assert.equal(portrait.height, 1280);
            const odd = effects.computeOutputSize(1919, 1081);
            assert.equal(odd.width % 2, 0);
            assert.equal(odd.height % 2, 0);
        });

        it('is active only when an effect or a filter changes the camera', () => {
            const effects = new context.MiroTalkVideoEffects();
            assert.equal(effects.isActive(), false);
            effects.setFilterPreset('sepia');
            assert.equal(effects.isActive(), true);
            assert.equal(effects.getState().filterPreset, 'sepia');
            effects.resetFilters();
            assert.equal(effects.isActive(), false);
            effects.setFilters({ brightness: 1.2 });
            assert.equal(effects.isActive(), true);
            assert.equal(effects.getState().filterPreset, null);
            assert.throws(
                () => effects.setFilterPreset('nope'),
                (error) => error.code === 'UNKNOWN_FILTER'
            );
        });

        it('layers touch up and low light on top of presets and clears everything', async () => {
            const effects = new context.MiroTalkVideoEffects();
            effects.setFilterPreset('warm');
            effects.setAdjustments({ touchUp: 0.6, lowLight: 1, unknown: 5 });
            const state = effects.getState();
            assert.equal(state.filterPreset, 'warm', 'adjustments keep the preset');
            assert.deepEqual({ ...state.adjustments }, { touchUp: 0.6, lowLight: 1 });
            close(state.effectiveFilters.smoothing, 0.6);
            close(state.effectiveFilters.brightness, 1.35);
            close(state.effectiveFilters.temperature, 0.6, 1e-6, 'preset values kept');
            effects.setAdjustments({ touchUp: 3, lowLight: -1 });
            assert.deepEqual({ ...effects.getState().adjustments }, { touchUp: 1, lowLight: 0 }, 'clamped');

            effects.resetFilters();
            assert.equal(effects.isActive(), true, 'touch up alone keeps the engine active');
            await effects.clearAll();
            const cleared = effects.getState();
            assert.equal(cleared.filterPreset, 'none');
            assert.deepEqual({ ...cleared.adjustments }, { touchUp: 0, lowLight: 0 });
            assert.equal(effects.isActive(), false);
        });

        it('reports a slow device after sustained low frame rates only', () => {
            const effects = new context.MiroTalkVideoEffects({ slowFps: 12 });
            const states = [];
            effects.on('state', (state) => states.push(state.slow));
            const second = (fps) => {
                effects.fps = fps;
                effects.updatePerformance();
            };
            [8, 8, 8].forEach(second);
            assert.equal(effects.getState().slow, false, 'three slow seconds are not enough');
            second(8);
            assert.equal(effects.getState().slow, true);
            second(25);
            assert.equal(effects.getState().slow, true, 'one good second does not clear it');
            [25, 25, 25].forEach(second);
            assert.equal(effects.getState().slow, false);
            assert.deepEqual(states, [true, false], 'state emitted only on changes');
        });

        it('stop() ends the output but never stops the camera track', () => {
            const effects = new context.MiroTalkVideoEffects();
            const parts = {
                scheduler: { stop: sinon.spy() },
                streamManager: { stop: sinon.spy() },
                source: { detach: sinon.spy() },
                tracker: { reset: sinon.spy() },
            };
            Object.assign(effects, parts, { initialized: true, running: true });
            effects.stop();
            assert.ok(parts.scheduler.stop.calledOnce);
            assert.ok(parts.streamManager.stop.calledOnce);
            assert.ok(parts.source.detach.calledOnce);
            assert.ok(parts.tracker.reset.calledOnce);
            assert.equal(effects.running, false);
        });

        it('destroy() releases every resource once', async () => {
            const effects = new context.MiroTalkVideoEffects();
            const parts = {
                scheduler: { destroy: sinon.spy() },
                streamManager: { stop: sinon.spy() },
                source: { destroy: sinon.spy() },
                tracker: { destroy: sinon.spy() },
                modelRenderer: { destroy: sinon.spy() },
                renderer: { destroy: sinon.spy() },
                manager: { clear: sinon.spy() },
                canvas: { width: 1280, height: 720 },
            };
            Object.assign(effects, parts, { initialized: true });
            const listener = sinon.spy();
            effects.on('destroyed', listener);
            await effects.destroy();
            await effects.destroy();
            for (const key of ['scheduler', 'source', 'tracker', 'renderer']) {
                assert.ok(parts[key].destroy.calledOnce, `${key} destroyed`);
            }
            assert.ok(parts.modelRenderer.destroy.calledOnce);
            assert.ok(parts.streamManager.stop.calledOnce);
            assert.ok(parts.manager.clear.calledOnce);
            assert.equal(parts.canvas.width, 0);
            assert.ok(listener.calledOnce);
            await assert.rejects(effects.initialize(), (error) => error.code === 'DESTROYED');
        });
    });

    describe('video source', () => {
        it('renders canvas-captured tracks from their canvas (Safari WebGL video upload bug)', async () => {
            class FakeCanvas {
                constructor(width, height) {
                    this.width = width;
                    this.height = height;
                }
            }
            const ctx = loadEngine({ HTMLCanvasElement: FakeCanvas, MediaStream: class {} });
            const video = {
                play: async () => {},
                pause() {},
                remove() {},
                readyState: 4,
                videoWidth: 1280,
                videoHeight: 720,
                srcObject: null,
            };
            const source = new ctx.MiroTalkVFX.VideoSource({ video });
            const track = (canvas) => ({
                kind: 'video',
                readyState: 'live',
                canvas,
                addEventListener() {},
                removeEventListener() {},
            });

            const canvas = new FakeCanvas(1280, 720);
            await source.attachTrack(track(canvas));
            assert.equal(source.frameSource, canvas);

            canvas.width = 0;
            assert.equal(source.frameSource, video, 'empty canvas falls back to the video element');

            await source.attachTrack(track({ width: 1280, height: 720 }));
            assert.equal(source.frameSource, video, 'non-canvas objects are ignored');

            await source.attachTrack(track(undefined));
            assert.equal(source.frameSource, video, 'camera tracks use the video element');

            await source.attachTrack(track(new FakeCanvas(640, 360)));
            source.detach();
            assert.equal(source.frameSource, video);
        });
    });

    describe('frame scheduler', () => {
        it('falls back to a timer when requestVideoFrameCallback is unavailable', () => {
            const clock = sinon.useFakeTimers();
            try {
                // The engine context must capture the fake timers
                const fakeVFX = loadEngine({
                    setInterval,
                    clearInterval,
                    setTimeout,
                    clearTimeout,
                    performance: globalThis.performance,
                }).MiroTalkVFX;
                const ticks = [];
                const scheduler = new fakeVFX.FrameScheduler((now) => ticks.push(now), { fps: 10 });
                scheduler.timerWorker = false; // no Worker in Node: setInterval path
                scheduler.start({});
                clock.tick(1000);
                assert.ok(ticks.length >= 8 && ticks.length <= 10, `ticked ${ticks.length} times`);
                scheduler.destroy();
                const count = ticks.length;
                clock.tick(1000);
                assert.equal(ticks.length, count, 'no ticks after destroy');
            } finally {
                clock.restore();
            }
        });
    });
});

describe('RoomClient video effects integration', () => {
    let context;
    let client;
    let engine;
    let producer;
    let videoElement;

    function track(label) {
        return { label, kind: 'video', readyState: 'live', stop: sinon.spy() };
    }

    beforeEach(() => {
        const cameraTrack = track('camera');
        const processedTrack = track('processed');
        engine = {
            destroyed: false,
            running: false,
            active: true,
            isActive() {
                return this.active;
            },
            setSourceTrack: sinon.spy(async () => {
                engine.running = true;
                return processedTrack;
            }),
            stop: sinon.spy(() => {
                engine.running = false;
            }),
            destroy: sinon.spy(async () => {}),
        };
        producer = {
            closed: false,
            track: cameraTrack,
            replaceTrack: sinon.spy(async ({ track: next }) => {
                producer.track = next;
            }),
        };
        videoElement = { srcObject: null };
        context = vm.createContext({
            console,
            videoEffects: engine,
            virtualBackground: {
                isProcessing: true,
                stopCurrentProcessor: sinon.spy(async () => {}),
            },
            userLog: sinon.spy(),
            MediaStream: class {
                constructor(tracks) {
                    this.tracks = tracks;
                }
                getVideoTracks() {
                    return this.tracks;
                }
            },
            mediaType: { video: 'videoType', screen: 'screenType' },
        });
        const source = fs.readFileSync(path.join(__dirname, '../public/js/RoomClient.js'), 'utf8');
        const start = source.indexOf('    releaseVideoBackgroundSource()');
        const end = source.indexOf(
            '    // ####################################################\n    // NOISE SUPPRESSION'
        );
        assert.ok(start > 0 && end > start, 'video effects methods found');
        const methods = source.slice(start, end);
        client = vm.runInContext(`new (class { ${methods} })()`, context);
        client.producerLabel = new Map([['videoType', 'producer-1']]);
        client.producers = new Map([['producer-1', producer]]);
        client.videoEffectsSourceTrack = null;
        client.videoEffectsQueue = Promise.resolve();
        client.localVideoStream = new context.MediaStream([cameraTrack]);
        client.getId = (id) => (id === 'producer-1' ? videoElement : null);
        client.closeProducer = sinon.spy();
        client.cameraTrack = cameraTrack;
        client.processedTrack = processedTrack;
    });

    it('switches the live producer to the processed track with replaceTrack', async () => {
        await client.updateVideoEffectsTrack();
        assert.ok(engine.setSourceTrack.calledOnceWith(client.cameraTrack));
        assert.ok(producer.replaceTrack.calledOnce);
        assert.equal(producer.track, client.processedTrack);
        assert.equal(client.videoEffectsSourceTrack, client.cameraTrack);
        assert.equal(videoElement.srcObject.getVideoTracks()[0], client.processedTrack);
        assert.equal(client.localVideoStream.getVideoTracks()[0], client.processedTrack);
        assert.equal(client.cameraTrack.stop.called, false);
    });

    it('restores the original camera track when effects are disabled', async () => {
        await client.updateVideoEffectsTrack();
        engine.active = false;
        await client.updateVideoEffectsTrack();
        assert.equal(producer.track, client.cameraTrack);
        assert.equal(client.videoEffectsSourceTrack, null);
        assert.ok(engine.stop.calledOnce);
        assert.equal(client.cameraTrack.stop.called, false, 'the camera keeps running');
        assert.equal(videoElement.srcObject.getVideoTracks()[0], client.cameraTrack);
    });

    it('does nothing without a camera producer (applied on the next produce)', async () => {
        client.producerLabel.clear();
        await client.updateVideoEffectsTrack();
        assert.equal(engine.setSourceTrack.called, false);
    });

    it('does not replace the track again when switching between effects', async () => {
        await client.updateVideoEffectsTrack();
        await client.updateVideoEffectsTrack();
        assert.ok(producer.replaceTrack.calledOnce);
    });

    it('keeps the camera when the effects engine fails to start', async () => {
        engine.setSourceTrack = sinon.spy(async () => {
            throw new Error('no webgl');
        });
        const error = sinon.stub(console, 'error');
        try {
            await client.updateVideoEffectsTrack();
        } finally {
            error.restore();
        }
        assert.equal(producer.replaceTrack.called, false);
        assert.equal(producer.track, client.cameraTrack);
        assert.ok(engine.stop.calledOnce);
        assert.ok(context.userLog.calledOnce);
    });

    it('wraps a new camera stream and falls back to the raw stream on errors', async () => {
        const stream = new context.MediaStream([client.cameraTrack]);
        const processed = await client.applyVideoEffectsToStream(stream);
        assert.equal(processed.getVideoTracks()[0], client.processedTrack);
        assert.equal(client.videoEffectsSourceTrack, client.cameraTrack);

        engine.active = false;
        assert.equal(await client.applyVideoEffectsToStream(stream), stream);

        engine.active = true;
        engine.setSourceTrack = async () => {
            throw new Error('boom');
        };
        const error = sinon.stub(console, 'error');
        try {
            assert.equal(await client.applyVideoEffectsToStream(stream), stream);
        } finally {
            error.restore();
        }
        assert.equal(client.videoEffectsSourceTrack, null);
    });

    it('releases the camera feeding the effects when the producer closes', async () => {
        await client.updateVideoEffectsTrack();
        client.releaseVideoEffectsSource();
        assert.ok(client.cameraTrack.stop.calledOnce);
        assert.ok(engine.stop.calledOnce);
        assert.equal(client.videoEffectsSourceTrack, null);
    });

    it('closes the producer when the camera feeding the effects ends', async () => {
        await client.updateVideoEffectsTrack();
        client.handleVideoEffectsSourceEnded();
        assert.ok(client.closeProducer.calledOnceWith('videoType', 'trackended'));
    });

    it('releases the camera behind the virtual background and stops its processor', () => {
        const backgroundCamera = track('background-camera');
        client.videoBackgroundSourceTrack = backgroundCamera;
        client.releaseVideoBackgroundSource();
        assert.ok(backgroundCamera.stop.calledOnce);
        assert.ok(context.virtualBackground.stopCurrentProcessor.calledOnce);
        assert.equal(client.videoBackgroundSourceTrack, null);

        client.releaseVideoBackgroundSource();
        assert.ok(context.virtualBackground.stopCurrentProcessor.calledOnce, 'no-op without a background camera');
    });

    it('destroys the engine and releases the camera on exit', async () => {
        await client.updateVideoEffectsTrack();
        client.destroyVideoEffects();
        assert.ok(client.cameraTrack.stop.calledOnce);
        assert.ok(engine.destroy.calledOnce);
    });
});

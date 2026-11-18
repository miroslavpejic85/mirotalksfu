'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');
const { ReadableStream, WritableStream, TransformStream } = require('stream/web');
const { JSDOM } = require('jsdom');

describe('Virtual background settings selection', () => {
    let context;
    let document;
    let client;

    beforeEach(() => {
        document = new JSDOM(`
            <div id="videoVirtualBackground"></div>
            <div id="imageGrid"></div>
            <div id="imageGridVideoControls"></div>
            <div id="imageGridVideo"></div>
        `).window.document;
        context = vm.createContext({
            document,
            virtualBackgroundBlurLevel: null,
            virtualBackgroundSelectedImage: 'background.jpg',
            virtualBackgroundTransparent: null,
            virtualBackgrounds: ['background.jpg', 'other.jpg'],
            image: {},
            elemDisplay() {},
            show() {},
            hide() {},
            setTippy() {},
            saveImageUrlBtn: document.createElement('button'),
            cancelImageUrlBtn: document.createElement('button'),
            indexedDBHelper: { getAllImages: async () => ['data:image/png;base64,custom'] },
        });
        const source = fs.readFileSync(path.join(__dirname, '../public/js/RoomClient.js'), 'utf8');
        const methods = source.slice(
            source.indexOf('    syncVideoBackgroundSelection()'),
            source.indexOf('    async applyVirtualBackground(')
        );
        client = vm.runInContext(`new (class { ${methods} })()`, context);
        context.rc = client;
    });

    function selectedImages() {
        return [...document.querySelectorAll('.vb-selected')];
    }

    it('highlights the default image selected in prejoin when settings is built', () => {
        client.showVideoImageSelector();
        assert.deepEqual(
            selectedImages().map((img) => img.id),
            ['virtualBg0']
        );
        assert.equal(document.querySelectorAll('.image-wrapper:has(> img.vb-selected)').length, 1);
    });

    it('highlights the prejoin custom image after stored images load', async () => {
        context.virtualBackgroundSelectedImage = 'data:image/png;base64,custom';
        client.showVideoImageSelector();
        await Promise.resolve();
        assert.deepEqual(
            selectedImages().map((img) => img.getAttribute('src')),
            ['data:image/png;base64,custom']
        );
        assert.equal(document.querySelectorAll('.image-wrapper:has(> img.vb-selected)').length, 1);
    });

    it('refreshes an existing grid for blur, transparency and no background', () => {
        client.showVideoImageSelector();
        context.virtualBackgroundSelectedImage = null;
        for (const [blur, transparent, expected] of [
            [20, null, 'highBlurImg'],
            [10, null, 'lowBlurImg'],
            [null, true, 'transparentBg'],
            [null, null, 'cleanVbImg'],
        ]) {
            context.virtualBackgroundBlurLevel = blur;
            context.virtualBackgroundTransparent = transparent;
            client.showVideoImageSelector();
            assert.deepEqual(
                selectedImages().map((img) => img.id),
                [expected]
            );
            assert.equal(document.querySelectorAll('.image-wrapper:has(> img.vb-selected)').length, 1);
        }
    });
});

function createEnvironment(overrides = {}) {
    const processors = [];
    const generators = [];
    class MediaStreamTrackProcessor {
        constructor({ track }) {
            this.track = track;
            this.cancel = sinon.spy();
            this.readable = new ReadableStream({
                start: (controller) => {
                    this.controller = controller;
                },
                cancel: this.cancel,
            });
            processors.push(this);
        }
    }
    class MediaStreamTrackGenerator {
        constructor() {
            this.stop = sinon.spy();
            this.abort = sinon.spy();
            this.writable = new WritableStream({ abort: this.abort });
            generators.push(this);
        }
    }
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        window: { MediaStreamTrackProcessor, MediaStreamTrackGenerator, TransformStream },
        MediaStreamTrackProcessor,
        MediaStreamTrackGenerator,
        TransformStream,
        AbortController,
        MediaStream: class {
            constructor(tracks) {
                this.tracks = tracks;
            }
            getVideoTracks() {
                return this.tracks;
            }
        },
        ...overrides,
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/VirtualBackground.js'), 'utf8'), context);
    const background = vm.runInContext('new VirtualBackground()', context);
    background.initialized = true;
    background.segmentation = {};
    return { background, processors, generators };
}

function createCanvasEnvironment({ filters = true, webgl = true } = {}) {
    const contexts = [];
    const canvases = [];
    const videos = [];
    const setTimeout = sinon.stub().returns(1);
    const clearTimeout = sinon.spy();
    const document = {
        body: { appendChild: sinon.spy() },
        createElement(type) {
            if (type === 'video') {
                const video = {
                    style: {},
                    videoWidth: 1920,
                    videoHeight: 1080,
                    play: sinon.stub().resolves(),
                    pause: sinon.spy(),
                    remove: sinon.spy(),
                    setAttribute: sinon.spy(),
                };
                videos.push(video);
                return video;
            }
            const context = {
                save: sinon.spy(),
                restore: sinon.spy(),
                clearRect: sinon.spy(),
                drawImage: sinon.spy(),
                getImageData: sinon.stub().callsFake((x, y, width, height) => {
                    const data = new Uint8ClampedArray(width * height * 4);
                    for (let row = 0; row < height; row++) {
                        for (let column = 0; column < width; column++) {
                            const index = (row * width + column) * 4;
                            const value = column < width / 2 ? 0 : 255;
                            data[index] = value;
                            data[index + 1] = value;
                            data[index + 2] = value;
                            data[index + 3] = 255;
                        }
                    }
                    return { data, width, height };
                }),
                putImageData: sinon.spy(),
                ...(filters ? { filter: 'none' } : {}),
            };
            const track = { readyState: 'live', stop: sinon.spy() };
            const canvas = {
                getContext: (kind) => (kind === '2d' ? context : webgl ? {} : null),
                captureStream: sinon.stub().returns({ getVideoTracks: () => [track] }),
            };
            contexts.push(context);
            canvases.push(canvas);
            return canvas;
        },
    };
    const environment = createEnvironment({ window: {}, document, setTimeout, clearTimeout });
    environment.background.segmentation.send = sinon.stub().callsFake(async ({ image }) => {
        environment.background.handleSegmentationResults({ image, segmentationMask: {} });
    });
    const camera = {
        readyState: 'live',
        getSettings: () => ({ frameRate: 30 }),
        stop: sinon.spy(),
        addEventListener: sinon.spy(),
        removeEventListener: sinon.spy(),
    };
    return { ...environment, camera, contexts, canvases, videos, setTimeout, clearTimeout };
}

describe('Virtual background canvas fallback', () => {
    it('supports canvas capture without track APIs, but rejects environments without WebGL', () => {
        assert.equal(createCanvasEnvironment().background.isSupported, true);
        assert.equal(createCanvasEnvironment({ webgl: false }).background.isSupported, false);
        assert.equal(createEnvironment({ window: {} }).background.isSupported, false);
    });

    it('renders with the existing effect handler at up to 720p and 15 FPS', async () => {
        const { background, camera, processors, setTimeout } = createCanvasEnvironment();
        const handler = sinon.spy();
        const stream = await background.processStreamWithSegmentation(camera, handler);
        const { canvas, context, video } = background.activeCanvas;

        assert.equal(processors.length, 0);
        assert.equal(canvas.width, 1280);
        assert.equal(canvas.height, 720);
        assert.equal(canvas.captureStream.calledWith(15), true);
        assert.equal(stream.getVideoTracks()[0], background.activeOutputTrack);
        assert.equal(handler.calledWith(context, canvas, sinon.match.object, video), true);
        assert.equal(context.restore.calledOnce, true);
        assert.equal(setTimeout.firstCall.args[1], 1000 / 15);
        await background.stopCurrentProcessor();
    });

    it('stops output, timers and the hidden video without stopping the camera when switching effects', async () => {
        const { background, camera, videos, clearTimeout } = createCanvasEnvironment();
        const first = await background.processStreamWithSegmentation(camera, () => {});
        await background.processStreamWithSegmentation(camera, () => {});

        assert.equal(first.getVideoTracks()[0].stop.calledOnce, true);
        assert.equal(clearTimeout.calledWith(1), true);
        assert.equal(videos[0].pause.calledOnce, true);
        assert.equal(videos[0].remove.calledOnce, true);
        assert.equal(videos[0].srcObject, null);
        assert.equal(camera.stop.called, false);
        await background.stopCurrentProcessor();
    });

    it('ignores late segmentation results while waiting for in-flight work to finish', async () => {
        const { background, camera, contexts, setTimeout } = createCanvasEnvironment();
        await background.processStreamWithSegmentation(camera, () => {});
        const context = background.activeCanvas.context;
        let finish;
        background.segmentation.send = () => new Promise((resolve) => (finish = resolve));
        setTimeout.firstCall.args[0]();
        const stopping = background.stopCurrentProcessor();
        background.handleSegmentationResults({ segmentationMask: {} });
        assert.equal(context.drawImage.calledOnce, true);
        finish();
        await stopping;

        assert.equal(background.activeCanvas, null);
        assert.equal(background.isProcessing, false);
        assert.equal(contexts.includes(context), true);
        assert.equal(setTimeout.calledOnce, true);
    });

    it('cleans up when the source camera ends', async () => {
        const { background, camera } = createCanvasEnvironment();
        const stream = await background.processStreamWithSegmentation(camera, () => {});
        await camera.addEventListener.firstCall.args[1]();
        assert.equal(stream.getVideoTracks()[0].stop.calledOnce, true);
        assert.equal(camera.removeEventListener.calledOnce, true);
        assert.equal(background.activeCanvas, null);
    });

    it('approximates native blur with three box passes when canvas filters are unavailable', async () => {
        const { background, camera, canvases, contexts } = createCanvasEnvironment({ filters: false });
        await background.applyBlurToWebRTCStream(camera, 10);

        assert.equal(background.isSupported, true);
        assert.equal(canvases[2].width, 160);
        assert.equal(canvases[2].height, 90);
        assert.equal(contexts[2].drawImage.calledOnce, true);
        assert.equal(contexts[2].getImageData.calledOnce, true);
        assert.equal(contexts[2].putImageData.calledOnce, true);
        const blurredPixels = contexts[2].putImageData.firstCall.args[0].data;
        const centerPixel = (45 * 160 + 80) * 4;
        assert.ok(blurredPixels[centerPixel] > 0 && blurredPixels[centerPixel] < 255);
        assert.equal(background.activeCanvas.context.drawImage.calledThrice, true);

        await background.stopCurrentProcessor();
        await background.applyTransparentVirtualBackgroundToWebRTCStream(camera);
        assert.equal(background.activeCanvas.context.drawImage.calledThrice, true);
        await background.stopCurrentProcessor();
    });

    it('uses native canvas filters for blur when available', async () => {
        const { background, camera } = createCanvasEnvironment();
        await background.applyBlurToWebRTCStream(camera, 20);

        assert.equal(background.isSupported, true);
        assert.equal(background.activeCanvas.context.drawImage.calledThrice, true);
        await background.stopCurrentProcessor();
    });
});

describe('Virtual background pipeline cleanup', () => {
    it('cancels a locked pipeline and stops its output without stopping the source camera', async () => {
        const { background, processors, generators } = createEnvironment();
        const camera = { stop: sinon.spy() };
        await background.processStreamWithSegmentation(camera, () => {});
        assert.equal(processors[0].readable.locked, true);
        assert.equal(generators[0].writable.locked, true);

        await background.stopCurrentProcessor();

        assert.equal(processors[0].cancel.calledOnce, true);
        assert.equal(generators[0].abort.calledOnce, true);
        assert.equal(generators[0].stop.calledOnce, true);
        assert.equal(processors[0].readable.locked, false);
        assert.equal(generators[0].writable.locked, false);
        assert.equal(camera.stop.called, false);
        assert.equal(background.activeProcessor, null);
        assert.equal(background.activeGenerator, null);
        await background.stopCurrentProcessor();
        assert.equal(generators[0].stop.calledOnce, true);
    });

    it('finishes the previous pipeline and resets its mask before switching effects', async () => {
        const { background, processors, generators } = createEnvironment();
        const camera = { stop: sinon.spy() };
        await background.processStreamWithSegmentation(camera, () => {});
        background.frameCounter = 5;
        background.lastSegmentationMask = {};

        const stream = await background.processStreamWithSegmentation(camera, () => {});

        assert.equal(processors[0].cancel.calledOnce, true);
        assert.equal(generators[0].stop.calledOnce, true);
        assert.equal(stream.getVideoTracks()[0], generators[1]);
        assert.equal(background.activeProcessor, processors[1]);
        assert.equal(background.isProcessing, true);
        assert.equal(background.frameCounter, 0);
        assert.equal(background.lastSegmentationMask, null);
        await background.stopCurrentProcessor();
    });

    it('cleans up the generated track after a pipeline failure', async () => {
        const { background, processors, generators } = createEnvironment();
        await background.processStreamWithSegmentation({}, () => {});
        processors[0].controller.error(new Error('Camera failed'));
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(generators[0].stop.calledOnce, true);
        assert.equal(background.isProcessing, false);
        assert.equal(background.activeProcessor, null);
    });

    it('closes a bitmap created after shutdown without sending it to segmentation', async () => {
        let resolveBitmap;
        const bitmap = { close: sinon.spy() };
        const bitmapPromise = new Promise((resolve) => {
            resolveBitmap = resolve;
        });
        const createImageBitmap = sinon.stub().returns(bitmapPromise);
        const { background, processors } = createEnvironment({ createImageBitmap });
        background.segmentation.send = sinon.spy();
        await background.processStreamWithSegmentation({}, () => {});
        const frame = { close: sinon.spy() };
        processors[0].controller.enqueue(frame);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(createImageBitmap.calledOnce, true);

        const stopping = background.stopCurrentProcessor();
        resolveBitmap(bitmap);
        await stopping;

        assert.equal(frame.close.calledOnce, true);
        assert.equal(bitmap.close.calledOnce, true);
        assert.equal(background.segmentation.send.called, false);
    });

    it('waits for segmentation before closing its input and ignores its late result', async () => {
        let finishSegmentation;
        const bitmap = { close: sinon.spy() };
        const { background, processors } = createEnvironment({ createImageBitmap: async () => bitmap });
        background.segmentation.send = () =>
            new Promise((resolve) => {
                finishSegmentation = () => {
                    background.handleSegmentationResults({ segmentationMask: {} });
                    resolve();
                };
            });
        background.processFrame = sinon.spy();
        await background.processStreamWithSegmentation({}, () => {});
        const frame = { close: sinon.spy() };
        processors[0].controller.enqueue(frame);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(typeof finishSegmentation, 'function');

        const stopping = background.stopCurrentProcessor();
        assert.equal(bitmap.close.called, false);
        finishSegmentation();
        await stopping;

        assert.equal(frame.close.calledOnce, true);
        assert.equal(bitmap.close.calledOnce, true);
        assert.equal(background.processFrame.called, false);
        assert.equal(background.pendingFrames.length, 0);
        assert.equal(background.lastSegmentationMask, null);
    });
});

describe('Virtual background swapping', () => {
    function createFrameEnvironment() {
        const canvases = [];
        class OffscreenCanvas {
            constructor(width, height) {
                this.width = width;
                this.height = height;
                this.context = {
                    save: sinon.spy(),
                    restore: sinon.spy(),
                    clearRect: sinon.spy(),
                    drawImage: sinon.spy(),
                };
                canvases.push(this);
            }
            getContext() {
                return this.context;
            }
        }
        class VideoFrame {
            constructor(source, init) {
                this.source = source;
                this.timestamp = init.timestamp;
            }
            close() {
                this.closed = true;
            }
        }
        const environment = createEnvironment({
            OffscreenCanvas,
            VideoFrame,
            createImageBitmap: async () => ({ close: sinon.spy() }),
        });
        environment.background.segmentation.send = sinon.stub().callsFake(async () => {
            environment.background.handleSegmentationResults({ segmentationMask: { mask: true } });
        });
        return { ...environment, canvases };
    }

    function createFrame(timestamp) {
        return { displayWidth: 640, displayHeight: 360, timestamp, close: sinon.spy() };
    }

    const flush = () => new Promise((resolve) => setImmediate(resolve));

    it('swaps the effect on the running pipeline without restarting it', async () => {
        const { background, processors, generators } = createEnvironment();
        const camera = { readyState: 'live', stop: sinon.spy() };
        const first = sinon.spy();
        const second = sinon.spy();
        const stream = await background.processStreamWithSegmentation(camera, first);
        background.lastSegmentationMask = { mask: true };
        background.createMaskHandler = sinon.stub().resolves(second);

        assert.equal(await background.setBackground(camera, { blurLevel: 20 }), true);
        assert.equal(background.createMaskHandler.calledOnceWith({ blurLevel: 20 }), true);
        assert.equal(background.activeMaskHandler, second);
        assert.equal(await background.applyBlurToWebRTCStream(camera, 10), stream);
        assert.equal(processors.length, 1);
        assert.equal(generators[0].stop.called, false);
        assert.equal(processors[0].cancel.called, false);
        assert.deepEqual(background.lastSegmentationMask, { mask: true });
        assert.equal(camera.stop.called, false);
        await background.stopCurrentProcessor();
    });

    it('refuses to swap without a running pipeline for the same live camera', async () => {
        const { background } = createEnvironment();
        const camera = { readyState: 'live' };
        background.createMaskHandler = sinon.stub().resolves(() => {});

        assert.equal(await background.setBackground(camera, { blurLevel: 10 }), false);
        await background.processStreamWithSegmentation(camera, () => {});
        assert.equal(await background.setBackground({ readyState: 'live' }, { blurLevel: 10 }), false);
        camera.readyState = 'ended';
        assert.equal(await background.setBackground(camera, { blurLevel: 10 }), false);
        camera.readyState = 'live';
        await background.stopCurrentProcessor();
        assert.equal(await background.setBackground(camera, { blurLevel: 10 }), false);
        assert.equal(background.createMaskHandler.called, false);
    });

    it('keeps the newest selection when an older background finishes loading later', async () => {
        const { background } = createEnvironment();
        const camera = { readyState: 'live' };
        await background.processStreamWithSegmentation(camera, () => {});
        const slow = () => {};
        const fast = () => {};
        let finishSlow;
        background.createMaskHandler = sinon.stub();
        background.createMaskHandler.onFirstCall().returns(new Promise((resolve) => (finishSlow = resolve)));
        background.createMaskHandler.onSecondCall().resolves(fast);

        const older = background.setBackground(camera, { imageUrl: 'big.jpg' });
        assert.equal(await background.setBackground(camera, { blurLevel: 10 }), true);
        finishSlow(slow);
        assert.equal(await older, true);
        assert.equal(background.activeMaskHandler, fast);
        await background.stopCurrentProcessor();
    });

    it('renders every frame with the current effect on one reused canvas', async () => {
        const { background, processors, canvases } = createFrameEnvironment();
        const first = sinon.spy((ctx) => (ctx.globalCompositeOperation = 'destination-over'));
        const second = sinon.spy();
        await background.processStreamWithSegmentation({ readyState: 'live' }, first);

        processors[0].controller.enqueue(createFrame(1));
        await flush();
        background.activeMaskHandler = second;
        processors[0].controller.enqueue(createFrame(2));
        await flush();

        assert.equal(background.segmentation.send.calledOnce, true);
        assert.equal(first.calledOnce, true);
        assert.equal(second.calledOnceWith(canvases[0].context, canvases[0]), true);
        assert.deepEqual(second.firstCall.args[2], { mask: true });
        assert.equal(canvases.length, 1);
        assert.equal(canvases[0].context.save.calledTwice, true);
        assert.equal(canvases[0].context.restore.calledTwice, true);
        assert.equal(canvases[0].context.clearRect.calledTwice, true);
        await background.stopCurrentProcessor();
    });

    it('swaps the effect of the canvas fallback without restarting the camera video', async () => {
        const { background, camera, videos, setTimeout } = createCanvasEnvironment();
        const first = sinon.spy();
        const second = sinon.spy();
        const stream = await background.processStreamWithSegmentation(camera, first);
        background.createMaskHandler = sinon.stub().resolves(second);

        assert.equal(await background.applyVirtualBackgroundToWebRTCStream(camera, 'beach.jpg'), stream);
        await setTimeout.firstCall.args[0]();

        assert.equal(videos.length, 1);
        assert.equal(first.calledOnce, true);
        assert.equal(second.calledOnce, true);
        assert.equal(stream.getVideoTracks()[0].stop.called, false);
        await background.stopCurrentProcessor();
    });

    it('fills the frame with the background without stretching it', () => {
        const { background } = createEnvironment();
        const ctx = { drawImage: sinon.spy() };
        const square = { naturalWidth: 1000, naturalHeight: 1000 };

        background.drawCover(ctx, square, 1280, 720);
        assert.deepEqual(ctx.drawImage.firstCall.args, [square, 0, 218.75, 1000, 562.5, 0, 0, 1280, 720]);

        const portraitGif = { width: 200, height: 400 };
        background.drawCover(ctx, portraitGif, 400, 400);
        assert.deepEqual(ctx.drawImage.secondCall.args, [portraitGif, 0, 100, 200, 200, 0, 0, 400, 400]);

        const unknown = {};
        background.drawCover(ctx, unknown, 640, 360);
        assert.deepEqual(ctx.drawImage.thirdCall.args, [unknown, 0, 0, 640, 360]);
    });

    it('stops a running GIF background when another background is chosen', async () => {
        const { background } = createEnvironment();
        const animation = { stop: sinon.spy() };
        background.gifAnimation = animation;
        background.createBlurMaskHandler(10);
        assert.equal(animation.stop.calledOnce, true);
        assert.equal(background.gifAnimation, null);
    });
});

describe('Room client virtual background switching', () => {
    function createClient({ sourceTrack = { readyState: 'live' }, swapped = true } = {}) {
        const context = vm.createContext({
            console: { log() {}, warn() {}, error() {} },
            virtualBackgroundBlurLevel: 10,
            virtualBackgroundSelectedImage: null,
            virtualBackgroundTransparent: null,
            virtualBackground: {
                setBackground: sinon.stub().resolves(swapped),
                stopCurrentProcessor: sinon.stub().resolves(),
            },
            videoSelect: { onchange: sinon.spy() },
            saveVirtualBackgroundSettings: sinon.spy(),
        });
        const source = fs.readFileSync(path.join(__dirname, '../public/js/RoomClient.js'), 'utf8');
        const methods = source.slice(
            source.indexOf('    async applyVirtualBackground('),
            source.indexOf('    // Stop the virtual background pipeline and the camera that fed it')
        );
        const client = vm.runInContext(`new (class { syncVideoBackgroundSelection() {} ${methods} })()`, context);
        client.videoBackgroundSourceTrack = sourceTrack;
        return { client, context };
    }

    it('swaps between backgrounds without re-producing the camera', async () => {
        const { client, context } = createClient();
        await client.applyVirtualBackground(null, 'beach.jpg', null);

        assert.equal(
            context.virtualBackground.setBackground.calledOnceWith(client.videoBackgroundSourceTrack, {
                blurLevel: null,
                imageUrl: 'beach.jpg',
                transparent: null,
            }),
            true
        );
        assert.equal(context.videoSelect.onchange.called, false);
        assert.equal(context.virtualBackgroundSelectedImage, 'beach.jpg');
        assert.equal(context.virtualBackgroundBlurLevel, null);
        assert.equal(context.saveVirtualBackgroundSettings.calledOnceWith(null, 'beach.jpg', null), true);
    });

    it('restarts the camera when no pipeline can be swapped, the swap fails or the background is removed', async () => {
        let { client, context } = createClient({ sourceTrack: null });
        await client.applyVirtualBackground(20, null, null);
        assert.equal(context.virtualBackground.setBackground.called, false);
        assert.equal(context.videoSelect.onchange.calledOnce, true);

        ({ client, context } = createClient({ swapped: false }));
        await client.applyVirtualBackground(null, null, true);
        assert.equal(context.videoSelect.onchange.calledOnce, true);

        ({ client, context } = createClient());
        context.virtualBackground.setBackground = sinon.stub().rejects(new Error('Image failed'));
        await client.applyVirtualBackground(null, 'broken.jpg', null);
        assert.equal(context.videoSelect.onchange.calledOnce, true);

        ({ client, context } = createClient());
        await client.applyVirtualBackground(null, null, null);
        assert.equal(context.virtualBackground.setBackground.called, false);
        assert.equal(context.virtualBackground.stopCurrentProcessor.calledOnce, true);
        assert.equal(context.videoSelect.onchange.calledOnce, true);
    });
});

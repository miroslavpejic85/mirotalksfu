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

    it('rejects blur without canvas filters while keeping image and transparency support', async () => {
        const { background, camera } = createCanvasEnvironment({ filters: false });
        await assert.rejects(background.applyBlurToWebRTCStream(camera), /blur is not supported/);
        assert.equal(background.isSupported, true);
        await background.applyTransparentVirtualBackgroundToWebRTCStream(camera);
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

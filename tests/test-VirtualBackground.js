'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');
const { ReadableStream, WritableStream, TransformStream } = require('stream/web');

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

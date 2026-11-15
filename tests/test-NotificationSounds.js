'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');

const soundsSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'Sounds.js'), 'utf8');
const quietConsole = { log() {}, info() {}, warn() {}, error() {} };
const flush = () => new Promise((resolve) => setImmediate(resolve));

function createEnv({ fetchOk = true, initialState = 'suspended' } = {}) {
    const listeners = new Map();
    const contexts = [];
    const sources = [];

    class FakeAudioContext {
        constructor() {
            this.state = initialState;
            this.destination = {};
            this.resume = sinon.stub().callsFake(() => {
                this.state = 'running';
                return Promise.resolve();
            });
            contexts.push(this);
        }
        decodeAudioData(data, resolve) {
            resolve({ decoded: data });
        }
        createGain() {
            return { gain: { value: 1 }, connect: sinon.stub(), disconnect: sinon.stub() };
        }
        createBufferSource() {
            const source = { connect: sinon.stub(), disconnect: sinon.stub(), start: sinon.stub() };
            sources.push(source);
            return source;
        }
    }

    const window = {
        AudioContext: FakeAudioContext,
        addEventListener: (type, fn) => listeners.set(type, fn),
        removeEventListener: (type) => listeners.delete(type),
    };
    const fetch = sinon
        .stub()
        .callsFake((url) =>
            Promise.resolve({ ok: fetchOk, status: fetchOk ? 200 : 404, arrayBuffer: () => Promise.resolve(url) })
        );
    const context = vm.createContext({ window, fetch, console: quietConsole });
    vm.runInContext(soundsSource, context);
    return { sounds: window.NotificationSounds, listeners, contexts, sources, fetch };
}

describe('NotificationSounds (low-latency notification sounds)', () => {
    it('waits for a user gesture before creating the AudioContext', () => {
        const { listeners, contexts, sounds } = createEnv();
        assert.deepEqual([...listeners.keys()].sort(), ['click', 'keydown', 'pointerup', 'touchend']);
        assert.equal(contexts.length, 0);
        assert.equal(sounds.play('../sounds/open.wav'), false);
    });

    it('preloads frequent sounds on the first gesture and plays them from the decoded buffer', async () => {
        const { listeners, contexts, sources, fetch, sounds } = createEnv();
        listeners.get('click')();
        assert.equal(contexts.length, 1);
        sinon.assert.calledOnce(contexts[0].resume);
        assert(fetch.calledWith('../sounds/open.wav'));
        await flush();
        assert.equal(listeners.size, 0, 'unlock listeners removed once running');

        assert.equal(sounds.play('../sounds/open.wav', 0.5), true);
        assert.equal(sources.length, 1);
        sinon.assert.calledOnceWithExactly(sources[0].start, 0);
        assert.deepEqual(sources[0].buffer, { decoded: '../sounds/open.wav' });
    });

    it('loads sounds that are not preloaded on first use and falls back meanwhile', async () => {
        const { listeners, fetch, sounds } = createEnv();
        listeners.get('click')();
        await flush();
        const url = '../sounds/emoji/applause.mp3';
        assert.equal(sounds.play(url), false);
        sinon.assert.calledWith(fetch, url);
        await flush();
        assert.equal(sounds.play(url), true);
    });

    it('does not queue playback on a suspended context and re-arms the gesture unlock', async () => {
        const { listeners, contexts, sounds } = createEnv();
        listeners.get('click')();
        await flush();
        contexts[0].state = 'interrupted';
        assert.equal(sounds.play('../sounds/open.wav'), false);
        sinon.assert.calledTwice(contexts[0].resume);
        assert.equal(listeners.size, 4);
    });

    it('does not refetch sounds that failed to load', async () => {
        const { listeners, fetch, sounds } = createEnv({ fetchOk: false });
        listeners.get('click')();
        await flush();
        const calls = fetch.callCount;
        assert.equal(sounds.play('../sounds/open.wav'), false);
        assert.equal(fetch.callCount, calls);
    });
});

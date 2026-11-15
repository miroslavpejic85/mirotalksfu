'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const helpersSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/Helpers.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/RoomClient.js'), 'utf8');

function makeTrack(id, kind = 'audio') {
    return {
        id,
        kind,
        readyState: 'live',
        stop() {
            this.readyState = 'ended';
        },
    };
}

class FakeMediaStream {
    constructor(tracks = []) {
        this.tracks = [];
        tracks.forEach((track) => this.addTrack(track));
    }
    addTrack(track) {
        if (!this.tracks.includes(track)) this.tracks.push(track);
    }
    getTracks() {
        return [...this.tracks];
    }
    getAudioTracks() {
        return this.tracks.filter((track) => track.kind === 'audio');
    }
}

function createHarness() {
    const audioElements = [];
    const destinationTrack = makeTrack('mix-output');
    const contexts = [];

    class FakeAudioContext {
        constructor() {
            this.destination = { name: 'speakers' };
            this.sources = [];
            this.closed = false;
            contexts.push(this);
        }
        createGain() {
            return { gain: { value: 1 }, connect() {}, disconnect() {} };
        }
        createMediaStreamDestination() {
            return { stream: new FakeMediaStream([destinationTrack]), disconnect() {} };
        }
        createMediaStreamSource(stream) {
            const source = {
                track: stream.getAudioTracks()[0],
                connected: [],
                connect(node) {
                    this.connected.push(node);
                },
                disconnect() {
                    this.connected = [];
                },
            };
            this.sources.push(source);
            return source;
        }
        close() {
            this.closed = true;
        }
    }

    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        MediaStream: FakeMediaStream,
        window: { AudioContext: FakeAudioContext },
        AudioContext: FakeAudioContext,
        document: { querySelectorAll: (selector) => (selector === 'audio' ? [...audioElements] : []) },
    });
    vm.runInContext(
        `${helpersSource}; ${clientSource}; globalThis.Client = RoomClient; globalThis.Mixer = MixedAudioRecorder;`,
        context
    );

    const client = Object.create(context.Client.prototype);
    client.localAudioStream = null;
    client.audioRecorder = null;

    const addAudioElement = (track, attrs = {}) => {
        const elem = {
            id: attrs.id || `audio-${track.id}`,
            srcObject: new FakeMediaStream([track]),
            getAttribute: (name) => attrs[name] || null,
        };
        audioElements.push(elem);
        return elem;
    };
    const removeAudioElement = (elem) => audioElements.splice(audioElements.indexOf(elem), 1);

    const mixedIds = () => [...client.audioRecorder.audioSources.keys()].sort();

    return { context, client, contexts, destinationTrack, addAudioElement, removeAudioElement, mixedIds };
}

function startMix(harness) {
    const { client, context } = harness;
    client.audioRecorder = new context.Mixer();
    const tracks = client.getAudioStreamFromAudioElements().getTracks();
    return client.audioRecorder.getMixedAudioStream(tracks.map((track) => new FakeMediaStream([track])));
}

describe('Recording audio mix', () => {
    it('adds participants who join after the recording started', () => {
        const harness = createHarness();
        const { client, addAudioElement, mixedIds, destinationTrack } = harness;
        addAudioElement(makeTrack('alice'));
        const mixStream = startMix(harness);
        assert.deepEqual(mixedIds(), ['alice']);

        addAudioElement(makeTrack('bob'));
        client.syncRecordingAudio();

        assert.deepEqual(mixedIds(), ['alice', 'bob']);
        // The recorded output track never changes, so MediaRecorder keeps running
        assert.equal(mixStream.getAudioTracks()[0], destinationTrack);
        assert.equal(client.audioRecorder.audioDestination.stream.getAudioTracks()[0], destinationTrack);
    });

    it('replaces re-created consumers and drops stopped tracks', () => {
        const harness = createHarness();
        const { client, addAudioElement, removeAudioElement, mixedIds } = harness;
        const oldTrack = makeTrack('alice-old');
        const oldElem = addAudioElement(oldTrack);
        startMix(harness);

        // Mic change / screen audio / transport recovery: consumer removed and created again
        oldTrack.stop();
        removeAudioElement(oldElem);
        client.syncRecordingAudio();
        assert.deepEqual(mixedIds(), []);

        addAudioElement(makeTrack('alice-new'));
        client.syncRecordingAudio();
        assert.deepEqual(mixedIds(), ['alice-new']);
    });

    it('follows local microphone replacements without duplicating the same track', () => {
        const harness = createHarness();
        const { client, addAudioElement, mixedIds } = harness;
        const mic = makeTrack('mic-1');
        client.localAudioStream = new FakeMediaStream([mic]);
        addAudioElement(mic, { name: 'LOCAL-AUDIO' });
        startMix(harness);
        assert.deepEqual(mixedIds(), ['mic-1']);

        mic.stop();
        client.localAudioStream = new FakeMediaStream([makeTrack('mic-2')]);
        client.syncRecordingAudio();
        assert.deepEqual(mixedIds(), ['mic-2']);
    });

    it('ignores sync when no recording is active and releases the mixer once', () => {
        const harness = createHarness();
        const { client, addAudioElement, contexts } = harness;
        addAudioElement(makeTrack('alice'));
        client.syncRecordingAudio();
        assert.equal(client.audioRecorder, null);

        startMix(harness);
        client.releaseRecordingAudioMixer();
        assert.equal(client.audioRecorder, null);
        assert.equal(contexts[0].closed, true);
        client.releaseRecordingAudioMixer();
        client.syncRecordingAudio();
    });

    it('stopMixedAudioStream is idempotent and stops accepting tracks', () => {
        const harness = createHarness();
        const mixer = new harness.context.Mixer();
        mixer.getMixedAudioStream([new FakeMediaStream([makeTrack('alice')])]);
        mixer.stopMixedAudioStream();
        assert.doesNotThrow(() => mixer.stopMixedAudioStream());
        assert.equal(mixer.addTrack(makeTrack('bob')), false);
        assert.equal(mixer.audioSources.size, 0);
    });

    it('skips non-audio and ended tracks', () => {
        const harness = createHarness();
        const mixer = new harness.context.Mixer();
        const ended = makeTrack('ended');
        ended.stop();
        mixer.getMixedAudioStream([new FakeMediaStream([makeTrack('video', 'video'), ended, makeTrack('alice')])]);
        assert.deepEqual([...mixer.audioSources.keys()], ['alice']);
    });
});

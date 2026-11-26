'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');

const roomClientSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'RoomClient.js'), 'utf8');

class FakeMediaStream {
    constructor(tracks = []) {
        this.tracks = [...tracks];
    }
    getTracks() {
        return this.tracks;
    }
    getAudioTracks() {
        return this.tracks.filter((t) => t.kind === 'audio');
    }
    getVideoTracks() {
        return this.tracks.filter((t) => t.kind === 'video');
    }
}

const track = (kind) => ({ kind, readyState: 'live', stop: sinon.spy(), ...(kind === 'video' && { contentHint: '' }) });

describe('Share a video/audio file from the device', () => {
    let dom;
    let document;
    let RoomClientProto;
    let revokeObjectURL;

    beforeEach(() => {
        dom = new JSDOM('<!doctype html><html><body><div id="videoMediaContainer"></div></body></html>');
        document = dom.window.document;
        revokeObjectURL = sinon.spy();
        const context = vm.createContext({
            window: dom.window,
            document,
            MediaStream: FakeMediaStream,
            URL: { revokeObjectURL },
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
            handleAspectRatio: () => {},
            console: { log() {}, info() {}, warn() {}, error() {} },
        });
        vm.runInContext(`${roomClientSource}; globalThis.RoomClientForTest = RoomClient;`, context);
        RoomClientProto = context.RoomClientForTest.prototype;
    });

    afterEach(() => {
        sinon.restore();
        dom.window.close();
    });

    function addProducer(client, id, type, kind) {
        const producer = {
            id,
            kind,
            closed: false,
            track: track(kind),
            replaceTrack: sinon.stub().resolves(),
            close() {},
        };
        client.producers.set(id, producer);
        client.producerLabel.set(type, id);
        const elem = document.createElement(kind === 'video' ? 'video' : 'audio');
        elem.id = id;
        elem.srcObject = new FakeMediaStream([producer.track]);
        return { producer, elem };
    }

    function createClient() {
        const client = Object.create(RoomClientProto);
        client.producers = new Map();
        client.producerLabel = new Map();
        client.peer_info = { peer_screen: true };
        client.socket = { emit: sinon.spy() };
        client.videoMediaContainer = document.getElementById('videoMediaContainer');
        client.localAudioEl = document.body;
        client.isVideoPinned = false;
        client.setIsScreen = sinon.spy();
        client.event = () => {};
        client.sound = () => {};
        client.releaseScreenCamera = () => {};
        client.syncRecordingAudio = () => {};
        client.produceScreenAudio = sinon.spy();
        const source = { pause: sinon.spy(), removeAttribute: sinon.spy(), load: sinon.spy() };
        client.localFileShare = { url: 'blob:file', source, captured: new FakeMediaStream(), canvasTrack: null };
        return client;
    }

    it('swaps in the new tracks when the finished file plays again, keeping the share alive', async () => {
        const client = createClient();
        const screen = addProducer(client, 'screen1', 'screenType', 'video');
        const tab = addProducer(client, 'tab1', 'audioTab', 'audio');
        const tile = document.createElement('div');
        tile.append(screen.elem, tab.elem);
        client.videoMediaContainer.appendChild(tile);

        const video = track('video');
        const audio = track('audio');
        client.replaceLocalFileShareTrack(video);
        client.replaceLocalFileShareTrack(audio);
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(screen.producer.replaceTrack.firstCall.args[0].track, video);
        assert.equal(tab.producer.replaceTrack.firstCall.args[0].track, audio);
        assert.equal(video.contentHint, 'motion');
        assert.deepEqual(screen.elem.srcObject.getTracks(), [video], 'sharer preview follows the new track');
        assert.deepEqual(tab.elem.srcObject.getTracks(), [audio]);
    });

    it('re-publishes the file audio if its producer is gone, and ignores video for audio-only files', () => {
        const client = createClient();
        const screen = addProducer(client, 'screen1', 'screenType', 'video');
        client.localFileShare.canvasTrack = track('video');

        const audio = track('audio');
        client.replaceLocalFileShareTrack(audio);
        assert.deepEqual(client.produceScreenAudio.firstCall.args[0].getTracks(), [audio]);

        client.replaceLocalFileShareTrack(track('video'));
        assert.equal(screen.producer.replaceTrack.called, false, 'the waveform canvas stays the video track');
    });

    it('stopping the screen share stops the file playback and releases it', () => {
        const client = createClient();
        const screen = addProducer(client, 'screen1', 'screenType', 'video');
        const tab = addProducer(client, 'tab1', 'audioTab', 'audio');
        const tile = document.createElement('div');
        tile.id = 'screen1__video';
        const vb = document.createElement('div');
        vb.id = 'screen1__vb';
        tile.append(screen.elem, vb);
        client.videoMediaContainer.appendChild(tile);
        document.body.appendChild(tab.elem);
        const { source } = client.localFileShare;

        client.stopLocalFileShare();

        assert.equal(client.localFileShare, null);
        assert.equal(client.producerLabel.size, 0, 'screen and file audio producers closed');
        assert.ok(source.pause.calledOnce);
        assert.ok(source.removeAttribute.calledWith('src'));
        assert.ok(revokeObjectURL.calledWith('blob:file'));
        assert.equal(document.getElementById('screen1__video'), null);
    });
});

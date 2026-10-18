'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');

const roomClientSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'RoomClient.js'), 'utf8');

function domError(name) {
    const err = new Error(name);
    err.name = name;
    return err;
}

describe('remote audio autoplay unlock (Safari autoplay policy)', () => {
    let dom;
    let window;
    let document;
    let RoomClientProto;

    beforeEach(() => {
        dom = new JSDOM('<!doctype html><html><body><div id="remoteAudio"></div></body></html>');
        window = dom.window;
        document = window.document;
        const context = vm.createContext({
            window,
            document,
            setTimeout,
            console: { log() {}, info() {}, warn() {}, error() {} },
        });
        vm.runInContext(`${roomClientSource}; globalThis.RoomClientForTest = RoomClient;`, context);
        RoomClientProto = context.RoomClientForTest.prototype;
    });

    afterEach(() => dom.window.close());

    function createClient() {
        const client = Object.create(RoomClientProto);
        client.remoteAudioEl = document.getElementById('remoteAudio');
        client.blockedAudioElements = new Set();
        client.audioUnlockPrompt = null;
        client.audioUnlockListening = false;
        client.onAudioUnlockGesture = () => client.unlockBlockedAudio();
        client.onAudioVisibilityChange = () => {};
        return client;
    }

    function createAudio(client, peerName, play) {
        const elem = document.createElement('audio');
        elem._peerName = peerName;
        elem.play = sinon.stub().callsFake(play);
        client.remoteAudioEl.appendChild(elem);
        return elem;
    }

    const blocked = () => Promise.reject(domError('NotAllowedError'));
    const allowed = () => Promise.resolve();
    const prompt = () => document.getElementById('audioUnlockPrompt');

    it('shows a contextual prompt when playback is blocked and recovers on the next user gesture', async () => {
        const client = createClient();
        const elem = createAudio(client, 'Bob', blocked);

        assert.equal(await client.playRemoteAudio(elem), false);
        assert.ok(client.blockedAudioElements.has(elem));
        assert.ok(prompt().classList.contains('is-visible'));
        assert.equal(prompt().textContent, 'Enable audio to hear Bob');
        assert.equal(prompt().getAttribute('aria-label'), 'Enable audio to hear Bob');

        elem.play.callsFake(allowed);
        window.dispatchEvent(new window.MouseEvent('click'));
        assert.equal(elem.play.callCount, 2, 'play() must run synchronously inside the gesture');
        await new Promise(setImmediate);

        assert.equal(client.blockedAudioElements.size, 0);
        assert.equal(prompt().classList.contains('is-visible'), false);
        assert.equal(client.audioUnlockListening, false);

        window.dispatchEvent(new window.MouseEvent('click'));
        assert.equal(elem.play.callCount, 2, 'gesture listeners are removed once audio plays');
    });

    it('uses a generic label when several participants are blocked and unlocks them with one tap', async () => {
        const client = createClient();
        const bob = createAudio(client, 'Bob', blocked);
        const alice = createAudio(client, 'Alice', blocked);

        await Promise.all([client.playRemoteAudio(bob), client.playRemoteAudio(alice)]);
        assert.equal(prompt().textContent, 'Enable audio to hear participants');

        bob.play.callsFake(allowed);
        alice.play.callsFake(allowed);
        prompt().click();
        await new Promise(setImmediate);

        assert.equal(client.blockedAudioElements.size, 0);
        assert.equal(prompt().classList.contains('is-visible'), false);
    });

    it('keeps the prompt while the gesture still cannot start playback', async () => {
        const client = createClient();
        const elem = createAudio(client, 'Bob', blocked);
        await client.playRemoteAudio(elem);

        window.dispatchEvent(new window.Event('touchend'));
        await new Promise(setImmediate);

        assert.ok(client.blockedAudioElements.has(elem));
        assert.ok(prompt().classList.contains('is-visible'));
        assert.equal(client.audioUnlockListening, true);
    });

    it('ignores non-policy errors and detached elements', async () => {
        const client = createClient();
        const aborted = createAudio(client, 'Bob', () => Promise.reject(domError('AbortError')));
        assert.equal(await client.playRemoteAudio(aborted), false);
        assert.equal(client.blockedAudioElements.size, 0);
        assert.equal(prompt(), null);

        const detached = createAudio(client, 'Carol', blocked);
        detached.remove();
        assert.equal(await client.playRemoteAudio(detached), false);
        assert.equal(detached.play.callCount, 0);
        assert.equal(client.blockedAudioElements.size, 0);
    });

    it('hides the prompt when the blocked participant leaves', async () => {
        const client = createClient();
        const elem = createAudio(client, 'Bob', blocked);
        await client.playRemoteAudio(elem);

        elem.remove();
        client.updateAudioUnlockPrompt();

        assert.equal(client.blockedAudioElements.size, 0);
        assert.equal(prompt().classList.contains('is-visible'), false);
        assert.equal(client.audioUnlockListening, false);
    });

    it('resumes audio interrupted while the page was hidden', async () => {
        const client = createClient();
        const elem = createAudio(client, 'Bob', allowed);
        elem.srcObject = {};
        sinon.stub(elem, 'paused').get(() => true);

        client.resumeInterruptedAudio();
        await new Promise(setImmediate);

        assert.equal(elem.play.callCount, 1);
    });

    it('translates the prompt label', async () => {
        window.i18n = { t: (key) => (key === 'Enable audio to hear {name}' ? 'Attiva audio per {name}' : key) };
        const client = createClient();
        const elem = createAudio(client, 'Bob', blocked);
        await client.playRemoteAudio(elem);
        assert.equal(prompt().textContent, 'Attiva audio per Bob');
    });

    it('tears everything down on exit', async () => {
        const client = createClient();
        const elem = createAudio(client, 'Bob', blocked);
        await client.playRemoteAudio(elem);

        client.teardownAudioUnlock();

        assert.equal(prompt(), null);
        assert.equal(client.blockedAudioElements.size, 0);
        assert.equal(client.audioUnlockListening, false);
    });
});

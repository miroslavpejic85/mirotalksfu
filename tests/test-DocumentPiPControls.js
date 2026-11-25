'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const roomClientSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/RoomClient.js'), 'utf8');

const mainHtml = `
<style>.hidden { display: none; }</style>
<div id="bottomButtons">
    <div class="split-btn">
        <button id="startAudioButton"><i class="fas fa-microphone-slash"></i></button>
        <button id="stopAudioButton" class="hidden"><i class="fas fa-microphone"></i></button>
    </div>
    <div class="split-btn">
        <button id="startVideoButton" class="hidden"><i class="fas fa-video-slash"></i></button>
        <button id="stopVideoButton"><i class="fas fa-video"></i></button>
    </div>
    <div id="raiseHandSplit" class="split-btn">
        <button id="raiseHandButton"><i class="fas fa-hand-paper"></i></button>
        <button id="lowerHandButton" class="hidden"><i class="fas fa-hand-paper"></i></button>
    </div>
    <div id="exitDropdown">
        <button id="exitButton"><i class="fa-solid fa-phone-slash"></i></button>
    </div>
</div>`;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('document PiP controls', () => {
    let dom;
    let pipDom;
    let window;
    let pipWindow;
    let controls;
    let calls;

    beforeEach(() => {
        dom = new JSDOM(mainHtml, { runScripts: 'outside-only' });
        pipDom = new JSDOM('');
        window = dom.window;
        pipWindow = pipDom.window;
        calls = { leave: 0, ptt: [], pipClosed: 0 };
        window.isPushToTalkActive = false;
        window.setPushToTalkPressed = (pressed) => calls.ptt.push(pressed);
        window.leaveRoom = () => calls.leave++;
        window.focus = () => {};
        pipWindow.close = () => calls.pipClosed++;
        window.eval(`${roomClientSource}\nwindow.RoomClientForTest = RoomClient;`);

        const client = Object.create(window.RoomClientForTest.prototype);
        client.getId = (id) => window.document.getElementById(id);
        controls = client.createDocumentPipControls(pipWindow);
        pipWindow.document.body.append(controls.element);
    });

    afterEach(() => {
        controls.destroy();
        dom.window.close();
        pipDom.window.close();
    });

    const main = (id) => window.document.getElementById(id);
    const pip = (id) => pipWindow.document.getElementById(id);

    it('mirrors the main toolbar state, icons and visibility', async () => {
        assert.ok(pip('pipAudioButton').classList.contains('muted'));
        assert.equal(pip('pipAudioButton').firstChild.className, 'fas fa-microphone-slash');
        assert.equal(pip('pipAudioButton').title, 'Start the audio');
        assert.ok(!pip('pipVideoButton').classList.contains('muted'));
        assert.ok(!pip('pipHandButton').classList.contains('raised'));

        main('startAudioButton').classList.add('hidden');
        main('stopAudioButton').classList.remove('hidden');
        main('raiseHandButton').classList.add('hidden');
        main('lowerHandButton').classList.remove('hidden');
        main('stopVideoButton').disabled = true;
        await flush();

        assert.ok(!pip('pipAudioButton').classList.contains('muted'));
        assert.equal(pip('pipAudioButton').firstChild.className, 'fas fa-microphone');
        assert.equal(pip('pipAudioButton').title, 'Stop the audio');
        assert.ok(pip('pipHandButton').classList.contains('raised'));
        assert.ok(pip('pipVideoButton').disabled);

        main('raiseHandSplit').classList.add('hidden');
        await flush();

        assert.ok(pip('pipHandButton').hidden);
    });

    it('proxies clicks to the visible main toolbar button', () => {
        let clicked = [];
        ['startAudioButton', 'stopAudioButton', 'stopVideoButton', 'raiseHandButton'].forEach((id) =>
            main(id).addEventListener('click', () => clicked.push(id))
        );

        pip('pipAudioButton').click();
        pip('pipHandButton').click();
        assert.deepEqual(clicked, ['startAudioButton', 'raiseHandButton']);

        clicked = [];
        main('stopVideoButton').disabled = true;
        pip('pipVideoButton').disabled = false;
        pip('pipVideoButton').click();
        assert.deepEqual(clicked, []);
    });

    it('drives push-to-talk from the PiP mic button', () => {
        window.isPushToTalkActive = true;
        const button = pip('pipAudioButton');
        button.setPointerCapture = () => {};

        button.dispatchEvent(new pipWindow.Event('pointerdown'));
        button.dispatchEvent(new pipWindow.Event('pointerup'));

        assert.deepEqual(calls.ptt, [true, false]);
    });

    it('closes the PiP window and leaves the room', () => {
        pip('pipLeaveButton').click();

        assert.equal(calls.pipClosed, 1);
        assert.equal(calls.leave, 1);
        assert.ok(pip('pipLeaveButton').classList.contains('leave'));
    });
});

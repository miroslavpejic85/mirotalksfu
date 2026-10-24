'use strict';

// npx mocha tests/test-ScreenCameraLayout.js

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/js/ScreenCameraLayout.js'), 'utf8');
const roomSource = fs.readFileSync(path.join(root, 'public/js/Room.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'public/js/RoomClient.js'), 'utf8');
const drawingSource = fs.readFileSync(path.join(root, 'public/js/VideoDrawing.js'), 'utf8');
const storageSource = fs.readFileSync(path.join(root, 'public/js/LocalStorage.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/views/Room.html'), 'utf8');

function extractFunction(src, name) {
    const match = src.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`));
    assert.ok(match, `${name} not found`);
    return match[0];
}

function setup() {
    const dom = new JSDOM(
        `<div id="videoMediaContainer">
            <div id="cam__video" class="Camera" data-peer-id="peer1" data-media-type="videoType" data-camera-off="false" style="width: 300px; height: 200px; margin: 5px">
                <video id="cam" name="peer1"></video>
                <div id="cam__vb" class="videoMenuBar hidden"></div>
            </div>
            <div id="screen__video" class="Camera" data-peer-id="peer1" data-media-type="screenType" data-camera-off="false">
                <video id="screen"></video>
            </div>
            <div id="other__video" class="Camera" data-peer-id="peer2" data-media-type="videoType" data-camera-off="false">
                <video id="other" name="peer2"></video>
            </div>
        </div>
        <div id="videoPinMediaContainer"></div>`,
        { runScripts: 'outside-only' }
    );
    const { window } = dom;
    window.eval(`${source}\nwindow.ScreenCameraLayout = ScreenCameraLayout;`);
    window.mediaType = { video: 'videoType', screen: 'screenType' };
    window.eval(
        `${extractFunction(roomSource, 'getScreenCameraPairs')}\nwindow.getScreenCameraPairs = getScreenCameraPairs;`
    );
    const doc = window.document;
    const grid = doc.getElementById('videoMediaContainer');
    const pin = doc.getElementById('videoPinMediaContainer');
    const camera = doc.getElementById('cam__video');
    const screen = doc.getElementById('screen__video');
    const other = doc.getElementById('other__video');
    const layout = window.ScreenCameraLayout;
    const pairs = () => window.getScreenCameraPairs();
    return { window, doc, grid, pin, camera, screen, other, layout, pairs };
}

function pointer(window, type, props) {
    const event = new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...props });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    return event;
}

describe('screen share camera layout', () => {
    it('normalizes and cycles modes', () => {
        const { layout } = setup();
        assert.equal(layout.getMode(), 'separate');
        assert.equal(layout.setMode('bogus'), 'separate');
        assert.equal(layout.setMode('pip'), 'pip');
        assert.equal(layout.nextMode('separate'), 'pip');
        assert.equal(layout.nextMode('pip'), 'split');
        assert.equal(layout.nextMode('split'), 'separate');
    });

    it('pairs each camera with the screen tile of the same participant', () => {
        const { camera, screen, other, pairs } = setup();
        const result = Array.from(pairs(), ({ cameraWrap, screenWrap }) => [
            cameraWrap ? cameraWrap.id : null,
            screenWrap ? screenWrap.id : null,
        ]);
        assert.deepEqual(result, [
            [camera.id, screen.id],
            [other.id, null],
        ]);
    });

    it('pairs a camera-off avatar tile and a screen tile without camera', () => {
        const { doc, grid, camera, screen, pairs } = setup();
        camera.remove();
        assert.deepEqual(
            Array.from(pairs(), ({ cameraWrap, screenWrap }) => [
                cameraWrap ? cameraWrap.id : null,
                screenWrap ? screenWrap.id : null,
            ]),
            [
                ['other__video', null],
                [null, screen.id],
            ]
        );
        const avatar = doc.createElement('div');
        avatar.className = 'Camera';
        avatar.id = 'peer1__videoOff';
        avatar.dataset.peerId = 'peer1';
        avatar.dataset.cameraOff = 'true';
        grid.appendChild(avatar);
        assert.ok(pairs().some(({ cameraWrap, screenWrap }) => cameraWrap === avatar && screenWrap === screen));
    });

    it('shows a single camera per screen tile when a participant briefly has two camera tiles', () => {
        const { doc, grid, camera, screen, layout, pairs } = setup();
        layout.setMode('split');
        layout.sync(pairs(), grid);
        assert.equal(camera.parentElement, screen);

        // e.g. camera switch: the new tile is added before the old one is removed
        const second = camera.cloneNode(true);
        second.className = 'Camera';
        second.id = 'cam2__video';
        grid.appendChild(second);
        layout.sync(pairs(), grid);
        assert.equal(camera.parentElement, screen, 'the camera already shown keeps its place');
        assert.equal(second.parentElement, grid);
        assert.equal(screen.querySelectorAll('.screen-cam-overlay').length, 1);

        camera.remove();
        layout.sync(pairs(), grid);
        assert.equal(second.parentElement, screen);
        assert.equal(screen.querySelectorAll('.screen-cam-overlay').length, 1);
        assert.equal(screen.dataset.camLayout, 'split');
    });

    it('keeps the camera in the grid in separate mode', () => {
        const { grid, camera, layout, pairs } = setup();
        assert.equal(layout.sync(pairs(), grid), false);
        assert.equal(camera.parentElement, grid);
        assert.equal(camera.className, 'Camera');
    });

    it('moves the camera inside the screen tile for pip and split', () => {
        const { grid, camera, screen, other, layout, pairs } = setup();
        layout.setMode('pip');
        assert.equal(layout.sync(pairs(), grid), true);
        assert.equal(camera.parentElement, screen);
        assert.ok(layout.isOverlaid(camera));
        assert.ok(!camera.classList.contains('Camera'), 'overlay must not be sized as a grid tile');
        assert.equal(screen.dataset.camLayout, 'pip');
        assert.equal(other.parentElement, grid, 'a participant without screen share stays in the grid');

        layout.setMode('split');
        assert.equal(layout.sync(pairs(), grid), true, 'pip -> split changes the screen tile layout');
        assert.equal(camera.parentElement, screen);
        assert.equal(screen.dataset.camLayout, 'split');
        assert.equal(layout.sync(pairs(), grid), false, 'sync is idempotent');
    });

    it('restores the camera to the grid when switching back to separate', () => {
        const { grid, camera, screen, layout, pairs } = setup();
        layout.setMode('pip');
        layout.sync(pairs(), grid);
        camera.style.left = '40%';
        camera.style.top = '10%';

        layout.setMode('separate');
        assert.equal(layout.sync(pairs(), grid), true);
        assert.equal(camera.parentElement, grid);
        assert.equal(camera.className, 'Camera');
        assert.equal(camera.style.left, '');
        assert.equal(camera.style.top, '');
        assert.equal(screen.dataset.camLayout, undefined);
    });

    it('does nothing without a screen tile', () => {
        const { grid, camera, screen, layout, pairs } = setup();
        screen.remove();
        layout.setMode('pip');
        assert.equal(layout.sync(pairs(), grid), false);
        assert.equal(camera.parentElement, grid);
        assert.equal(camera.className, 'Camera');
    });

    it('clears the screen layout when the overlaid camera is closed', () => {
        const { grid, camera, screen, layout, pairs } = setup();
        layout.setMode('split');
        layout.sync(pairs(), grid);
        camera.remove();
        assert.equal(layout.sync(pairs(), grid), true);
        assert.equal(screen.dataset.camLayout, undefined);
    });

    it('releases the camera before the screen tile is removed', () => {
        const { grid, camera, screen, layout, pairs } = setup();
        layout.setMode('pip');
        layout.sync(pairs(), grid);
        assert.equal(layout.release(screen, grid), true);
        screen.remove();
        assert.equal(camera.parentElement, grid);
        assert.ok(camera.isConnected);
        assert.equal(camera.className, 'Camera');
    });

    it('does not resurrect a camera removed together with its screen tile', () => {
        const { grid, camera, screen, layout, pairs } = setup();
        layout.setMode('pip');
        layout.sync(pairs(), grid);
        screen.remove(); // e.g. peer disconnected
        camera.remove();
        layout.sync([{ cameraWrap: camera, screenWrap: screen }], grid);
        assert.equal(camera.isConnected, false);
        assert.equal(grid.contains(camera), false);
    });

    it('leaves a pinned camera where it is', () => {
        const { grid, pin, camera, screen, layout, pairs } = setup();
        camera.className = 'pinned-video-container';
        pin.appendChild(camera);
        layout.setMode('pip');
        assert.equal(layout.sync(pairs(), grid), false);
        assert.equal(camera.parentElement, pin);
        assert.equal(screen.dataset.camLayout, undefined);
    });

    it('moves the camera into the pinned screen tile and keeps it there', () => {
        const { grid, pin, camera, screen, layout, pairs } = setup();
        screen.className = 'pinned-video-container';
        pin.appendChild(screen);
        layout.setMode('split');
        assert.equal(layout.sync(pairs(), grid), true);
        assert.equal(camera.parentElement, screen);
        assert.equal(screen.dataset.camLayout, 'split');

        // Unpinning resets the className but keeps the layout attribute and the overlay
        screen.className = 'Camera';
        grid.appendChild(screen);
        assert.equal(layout.sync(pairs(), grid), false);
        assert.equal(camera.parentElement, screen);
        assert.equal(screen.dataset.camLayout, 'split');
    });

    it('clears the screen layout when an overlaid camera gets pinned on its own', () => {
        const { grid, pin, camera, screen, layout, pairs } = setup();
        layout.setMode('split');
        layout.sync(pairs(), grid);
        camera.className = 'pinned-video-container';
        pin.appendChild(camera);
        assert.equal(layout.sync(pairs(), grid), true);
        assert.equal(camera.parentElement, pin);
        assert.equal(screen.dataset.camLayout, undefined);
    });

    it('returns a hidden (hide self view) camera to the grid', () => {
        const { grid, camera, screen, layout, pairs } = setup();
        layout.setMode('pip');
        layout.sync(pairs(), grid);
        camera.style.display = 'none';
        assert.equal(layout.sync(pairs(), grid), true);
        assert.equal(camera.parentElement, grid);
        assert.equal(screen.dataset.camLayout, undefined);

        camera.style.display = 'block';
        assert.equal(layout.sync(pairs(), grid), true);
        assert.equal(camera.parentElement, screen);
    });

    it('applies grid visibility rules to cameras shown inside a screen tile', () => {
        const { window, grid, pin, camera, screen, other, layout, pairs } = setup();
        layout.setMode('pip');
        layout.sync(pairs(), grid);
        window.eval(`
            var isHideALLVideosActive = false;
            var isHideMeActive = true;
            var rc = { peer_id: 'peer1' };
            var locallyHiddenPeerIds = new Set();
            var showCameraOffParticipants = true;
            var handleAspectRatio = () => ScreenCameraLayout.sync(getScreenCameraPairs(), videoMediaContainer);
            ${extractFunction(roomSource, 'applyParticipantGridVisibility')}
            window.applyParticipantGridVisibility = applyParticipantGridVisibility;
        `);
        window.applyParticipantGridVisibility();
        assert.equal(camera.style.display, 'none', 'hide self view hides the overlaid camera');
        assert.equal(camera.parentElement, grid, 'and returns it to the grid');

        window.eval('isHideMeActive = false; isHideALLVideosActive = true;');
        other.setAttribute('focus-mode', 'true');
        window.applyParticipantGridVisibility();
        assert.equal(camera.parentElement, grid);
        assert.equal(camera.style.display, 'none', 'focus mode hides the other grid tiles');

        other.removeAttribute('focus-mode');
        window.eval('isHideALLVideosActive = false;');
        window.applyParticipantGridVisibility();
        assert.equal(camera.parentElement, screen);
        assert.equal(camera.style.display, 'block');

        // Focus on another grid tile hides the screen tile, so its camera goes back to the grid hidden
        window.eval('isHideALLVideosActive = true;');
        other.setAttribute('focus-mode', 'true');
        window.applyParticipantGridVisibility();
        assert.equal(screen.style.display, 'none');
        assert.equal(camera.parentElement, grid);
        assert.equal(camera.style.display, 'none', 'the camera must not stay visible during focus mode');

        // A pinned screen tile is not part of the grid focus mode, so its camera stays inside it
        other.removeAttribute('focus-mode');
        window.eval('isHideALLVideosActive = false;');
        window.applyParticipantGridVisibility();
        screen.className = 'pinned-video-container';
        pin.appendChild(screen);
        window.applyParticipantGridVisibility();
        assert.equal(camera.parentElement, screen);
        window.eval('isHideALLVideosActive = true;');
        other.setAttribute('focus-mode', 'true');
        window.applyParticipantGridVisibility();
        assert.equal(camera.parentElement, screen, 'focus mode on a grid tile keeps the camera in the pinned screen');
        assert.equal(camera.style.display, 'block');
    });

    it('drags the pip overlay within the screen tile and swallows the following click', () => {
        const { window, grid, camera, screen, layout, pairs } = setup();
        layout.setMode('pip');
        layout.sync(pairs(), grid);
        Object.defineProperty(screen, 'clientWidth', { value: 1000 });
        Object.defineProperty(screen, 'clientHeight', { value: 500 });
        Object.defineProperty(camera, 'offsetWidth', { value: 200 });
        Object.defineProperty(camera, 'offsetHeight', { value: 100 });
        Object.defineProperty(camera, 'offsetLeft', { value: 12 });
        Object.defineProperty(camera, 'offsetTop', { value: 388 });

        let videoClicks = 0;
        camera.querySelector('video').addEventListener('click', () => videoClicks++);

        camera.dispatchEvent(pointer(window, 'pointerdown', { clientX: 100, clientY: 450 }));
        camera.dispatchEvent(pointer(window, 'pointermove', { clientX: 400, clientY: 200 }));
        assert.equal(camera.style.left, '31.2%');
        assert.equal(camera.style.top, '27.6%');
        assert.equal(camera.style.bottom, 'auto');

        // Clamped to the screen tile bounds
        camera.dispatchEvent(pointer(window, 'pointermove', { clientX: 5000, clientY: -5000 }));
        assert.equal(camera.style.left, '80%');
        assert.equal(camera.style.top, '0%');

        camera.dispatchEvent(pointer(window, 'pointerup', { clientX: 5000, clientY: -5000 }));
        camera.querySelector('video').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(videoClicks, 0, 'click after a drag must not trigger the video click action');

        camera.querySelector('video').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(videoClicks, 1, 'a later plain click still works');
    });

    it('does not drag in split mode', () => {
        const { window, grid, camera, layout, pairs } = setup();
        layout.setMode('split');
        layout.sync(pairs(), grid);
        camera.dispatchEvent(pointer(window, 'pointerdown', { clientX: 100, clientY: 100 }));
        camera.dispatchEvent(pointer(window, 'pointermove', { clientX: 300, clientY: 300 }));
        assert.equal(camera.style.left, '');
        assert.equal(camera.style.top, '');
    });

    it('limits screen annotations to the screen video in split mode', () => {
        const { window, grid, camera, screen, layout, pairs } = setup();
        window.fabric = {
            Canvas: function (element, options) {
                Object.assign(this, options, {
                    wrapperEl: element.parentElement,
                    on() {},
                    requestRenderAll() {},
                });
            },
        };
        window.eval(`${drawingSource}\nwindow.Overlay = VideoDrawingOverlay;`);
        const Overlay = window.Overlay;
        Overlay.prototype._setupBrush = () => {};
        Overlay.prototype._setupPathListener = () => {};
        Overlay.prototype._setupResizeObserver = () => {};
        Object.defineProperty(screen.querySelector('video'), 'offsetWidth', { value: 700 });
        Object.defineProperty(screen.querySelector('video'), 'offsetHeight', { value: 500 });
        const overlay = new Overlay(screen, 'screen');
        assert.equal(overlay._getSplitVideoSize(), null, 'the whole tile is the drawing area by default');

        layout.setMode('split');
        layout.sync(pairs(), grid);
        assert.equal(camera.parentElement, screen);
        assert.deepEqual({ ...overlay._getSplitVideoSize() }, { width: 700, height: 500 });

        layout.setMode('pip');
        layout.sync(pairs(), grid);
        assert.equal(overlay._getSplitVideoSize(), null);
    });

    it('is wired into the room', () => {
        assert.match(html, /<script defer src="\.\.\/js\/ScreenCameraLayout\.js"><\/script>[\s\S]*RoomClient\.js/);
        assert.match(html, /<select id="screenCamLayoutSelect" class="form-select text-light bg-dark">/);
        assert.match(storageSource, /screen_cam_layout: 'separate'/);
        assert.match(roomSource, /function handleAspectRatio\(\) \{\n\s+syncScreenCameraLayout\(\);/);
        assert.match(roomSource, /ScreenCameraLayout\.setMode\(localStorageSettings\.screen_cam_layout\)/);
        assert.match(clientSource, /d\.dataset\.peerId = this\.peer_id;\n\s+d\.dataset\.mediaType = type;/);
        assert.match(clientSource, /d\.dataset\.peerId = remotePeerId;\n\s+d\.dataset\.mediaType = type;/);
        // Overlaid cameras are moved back to the grid before a screen tile is removed
        assert.match(clientSource, /this\.releaseScreenCamera\(d\);\n\s+d\.parentNode\.removeChild\(d\);/);
        assert.match(clientSource, /this\.releaseScreenCamera\(d\);\n\s+d\.remove\(\);/);
        assert.match(clientSource, /this\.releaseScreenCamera\(d\);\n\s+d\?\.parentNode\?\.removeChild\(d\);/);
    });
});

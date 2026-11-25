'use strict';

// npx mocha tests/test-ParticipantViewMobile.js

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const roomSource = fs.readFileSync(path.join(root, 'public/js/Room.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'public/js/RoomClient.js'), 'utf8');
const gridSource = fs.readFileSync(path.join(root, 'public/js/VideoGrid.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/views/Room.html'), 'utf8');

function extractFunction(src, name) {
    const match = src.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`));
    assert.ok(match, `${name} not found`);
    return match[0];
}

function extractMethod(src, name) {
    const match = src.match(new RegExp(`\\n    ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}\\n`));
    assert.ok(match, `${name} not found`);
    return match[0].trim();
}

function extractConst(src, name) {
    const match = src.match(new RegExp(`const ${name} = [^;]*;`));
    assert.ok(match, `${name} not found`);
    return match[0];
}

function setup(isMobile) {
    const select = html.match(/<select id="participantViewMode"[\s\S]*?<\/select>/)[0];
    const dom = new JSDOM(
        `${select}<select id="pinVideoPosition"><option value="speaker-left"></option>
        <option value="speaker-top"></option><option value="speaker-bottom"></option><option value="speaker-1:1"></option></select>`,
        {
            runScripts: 'outside-only',
        }
    );
    const { window } = dom;
    window.eval(`
        var isMobileDevice = ${isMobile};
        var isBroadcastingEnabled = false;
        var localStorageSettings = {};
        var lS = { setSettings() {} };
        var resizeVideoMedia = () => {};
        var getId = (id) => document.getElementById(id);
        var participantViewMode = getId('participantViewMode');
        var pinVideoPosition = getId('pinVideoPosition');
        var pins = [];
        var rc = {
            isVideoPinned: false,
            clearVideoFocusMode() {},
            autoPinVideoForLayout() { this.isVideoPinned = true; },
            toggleVideoPin(position) { pins.push(position); },
            userLog() {},
        };
        ${extractConst(roomSource, 'MOBILE_PARTICIPANT_VIEW_MODES')}
        ${extractFunction(roomSource, 'removeUnsupportedMobileParticipantViews')}
        ${extractFunction(roomSource, 'setParticipantViewMode')}
        window.api = { setParticipantViewMode, removeUnsupportedMobileParticipantViews, rc, pins: () => pins };
    `);
    return { window, api: window.api, select: window.document.getElementById('participantViewMode') };
}

function makeClient(isMobileDevice) {
    const dom = new JSDOM('<div id="pin"></div><div id="grid"></div><div id="vb"></div>');
    const { document } = dom.window;
    global.resizeVideoMedia = () => {};
    const client = new Function(
        `return { ${extractMethod(clientSource, 'toggleVideoPin')}, ${extractMethod(clientSource, 'appendPinButton')} };`
    )();
    Object.assign(client, {
        isMobileDevice,
        isVideoPinned: true,
        videoPinMediaContainer: document.getElementById('pin'),
        videoMediaContainer: document.getElementById('grid'),
        getPinnedSidePanelWidth: () => 0,
    });
    return { client, document };
}

describe('Participant view on mobile', () => {
    after(() => delete global.resizeVideoMedia);

    it('offers only grid, speaker top/bottom and 1:1 on mobile', () => {
        const { api, select } = setup(true);
        api.removeUnsupportedMobileParticipantViews();
        assert.deepEqual(
            [...select.options].map((o) => o.value),
            ['grid', 'speaker-top', 'speaker-bottom', 'speaker-1:1']
        );
    });

    it('pins the speaker for supported modes and falls back to grid for side views', () => {
        const { api, select } = setup(true);
        api.removeUnsupportedMobileParticipantViews();

        api.setParticipantViewMode('speaker-top', false, false);
        assert.equal(select.value, 'speaker-top');
        assert.equal(api.rc.isVideoPinned, true);
        assert.equal(api.pins().join(), 'speaker-top');

        api.rc.isVideoPinned = false;
        api.setParticipantViewMode('speaker-left', false, false);
        assert.equal(select.value, 'grid');
        assert.equal(api.rc.isVideoPinned, false);
    });

    it('keeps every view available on desktop', () => {
        const { api, select } = setup(false);
        api.setParticipantViewMode('speaker-left', false, false);
        assert.equal(select.value, 'speaker-left');
        assert.equal(select.options.length, 7);
    });

    it('keeps a hidden pin button in the DOM on mobile so layouts can pin tiles', () => {
        const { client, document } = makeClient(true);
        const vb = document.getElementById('vb');
        const pn = document.createElement('button');
        client.appendPinButton(vb, pn);
        assert.equal(pn.parentElement, vb);
        assert.ok(pn.classList.contains('hidden'));

        const desktop = makeClient(false);
        const desktopPn = desktop.document.createElement('button');
        desktop.client.appendPinButton(desktop.document.getElementById('vb'), desktopPn);
        assert.ok(!desktopPn.classList.contains('hidden'));
    });

    it('uses a fixed-size thumbnail strip on every device and maps side positions to speaker top on mobile', () => {
        const stripSize = 'var(--pinned-strip-size, 20vh)';
        const stripWithBar = `calc(${stripSize} + var(--buttons-bar-reserve, 0px))`;

        const { client } = makeClient(true);
        client.toggleVideoPin('speaker-top');
        assert.equal(client.videoPinMediaContainer.style.height, `calc(100% - ${stripWithBar})`);
        assert.equal(client.videoMediaContainer.style.top, `calc(100% - ${stripWithBar})`);
        assert.equal(client.videoMediaContainer.style.height, stripWithBar);

        client.toggleVideoPin('speaker-left');
        assert.equal(client.videoPinMediaContainer.style.width, '100%');
        assert.equal(client.videoMediaContainer.style.top, `calc(100% - ${stripWithBar})`, 'side maps to speaker-top');

        const desktop = makeClient(false).client;
        desktop.toggleVideoPin('speaker-top');
        assert.equal(desktop.videoMediaContainer.style.height, stripWithBar, 'desktop strip has the same fixed size');

        // Strip on top: the buttons bar reserve belongs to the speaker below it
        desktop.toggleVideoPin('speaker-bottom');
        assert.equal(desktop.videoMediaContainer.style.height, stripSize);
        assert.equal(desktop.videoPinMediaContainer.style.top, stripSize);
        assert.equal(desktop.videoPinMediaContainer.style.height, `calc(100% - ${stripSize})`);

        // Desktop side views keep the packed column
        desktop.toggleVideoPin('speaker-left');
        assert.equal(desktop.videoPinMediaContainer.style.width, '75%');
        assert.equal(desktop.videoMediaContainer.style.width, '25%');
    });

    it('lays out the tiles next to the pinned speaker as one scrollable row', () => {
        const dom = new JSDOM(
            `<div id="grid" class="screen-stage">${[0, 1, 2, 3, 4]
                .map((i) => `<div class="Camera" data-screen-stage="${i ? '' : 'main'}"></div>`)
                .join('')}</div>`,
            { runScripts: 'outside-only' }
        );
        const { window } = dom;
        window.eval(`
            var isMobileDevice = true;
            var customRatio = false;
            var ratio = 1;
            var rc = { isVideoPinned: true };
            ${extractFunction(gridSource, 'layoutPinnedStrip')}
            window.layoutPinnedStrip = layoutPinnedStrip;
        `);
        const grid = window.document.getElementById('grid');
        const cameras = [...grid.children];

        assert.equal(window.layoutPinnedStrip(grid, cameras, 400, 200, 5), true);
        assert.ok(grid.classList.contains('pinned-strip'));
        assert.ok(grid.classList.contains('pinned-strip-overflow'), '5 tiles do not fit, so the row scrolls');
        assert.ok(!grid.classList.contains('screen-stage'));
        assert.ok(
            cameras.every((c) => c.style.width === '156px' && c.style.height === '117px'),
            'fixed 4:3 tiles'
        );
        assert.ok(cameras.every((c) => !c.hasAttribute('data-screen-stage')));

        window.layoutPinnedStrip(grid, cameras.slice(0, 2), 400, 200, 5);
        assert.ok(!grid.classList.contains('pinned-strip-overflow'), 'a row that fits stays centered');

        window.eval('isMobileDevice = false;');
        assert.equal(window.layoutPinnedStrip(grid, cameras, 800, 200, 5), true, 'desktop strips are supported too');
        assert.equal(window.layoutPinnedStrip(grid, cameras, 300, 800, 5), false, 'packed columns keep the grid');

        window.eval('rc.isVideoPinned = false;');
        assert.equal(window.layoutPinnedStrip(grid, cameras, 400, 200, 5), false);
        assert.ok(!grid.classList.contains('pinned-strip'));
    });

    it('does not fall back to grid when the pinned camera-off tile is replaced by the camera turning on', () => {
        const dom = new JSDOM(
            `<div id="videoMediaContainer">
                <div id="peer1__videoOff"><button id="peer1__img__pin"></button></div>
            </div>`,
            { runScripts: 'outside-only' }
        );
        const { document } = dom.window;
        global.handleAspectRatio = () => {};
        const client = new Function(`return { ${extractMethod(clientSource, 'removeVideoOff')} };`)();
        let restoreScheduled = 0;
        let unpinnedAsManual = false;
        Object.assign(client, {
            peer_id: 'me',
            isVideoPinned: true,
            pinnedVideoPlayerId: 'peer1__img',
            isApplyingParticipantViewMode: false,
            videoMediaContainer: document.getElementById('videoMediaContainer'),
            getId: (id) => document.getElementById(id),
            toggleFocusMode() {},
            sound() {},
            scheduleParticipantViewRestore() {
                restoreScheduled++;
            },
        });
        // Mimics the handlePN click handler: a manual unpin persists grid, a programmatic one must not
        document.getElementById('peer1__img__pin').addEventListener('click', () => {
            client.isVideoPinned = false;
            if (!client.isApplyingParticipantViewMode) unpinnedAsManual = true;
        });

        client.removeVideoOff('peer1');
        assert.equal(unpinnedAsManual, false, 'the unpin click must not be treated as a manual unpin');
        assert.equal(client.isApplyingParticipantViewMode, false, 'the guard flag is released');
        assert.equal(restoreScheduled, 1, 'the saved speaker view is restored');
        assert.equal(document.getElementById('peer1__videoOff'), null);
        delete global.handleAspectRatio;
    });
});

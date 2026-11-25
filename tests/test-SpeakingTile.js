'use strict';

// npx mocha tests/test-SpeakingTile.js

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'RoomClient.js'), 'utf8');

function extractMethod(signature) {
    const start = source.indexOf(`    ${signature} {`);
    assert.ok(start !== -1, `${signature} not found`);
    const end = source.indexOf('\n    }\n', start);
    return source.slice(start, end + 7);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Speaking tile border', () => {
    let dom;
    let rc;
    let document;

    beforeEach(() => {
        dom = new JSDOM(
            `<div id="videoMediaContainer">
                <div class="Camera" id="screen__video" data-peer-id="alice" data-media-type="screenType">
                    <div class="screen-cam-overlay" id="cam__video" data-peer-id="alice" data-media-type="videoType"></div>
                </div>
                <div class="Camera" id="bob__videoOff" data-peer-id="bob" data-camera-off="true"></div>
            </div>
            <div id="videoPinMediaContainer">
                <div class="pinned-video-container" id="carol__video" data-peer-id="carol" data-media-type="videoType"></div>
            </div>`,
            { runScripts: 'outside-only' }
        );
        document = dom.window.document;
        dom.window.eval(`
            var mediaType = { audio: 'audioType', video: 'videoType', screen: 'screenType' };
            window.Client = class {
                ${['getSpeakingTiles(peerId)', 'handleSpeakingTile(peerId, holdMs = 600)', 'clearSpeakingTiles()']
                    .map(extractMethod)
                    .join('\n')}
            };
        `);
        rc = new dom.window.Client();
        rc.videoMediaContainer = document.getElementById('videoMediaContainer');
        rc.videoPinMediaContainer = document.getElementById('videoPinMediaContainer');
    });

    afterEach(() => dom.window.close());

    const speaking = () => [...document.querySelectorAll('.speaking')].map((el) => el.id);

    it('marks the camera tiles of the speaker (grid, camera-off, pinned, overlay) but never the screen tile', () => {
        rc.handleSpeakingTile('alice', 50);
        rc.handleSpeakingTile('bob', 50);
        rc.handleSpeakingTile('carol', 50);
        assert.deepEqual(speaking(), ['cam__video', 'bob__videoOff', 'carol__video']);
    });

    it('keeps the border while volume updates keep arriving and clears it after the hold time', async () => {
        rc.handleSpeakingTile('bob', 60);
        await sleep(40);
        rc.handleSpeakingTile('bob', 60);
        await sleep(40);
        assert.deepEqual(speaking(), ['bob__videoOff'], 'a short pause does not drop the border');
        await sleep(40);
        assert.deepEqual(speaking(), []);
    });

    it('clears every highlight at once when the setting is turned off', async () => {
        rc.handleSpeakingTile('bob', 30);
        rc.handleSpeakingTile('carol', 30);
        rc.clearSpeakingTiles();
        assert.deepEqual(speaking(), []);
        rc.handleSpeakingTile('bob', 30);
        await sleep(50);
        assert.deepEqual(speaking(), [], 'the hold timer still clears a new highlight');
    });
});

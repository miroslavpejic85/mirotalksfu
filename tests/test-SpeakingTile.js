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

describe('Speaking participant in the participants list', () => {
    let dom;
    let rc;
    let document;

    const listHtml = `<li id="bob" class="clearfix">
            <img src="bob.png" alt="avatar" />
            <div class="about-buttons">
                <button id="bob___pAudio"><span class="participant-action-icon"><i class="fas fa-microphone"></i></span></button>
            </div>
        </li>`;

    beforeEach(() => {
        dom = new JSDOM(`<ul id="participantsList">${listHtml}</ul>`, { runScripts: 'outside-only' });
        document = dom.window.document;
        dom.window.eval(`
            window.Client = class {
                getId(id) { return document.getElementById(id); }
                ${[
                    'handleSpeakingParticipant(peerId, holdMs = 600)',
                    'setParticipantSpeaking(peerId, speaking)',
                    'refreshSpeakingParticipants()',
                ]
                    .map(extractMethod)
                    .join('\n')}
            };
        `);
        rc = new dom.window.Client();
    });

    afterEach(() => dom.window.close());

    const item = () => document.getElementById('bob');
    const audioIcon = () => document.querySelector('#bob___pAudio .participant-action-icon');

    it('rings the avatar and swaps the mic for mixer bars while speaking, then restores it', async () => {
        rc.handleSpeakingParticipant('bob', 40);
        assert.ok(item().classList.contains('speaking'));
        assert.ok(audioIcon().classList.contains('speaking'));
        assert.equal(audioIcon().querySelectorAll('.participant-speaking-bars > span').length, 4);
        assert.ok(
            document.getElementById('bob___pAudio').querySelector('i').classList.contains('fa-microphone'),
            'the mic <i> stays first so mute handling can still read it'
        );

        rc.handleSpeakingParticipant('bob', 40);
        assert.equal(audioIcon().querySelectorAll('.participant-speaking-bars').length, 1, 'bars are added once');

        await sleep(60);
        assert.ok(!item().classList.contains('speaking'));
        assert.ok(!audioIcon().classList.contains('speaking'));
    });

    it('restores the speaking state after the list is re-rendered', () => {
        rc.handleSpeakingParticipant('bob', 200);
        document.getElementById('participantsList').innerHTML = listHtml;
        assert.ok(!item().classList.contains('speaking'));
        rc.refreshSpeakingParticipants();
        assert.ok(item().classList.contains('speaking'));
        assert.ok(audioIcon().classList.contains('speaking'));
    });
});

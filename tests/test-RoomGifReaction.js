'use strict';

// npx mocha tests/test-RoomGifReaction.js

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

const GIF_URL = 'https://static.klipy.com/ii/abc/md.webp';

describe('Room GIF reactions', () => {
    let dom;
    let rc;
    let document;

    beforeEach(() => {
        dom = new JSDOM(
            `<div id="userEmoji"></div>
            <div class="Camera" id="screen__video" data-peer-id="alice" data-media-type="screen"></div>
            <div class="Camera" id="cam__video" data-peer-id="alice" data-media-type="video"></div>
            <div class="Camera" id="bob__videoOff" data-peer-id="bob" data-camera-off="true"></div>
            <div class="Camera" id="carol__video" data-peer-id="carol" data-media-type="video" style="display: none"></div>`,
            { runScripts: 'outside-only' }
        );
        document = dom.window.document;
        dom.window.eval(`
            window.Client = class {
                ${['isValidRoomGifUrl(url)', 'getRoomGifTile(peerId)', 'handleRoomGif(cmd, duration = 5000)']
                    .map(extractMethod)
                    .join('\n')}
            };
        `);
        rc = new dom.window.Client();
        rc.getId = (id) => document.getElementById(id);
        rc.getRoomEmojiPlacement = () => ({ left: 10, top: 20, drift: '0px', rise: '-100px', rotation: '0deg' });
    });

    afterEach(() => dom.window.close());

    it('overlays the GIF on the sender camera tile and replaces a previous one', () => {
        rc.handleRoomGif({ peer_id: 'alice', peer_name: 'Alice', gif: GIF_URL });
        rc.handleRoomGif({ peer_id: 'alice', peer_name: 'Alice', gif: 'https://static.klipy.com/ii/new/md.webp' });

        const overlays = document.querySelectorAll('.room-gif-reaction');
        assert.equal(overlays.length, 1);
        assert.equal(overlays[0].parentElement.id, 'cam__video');
        assert.equal(overlays[0].querySelector('img').getAttribute('src'), 'https://static.klipy.com/ii/new/md.webp');
    });

    it('uses the camera-off tile and removes the overlay after the duration', async () => {
        rc.handleRoomGif({ peer_id: 'bob', peer_name: 'Bob', gif: GIF_URL }, 10);

        assert.equal(document.querySelector('#bob__videoOff .room-gif-reaction--tile') !== null, true);
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(document.querySelectorAll('.room-gif-reaction').length, 0);
    });

    it('falls back to a floating reaction with the sender name when no visible tile exists', () => {
        rc.handleRoomGif({ peer_id: 'carol', peer_name: '<b>Carol</b>', gif: GIF_URL });

        const overlay = document.querySelector('#userEmoji .room-gif-reaction--floating');
        assert.ok(overlay);
        assert.equal(document.querySelector('#carol__video .room-gif-reaction'), null);
        assert.equal(overlay.querySelector('.room-gif-reaction__name').textContent, '<b>Carol</b>');
        assert.equal(overlay.querySelector('b'), null);
    });

    it('ignores unsafe GIF URLs', () => {
        for (const gif of ['http://x.test/a.gif', 'javascript:alert(1)', 'https://x.test/a.gif" onerror="x', '', 42]) {
            rc.handleRoomGif({ peer_id: 'alice', peer_name: 'Alice', gif });
        }
        assert.equal(document.querySelectorAll('.room-gif-reaction').length, 0);
    });
});

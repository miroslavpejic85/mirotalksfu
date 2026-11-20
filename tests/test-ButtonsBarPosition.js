'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const roomClientSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/RoomClient.js'), 'utf8');

describe('buttons bar position', () => {
    let dom;
    let window;
    let bottomButtons;
    let RoomClientProto;
    let reserveSyncs;

    beforeEach(() => {
        dom = new JSDOM('<div id="bottomButtons"><div class="split-btn"><div class="dropdown"></div></div></div>', {
            runScripts: 'outside-only',
        });
        window = dom.window;
        bottomButtons = window.document.getElementById('bottomButtons');
        window.bottomButtons = bottomButtons;
        reserveSyncs = 0;
        window.syncButtonsBarReserve = () => reserveSyncs++;
        window.eval(`${roomClientSource}\nwindow.RoomClientForTest = RoomClient;`);
        RoomClientProto = window.RoomClientForTest.prototype;
    });

    afterEach(() => dom.window.close());

    function createClient() {
        const client = Object.create(RoomClientProto);
        client.isMobileDevice = false;
        client.getPinnedSidePanelWidth = () => 20;
        return client;
    }

    it('places a vertical bar on the side and opens its split menus to the right', () => {
        const client = createClient();
        const dropdown = bottomButtons.querySelector('.dropdown');

        client.changeBtnsBarPosition('vertical');

        assert.equal(bottomButtons.dataset.position, 'vertical');
        assert.equal(window.document.documentElement.style.getPropertyValue('--bottom-btns-flex-direction'), 'column');
        assert.equal(window.document.documentElement.style.getPropertyValue('--bottom-btns-left'), '15px');
        assert.ok(dropdown.classList.contains('dropend'));
        assert.ok(!dropdown.classList.contains('dropup'));
        assert.equal(reserveSyncs, 1);
    });

    it('places a horizontal bar below the meeting and opens its split menus upward', () => {
        const client = createClient();
        const dropdown = bottomButtons.querySelector('.dropdown');

        client.changeBtnsBarPosition('horizontal');

        assert.equal(bottomButtons.dataset.position, 'horizontal');
        assert.equal(window.document.documentElement.style.getPropertyValue('--bottom-btns-flex-direction'), 'row');
        assert.equal(window.document.documentElement.style.getPropertyValue('--bottom-btns-bottom'), '0');
        assert.equal(window.document.documentElement.style.getPropertyValue('--bottom-btns-left'), '40%');
        assert.ok(dropdown.classList.contains('dropup'));
        assert.ok(!dropdown.classList.contains('dropend'));
        assert.equal(reserveSyncs, 1);
    });
});

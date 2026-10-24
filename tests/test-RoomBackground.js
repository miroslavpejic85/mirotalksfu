'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { RoomBackground } = require('../public/js/RoomBackground.js');

const root = path.join(__dirname, '..');
const PRESET_A = '../images/virtual-background/default/background-1.jpg';
const PRESET_B = '../images/virtual-background/default/background-2.webp';

function createStorage(initial = {}) {
    const data = { ...initial };
    return {
        data,
        getItem: (key) => (key in data ? data[key] : null),
        setItem: (key, value) => {
            data[key] = String(value);
        },
    };
}

function createDb(initial = {}) {
    const images = new Map(Object.entries(initial));
    return {
        images,
        get: async (id) => images.get(id),
        put: async (id, blob) => images.set(id, blob),
        remove: async (id) => images.delete(id),
        keys: async () => [...images.keys()],
    };
}

function settingsMarkup() {
    const html = fs.readFileSync(path.join(root, 'public/views/Room.html'), 'utf8');
    const start = html.indexOf('<div id="roomBackgroundSection"');
    const end = html.indexOf('<div id="tabLanguages"');
    assert.ok(start > 0 && end > start, 'room background section exists in Room.html');
    return html.slice(start, end);
}

describe('Room background (browser-only)', () => {
    let dom;
    let doc;
    let storage;
    let db;
    let logs;

    function create(roomId = 'room-1', presets = [PRESET_A, PRESET_B]) {
        return new RoomBackground({
            roomId,
            getPresets: () => presets,
            storage,
            db,
            doc,
            userLog: (icon, message) => logs.push({ icon, message }),
        });
    }

    function saved() {
        return JSON.parse(storage.data.ROOM_BACKGROUND);
    }

    beforeEach(() => {
        dom = new JSDOM(`<!doctype html><body><div id="videoMediaContainer"></div>${settingsMarkup()}</body>`);
        doc = dom.window.document;
        storage = createStorage();
        db = createDb();
        logs = [];
    });

    it('shows nothing by default and creates the background layer behind the grid', async () => {
        const rb = create();
        await rb.init();

        const layer = doc.getElementById('roomBackgroundLayer');
        assert.ok(layer);
        assert.equal(doc.body.firstElementChild, layer);
        assert.equal(doc.body.classList.contains('room-bg-active'), false);
        assert.equal(layer.style.backgroundImage, '');
        assert.ok(doc.getElementById('roomBackgroundNone').classList.contains('active'));
        assert.equal(doc.getElementById('roomBackgroundAllRooms').checked, false);
    });

    it('renders preset cards and applies the selected preset for this room only', async () => {
        const rb = create();
        await rb.init();

        const cards = doc.querySelectorAll('.room-bg-card[data-bg-type="preset"]');
        assert.equal(cards.length, 2);

        cards[1].click();
        await new Promise((resolve) => setImmediate(resolve));

        assert.ok(doc.body.classList.contains('room-bg-active'));
        assert.ok(doc.getElementById('roomBackgroundLayer').style.backgroundImage.includes('background-2.webp'));
        assert.ok(cards[1].classList.contains('active'));
        assert.equal(saved().rooms['room-1'].value, PRESET_B);
        assert.equal(saved().global, null);

        const other = create('room-2');
        assert.equal(other.getSelection().type, 'none');
    });

    it('applies one background to every room when "Use in all my rooms" is enabled', async () => {
        const rb = create('room-1');
        await rb.select({ type: 'preset', value: PRESET_A });
        rb.setAllRooms(true);

        assert.deepEqual(saved().rooms, {});
        assert.equal(saved().global.value, PRESET_A);
        assert.equal(create('room-2').getSelection().value, PRESET_A);
        assert.equal(create('room-2').isAllRooms(), true);

        // Choosing "None" while in all-rooms mode keeps the scope instead of silently flipping it off
        await rb.select({ type: 'none' });
        assert.equal(rb.isAllRooms(), true);
        assert.equal(create('room-3').getSelection().type, 'none');
    });

    it('keeps the current look when switching back to a per-room background', async () => {
        const rb = create('room-1');
        rb.setSelection({ type: 'preset', value: PRESET_A }, true);
        rb.setAllRooms(false);

        assert.equal(saved().global, null);
        assert.equal(saved().rooms['room-1'].value, PRESET_A);
        assert.equal(create('room-2').getSelection().type, 'none');
    });

    it('persists and clamps the dim level', async () => {
        const rb = create();
        await rb.init();
        rb.setDim(200);
        assert.equal(saved().dim, 80);
        assert.equal(doc.documentElement.style.getPropertyValue('--room-bg-dim'), '0.8');
        assert.equal(doc.getElementById('roomBackgroundDimValue').textContent, '80%');
        rb.setDim(-5);
        assert.equal(saved().dim, 0);
    });

    it('ignores tampered or foreign values from localStorage', () => {
        storage.setItem(
            'ROOM_BACKGROUND',
            JSON.stringify({
                dim: 'abc',
                global: { type: 'preset', value: 'https://evil.example/track.png' },
                rooms: {
                    'room-1': { type: 'preset', value: '../images/x.jpg") ; background: red; ("' },
                    'room-2': { type: 'custom', value: 'javascript:alert(1)' },
                    'room-3': { type: 'preset', value: PRESET_A },
                },
            })
        );
        const rb = create('room-1');
        assert.equal(rb.state.dim, 35);
        assert.equal(rb.state.global, null);
        assert.deepEqual(Object.keys(rb.state.rooms), ['room-3']);
        assert.equal(rb.getSelection().type, 'none');
    });

    it('does not render invalid preset paths provided at runtime', async () => {
        const rb = create('room-1', [PRESET_A, 'https://evil.example/a.png', PRESET_A]);
        await rb.init();
        const presets = [...doc.querySelectorAll('.room-bg-card[data-bg-type="preset"]')];
        assert.deepEqual(
            presets.map((card) => card.dataset.bgValue),
            [PRESET_A]
        );
    });

    it('loads uploaded images from IndexedDB as object URLs and prunes unused ones', async () => {
        const blob = new Blob(['img'], { type: 'image/webp' });
        db = createDb({ 'custom-1': blob, 'custom-orphan': blob });
        storage.setItem(
            'ROOM_BACKGROUND',
            JSON.stringify({ rooms: { 'room-1': { type: 'custom', value: 'custom-1' } } })
        );

        const rb = create();
        await rb.init();

        const layer = doc.getElementById('roomBackgroundLayer');
        assert.match(layer.style.backgroundImage, /^url\("?blob:/);
        assert.ok(doc.body.classList.contains('room-bg-active'));
        const customCard = doc.getElementById('roomBackgroundCustom');
        assert.equal(customCard.classList.contains('hidden'), false);
        assert.ok(customCard.classList.contains('active'));

        await rb.pruneCustomImages();
        assert.deepEqual([...db.images.keys()], ['custom-1']);

        await rb.select({ type: 'preset', value: PRESET_A });
        assert.deepEqual([...db.images.keys()], []);
        assert.equal(rb.objectUrl, null);
        assert.ok(customCard.classList.contains('hidden'));
    });

    it('rejects non-image and oversized uploads without storing anything', async () => {
        const rb = create();
        assert.equal(await rb.upload({ type: 'text/html', size: 10 }), false);
        assert.equal(await rb.upload({ type: 'image/png', size: 26 * 1024 * 1024 }), false);
        assert.deepEqual(
            logs.map((log) => log.message),
            ['Please choose an image file', 'The image is too large (max 25 MB)']
        );
        assert.equal(db.images.size, 0);
        assert.equal(storage.data.ROOM_BACKGROUND, undefined);
    });

    it('stores a downscaled upload and selects it', async () => {
        const rb = create();
        await rb.init();
        const encoded = new Blob(['x'], { type: 'image/webp' });
        rb.downscale = async () => encoded;

        assert.equal(await rb.upload({ type: 'image/png', size: 1000 }), true);
        const selection = saved().rooms['room-1'];
        assert.equal(selection.type, 'custom');
        assert.match(selection.value, /^custom-[A-Za-z0-9-]+$/);
        assert.equal(db.images.get(selection.value), encoded);
        assert.ok(doc.body.classList.contains('room-bg-active'));
    });

    it('is wired into the room settings and can be disabled from config', () => {
        const html = fs.readFileSync(path.join(root, 'public/views/Room.html'), 'utf8');
        const roomJs = fs.readFileSync(path.join(root, 'public/js/Room.js'), 'utf8');
        const template = fs.readFileSync(path.join(root, 'app/src/config.template.js'), 'utf8');

        assert.ok(html.indexOf('../js/RoomBackground.js') < html.indexOf('../js/Room.js"'));
        assert.match(roomJs, /BUTTONS\.settings\.roomBackground === false/);
        assert.match(template, /roomBackground: process\.env\.SHOW_ROOM_BACKGROUND !== 'false'/);
    });
});

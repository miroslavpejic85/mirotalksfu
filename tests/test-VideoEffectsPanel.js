'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

// Helpers of the engine used by the panel (filter presets, CSS filters)
const ENGINE_HELPERS = ['utils', 'renderer', 'effects-manager', 'effects/beauty'];

function createEngine() {
    const listeners = new Map();
    const effects = [
        { id: 'sunglasses', label: 'Sunglasses', category: 'face', thumbnail: 'sunglasses.svg' },
        { id: 'glasses', label: 'Glasses', category: 'face', thumbnail: 'glasses.svg' },
        { id: 'avatar-cat', label: 'Cat', category: 'avatar', thumbnail: 'cat.svg' },
        { id: 'avatar-bear', label: 'Bear', category: 'avatar', thumbnail: 'bear.svg' },
        { id: 'avatar3d-man', label: 'Man', category: 'avatar3d', thumbnail: 'man.webp', is3D: true },
        { id: 'avatar3d-raccoon', label: 'Raccoon', category: 'avatar3d', thumbnail: 'raccoon.webp', is3D: true },
    ];
    const state = {
        effect: null,
        filterPreset: 'none',
        filters: {},
        adjustments: { touchUp: 0, lowLight: 0 },
        running: true,
        renderer: 'webgl2',
        capabilities: { filters: true, smoothing: true, webgl: true },
        faceTracking: 'ready',
        faceDetected: true,
        slow: false,
    };
    const engine = {
        running: true,
        state,
        calls: [],
        on(event, handler) {
            listeners.set(event, handler);
            return () => listeners.delete(event);
        },
        emit(event, payload) {
            listeners.get(event)?.(payload);
        },
        getState: () => ({ ...state, filters: { ...state.filters }, adjustments: { ...state.adjustments } }),
        getEffects: () => effects,
        getFilterPresets: () => engine.window.MiroTalkVFX.getFilterPresets(),
        async setEffect(id) {
            engine.calls.push(['setEffect', id]);
            state.effect = id || null;
        },
        setFilterPreset(id) {
            state.filterPreset = id;
            state.filters = { ...engine.window.MiroTalkVFX.getFilterPreset(id).filters };
        },
        resetFilters() {
            engine.setFilterPreset('none');
        },
        setFilters(filters) {
            state.filters = { ...state.filters, ...filters };
            state.filterPreset = null;
        },
        setAdjustments(adjustments) {
            Object.assign(state.adjustments, adjustments);
        },
        async clearAll() {
            engine.calls.push(['clearAll']);
            engine.resetFilters();
            state.adjustments = { touchUp: 0, lowLight: 0 };
            state.effect = null;
        },
    };
    return engine;
}

function createBackground() {
    const background = {
        selection: { blurLevel: null, imageUrl: null, transparent: null },
        custom: ['data:image/png;base64,custom'],
        applied: [],
        removed: [],
        isAvailable: () => true,
        supportsTransparent: () => true,
        isValidImageUrl: (url) => /\.(png|jpe?g|gif|webp)$/i.test(url),
        getSelection: () => ({ ...background.selection }),
        getPresetImages: () => ['bg-1.jpg', 'bg-2.jpg'],
        getCustomImages: () => background.custom,
        async apply(blurLevel, imageUrl, transparent) {
            background.applied.push([blurLevel, imageUrl, transparent]);
            background.selection = {
                blurLevel: blurLevel || null,
                imageUrl: blurLevel ? null : imageUrl || null,
                transparent: !blurLevel && !imageUrl && transparent ? true : null,
            };
        },
        async upload(files) {
            const images = files.map((file, i) => `data:image/png;base64,upload${i}`);
            background.custom.push(...images);
            return images;
        },
        async removeCustom(image) {
            background.removed.push(image);
            background.custom = background.custom.filter((item) => item !== image);
        },
    };
    return background;
}

describe('Visual effects panel', () => {
    let window;
    let document;
    let engine;
    let background;
    let panel;
    let container;
    let changes;
    let indicator;

    beforeEach(() => {
        const dom = new JSDOM('<!doctype html><body><div id="panel"></div><div id="chips"></div></body>', {
            runScripts: 'outside-only',
            pretendToBeVisual: true,
            url: 'https://mirotalk.test/join/room',
        });
        window = dom.window;
        document = window.document;
        for (const file of ENGINE_HELPERS) {
            window.eval(fs.readFileSync(path.join(ROOT, `public/video-effects/${file}.js`), 'utf8'));
        }
        window.eval(
            `${fs.readFileSync(path.join(ROOT, 'public/js/VideoEffectsPanel.js'), 'utf8')}\nwindow.VideoEffectsPanel = VideoEffectsPanel;`
        );
        engine = createEngine();
        engine.window = window;
        background = createBackground();
        changes = 0;
        indicator = null;
        panel = new window.VideoEffectsPanel(engine, {
            onChange: async () => {
                changes++;
            },
            onStateChange: (active) => {
                indicator = active;
            },
            background,
            camera: { isOn: () => true, turnOn: () => {} },
        });
        container = document.getElementById('panel');
        panel.mount(container);
    });

    afterEach(() => {
        panel.destroy();
        window.close();
    });

    const $ = (selector) => container.querySelector(selector);
    const $$ = (selector) => [...container.querySelectorAll(selector)];
    const visiblePanel = () => $$('.vfx-tabpanel').find((el) => !el.classList.contains('hidden'));
    const chipLabels = () => $$('.vfx-active .vfx-chip-open').map((chip) => chip.textContent.trim());

    it('shows one tab at a time: Background, Effects, Avatars, 3D Avatars, Filters', () => {
        const tabs = $$('.vfx-tab');
        assert.deepEqual(
            tabs.map((tab) => tab.dataset.tab),
            ['background', 'face', 'avatar', 'avatar3d', 'filters']
        );
        assert.deepEqual(
            tabs.map((tab) => tab.getAttribute('aria-label')),
            ['Background', 'Effects', 'Avatars', '3D Avatars', 'Filters']
        );
        assert.equal($$('.vfx-tabpanel').filter((el) => !el.classList.contains('hidden')).length, 1);
        assert.equal($('.vfx-tab.active').getAttribute('aria-selected'), 'true');

        $('.vfx-tab[data-tab="avatar"]').click();
        assert.equal(visiblePanel().getAttribute('id'), $('.vfx-tab[data-tab="avatar"]').getAttribute('aria-controls'));
        assert.deepEqual(
            [...visiblePanel().querySelectorAll('.vfx-card')].map((card) => card.getAttribute('aria-label')),
            ['Cat', 'Bear']
        );
    });

    it('hides the Background tab when backgrounds are not available', () => {
        background.isAvailable = () => false;
        panel.mount(container);
        assert.deepEqual(
            $$('.vfx-tab').map((tab) => tab.dataset.tab),
            ['face', 'avatar', 'avatar3d', 'filters']
        );
    });

    it('selects an effect, marks its tab, and removes it when chosen again', async () => {
        panel.openTab('avatar');
        visiblePanel().querySelector('.vfx-card[aria-label="Cat"]').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(engine.state.effect, 'avatar-cat');
        assert.equal($('.vfx-card[aria-label="Cat"]').getAttribute('aria-pressed'), 'true');
        assert.ok($('.vfx-tab[data-tab="avatar"]').classList.contains('vfx-tab-on'));
        assert.deepEqual(chipLabels(), ['Cat']);
        assert.equal(indicator, true);

        // Choosing a face effect replaces the avatar (one effect at a time)
        $('.vfx-card[aria-label="Sunglasses"]').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(engine.state.effect, 'sunglasses');
        assert.ok(!$('.vfx-tab[data-tab="avatar"]').classList.contains('vfx-tab-on'));

        $('.vfx-card[aria-label="Sunglasses"]').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(engine.state.effect, null);
        assert.equal($('.vfx-active-none').textContent, 'No effects on');
        assert.equal(indicator, false);
        assert.ok(changes >= 3);
    });

    it('lists the 3D avatars in their own tab, one effect at a time with the cartoon avatars', async () => {
        panel.openTab('avatar3d');
        const cards = [...visiblePanel().querySelectorAll('.vfx-card')];
        assert.deepEqual(
            cards.map((card) => card.getAttribute('aria-label')),
            ['Man', 'Raccoon']
        );
        assert.equal(visiblePanel().querySelector('.vfx-badge'), null, 'no "3D" badge inside the 3D tab');

        cards[1].click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(engine.state.effect, 'avatar3d-raccoon');
        assert.ok($('.vfx-tab[data-tab="avatar3d"]').classList.contains('vfx-tab-on'));
        assert.ok(!$('.vfx-tab[data-tab="avatar"]').classList.contains('vfx-tab-on'));
        assert.deepEqual(chipLabels(), ['Raccoon']);

        // A cartoon avatar replaces it
        await panel.selectEffect('avatar-cat');
        assert.equal(engine.state.effect, 'avatar-cat');
        assert.ok(!$('.vfx-tab[data-tab="avatar3d"]').classList.contains('vfx-tab-on'));
        assert.ok($('.vfx-tab[data-tab="avatar"]').classList.contains('vfx-tab-on'));

        // Its chip opens the 3D Avatars tab
        await panel.selectEffect('avatar3d-man');
        panel.openTab('filters');
        $('.vfx-active .vfx-chip-open').click();
        assert.equal($('.vfx-tab.active').dataset.tab, 'avatar3d');
    });

    it('lists everything that is on as removable chips with "Turn off all"', async () => {
        await panel.selectBackground('blur-10');
        await panel.selectEffect('glasses');
        await panel.selectPreset('warm');
        await panel.setAdjustment('lowLight', 0.5);
        assert.deepEqual(chipLabels(), ['Blur', 'Glasses', 'Warm', 'Low light']);
        assert.ok($('.vfx-turn-off-all'));

        // Remove one item from its chip
        $$('.vfx-active .vfx-chip')[2].querySelector('.vfx-chip-remove').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(engine.state.filterPreset, 'none');
        assert.deepEqual(chipLabels(), ['Blur', 'Glasses', 'Low light']);

        $('.vfx-turn-off-all').click();
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.deepEqual(engine.calls.at(-1), ['clearAll']);
        assert.deepEqual(background.applied.at(-1), [null, null, null]);
        assert.equal(panel.isAnythingActive(), false);
        assert.equal($('.vfx-turn-off-all'), null);
    });

    it('opens the tab of a chip when it is clicked', async () => {
        await panel.selectEffect('avatar-bear');
        panel.openTab('filters');
        $('.vfx-active .vfx-chip-open').click();
        assert.equal($('.vfx-tab.active').dataset.tab, 'avatar');
    });

    it('shows a Custom filter state after manual adjustments', async () => {
        panel.openTab('filters');
        assert.ok($('.vfx-card-custom').classList.contains('hidden'));
        const brightness = $$('details.vfx-advanced .vfx-range')[0];
        brightness.value = '1.2';
        brightness.dispatchEvent(new window.Event('input'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(engine.state.filterPreset, null);
        assert.ok(!$('.vfx-card-custom').classList.contains('hidden'));
        assert.equal($('.vfx-card-custom').getAttribute('aria-pressed'), 'true');
        assert.deepEqual(chipLabels(), ['Custom']);
    });

    it('toggles presets and keeps friendly adjustments separate', async () => {
        panel.openTab('filters');
        $('.vfx-card[aria-label="Sepia"]').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(engine.state.filterPreset, 'sepia');
        const touchUp = $$('.vfx-tabpanel:not(.hidden) .vfx-sliders')[0].querySelector('.vfx-range');
        touchUp.value = '0.4';
        touchUp.dispatchEvent(new window.Event('input'));
        assert.equal(engine.state.adjustments.touchUp, 0.4);
        assert.equal(engine.state.filterPreset, 'sepia', 'touch up does not turn the preset into Custom');
        $('.vfx-card[aria-label="Sepia"]').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(engine.state.filterPreset, 'none');
    });

    it('keeps one tab stop per grid and moves with the arrow keys', () => {
        panel.openTab('background');
        const grid = visiblePanel().querySelector('.vfx-grid');
        const cards = [...grid.querySelectorAll('.vfx-card')];
        assert.equal(cards.filter((card) => card.getAttribute('tabindex') === '0').length, 1);
        cards[0].focus();
        grid.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        assert.equal(document.activeElement, cards[1]);
        grid.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        assert.equal(document.activeElement, cards.at(-1));
        assert.equal(cards.filter((card) => card.getAttribute('tabindex') === '0').length, 1);

        const tablist = $('.vfx-tabs');
        tablist.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        assert.equal($('.vfx-tab.active').dataset.tab, 'face');
        assert.equal(document.activeElement, $('.vfx-tab[data-tab="face"]'));
    });

    it('manages backgrounds: toggle, uploads, deleting custom images', async () => {
        panel.openTab('background');
        $('.vfx-card[aria-label="Strong blur"]').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.deepEqual(background.applied.at(-1), [20, null, null]);
        assert.ok($('.vfx-tab[data-tab="background"]').classList.contains('vfx-tab-on'));
        $('.vfx-card[aria-label="Strong blur"]').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.deepEqual(background.applied.at(-1), [null, null, null], 'chosen again: removed');

        // Only uploaded images can be deleted
        assert.equal($$('.vfx-card-remove').length, 1);
        await panel.uploadBackground([{ name: 'a.png' }]);
        assert.equal(background.selection.imageUrl, 'data:image/png;base64,upload0', 'upload is applied');
        assert.equal($$('.vfx-card-remove').length, 2);
        await panel.removeCustomBackground('data:image/png;base64,upload0');
        assert.deepEqual(background.removed, ['data:image/png;base64,upload0']);
        assert.equal(background.selection.imageUrl, null, 'deleting the applied image removes it');
        assert.equal($$('.vfx-card-remove').length, 1);
    });

    it('validates and loads background links', async () => {
        assert.equal(await panel.addBackgroundFromUrl('not a link'), false);
        assert.ok(!$('.vfx-error').classList.contains('hidden'));
        window.fetch = async () => ({
            ok: true,
            blob: async () => new window.Blob(['x'], { type: 'image/png' }),
        });
        assert.equal(await panel.addBackgroundFromUrl('https://example.com/bg.png'), true);
        assert.ok($('.vfx-error').classList.contains('hidden'));
        assert.equal(background.selection.imageUrl, 'data:image/png;base64,upload0');

        window.fetch = async () => {
            throw new TypeError('Failed to fetch');
        };
        const warn = window.console.warn;
        window.console.warn = () => {};
        try {
            assert.equal(await panel.addBackgroundFromUrl('https://blocked.example.com/bg.png'), false);
        } finally {
            window.console.warn = warn;
        }
        assert.match($('.vfx-error').textContent, /Upload/);
    });

    it('explains unavailable face effects, the camera being off, and slow devices', () => {
        engine.state.faceTracking = 'error';
        panel.openTab('face');
        panel.sync();
        assert.ok($$('.vfx-tabpanel:not(.hidden) .vfx-card').every((card) => card.disabled));
        assert.match($('.vfx-unavailable:not(.hidden)').textContent, /Face tracking/);

        engine.state.faceTracking = 'ready';
        engine.state.slow = true;
        panel.sync();
        assert.equal($('.vfx-status').dataset.level, 'warning');

        let turnedOn = false;
        panel.camera = { isOn: () => false, turnOn: () => (turnedOn = true) };
        panel.sync();
        assert.match($('.vfx-status').textContent, /camera is off/);
        $('.vfx-status button').click();
        assert.equal(turnedOn, true);
    });

    it('disables Touch up without WebGL', () => {
        engine.state.capabilities = { filters: true, smoothing: false, webgl: false };
        panel.openTab('filters');
        const touchUp = $$('.vfx-tabpanel:not(.hidden) .vfx-sliders')[0].querySelector('.vfx-range');
        assert.equal(touchUp.disabled, true);
    });

    it('shows standalone chips only while something is on', async () => {
        const chips = document.getElementById('chips');
        let opened = null;
        panel.mountActiveBar(chips, { onOpen: (tab) => (opened = tab) });
        assert.ok(chips.classList.contains('hidden'));
        await panel.selectEffect('avatar-cat');
        assert.ok(!chips.classList.contains('hidden'));
        chips.querySelector('.vfx-chip-open').click();
        assert.equal(opened, 'avatar');
    });

    it('saves and restores the selection, including adjustments', async () => {
        await panel.selectEffect('glasses');
        await panel.setAdjustment('touchUp', 0.3);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const saved = JSON.parse(window.localStorage.getItem('videoEffectsSettings'));
        assert.equal(saved.effect, 'glasses');
        assert.equal(saved.adjustments.touchUp, 0.3);

        const restored = createEngine();
        restored.window = window;
        const other = new window.VideoEffectsPanel(restored, { background });
        await other.restoreSettings();
        assert.equal(restored.state.effect, 'glasses');
        assert.equal(restored.state.adjustments.touchUp, 0.3);
        other.destroy();
    });
});

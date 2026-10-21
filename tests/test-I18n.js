'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const langDir = path.join(root, 'public/lang');
const extractor = path.join(root, 'app/src/scripts/extract-ui-lang.js');
const clientSource = fs.readFileSync(path.join(root, 'public/js/RoomClient.js'), 'utf8');
const i18nSource = fs.readFileSync(path.join(root, 'public/js/I18n.js'), 'utf8');
const screenshotLabels = ['Focus Mode', 'Picture in Picture', 'Take Snapshot', 'Video Privacy'];

function readLocale(lang) {
    return JSON.parse(fs.readFileSync(path.join(langDir, `${lang}.json`), 'utf8'));
}

async function tick() {
    await new Promise((resolve) => setImmediate(resolve));
}

describe('native translation catalogs', () => {
    it('keeps every locale in sync and translates the dynamically generated screenshot captions', () => {
        const english = readLocale('en');
        for (const file of fs.readdirSync(langDir).filter((file) => file.endsWith('.json') && file !== 'en.json')) {
            const locale = readLocale(path.basename(file, '.json'));
            assert.deepEqual(Object.keys(locale), Object.keys(english), file);
            for (const namespace of Object.keys(english)) {
                assert.deepEqual(Object.keys(locale[namespace]).sort(), Object.keys(english[namespace]).sort(), file);
                for (const [key, value] of Object.entries(locale[namespace])) {
                    assert.equal(typeof value, 'string', `${file}: ${namespace}.${key}`);
                    assert.ok(value.trim(), `${file}: ${namespace}.${key}`);
                    assert.deepEqual(
                        (value.match(/\{[^}]+\}/g) || []).sort(),
                        (key.match(/\{[^}]+\}/g) || []).sort(),
                        `${file}: ${namespace}.${key} placeholders`
                    );
                }
            }
            for (const label of screenshotLabels) {
                assert.notEqual(locale.buttons[label], label, `${file}: ${label}`);
            }
            for (const [namespace, keys] of Object.entries({
                buttons: ['Delete text annotation', 'Edit text annotation', 'Duplicate text annotation'],
                labels: ['Choose Background...', 'Prevent sleep while the meeting is visible, even with the camera on'],
                dialogs: [
                    'Recording started',
                    'Recording stopped',
                    'Download recording',
                    'Download your recording, finish saving it, then continue leaving.',
                    'Recording save failed',
                    'Your recording could not be saved. Stay in the meeting or leave without saving?',
                    'Tap Download recording and save the file on your device, then tap Done saving. The meeting will stay open until you are done.',
                ],
                toasts: [
                    'Please wait while your recording is saved.',
                    'The whiteboard is unlocked. The participants can interact with it.',
                    'Device wake lock is active',
                    'Device wake lock released',
                    'Manual keep-awake disabled; audio-only wake lock remains active',
                    'Failed to release Wake Lock:',
                ],
                tooltips: ['Prevent sleep while the meeting is visible, even with the camera on'],
            })) {
                for (const key of keys) {
                    assert.notEqual(locale[namespace][key], key, `${file}: ${namespace}.${key}`);
                }
            }
        }
    });
});

describe('dynamic dropdown key extraction', () => {
    let fixtureRoot;
    let script;
    let fixtureLangDir;

    beforeEach(() => {
        fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mirotalk-i18n-'));
        script = path.join(fixtureRoot, 'app/src/scripts/extract-ui-lang.js');
        fixtureLangDir = path.join(fixtureRoot, 'public/lang');
        fs.mkdirSync(path.dirname(script), { recursive: true });
        fs.mkdirSync(fixtureLangDir, { recursive: true });
        fs.mkdirSync(path.join(fixtureRoot, 'public/views'), { recursive: true });
        fs.mkdirSync(path.join(fixtureRoot, 'public/js'), { recursive: true });
        fs.copyFileSync(extractor, script);
        fs.writeFileSync(
            path.join(fixtureRoot, 'public/views/Room.html'),
            '<script src="../js/RoomClient.js"></script>'
        );
        fs.writeFileSync(
            path.join(fixtureRoot, 'public/js/RoomClient.js'),
            `
            this.createResponsiveDropdownItem(ha, 'Focus Mode');
            this.createResponsiveDropdownItem(pip, 'Picture in Picture');
            this.createResponsiveDropdownItem(ts, 'Take Snapshot');
            this.createResponsiveDropdownItem(vp, 'Video Privacy');
            this.createResponsiveDropdownItem(pn, 'Pin Video', 'compact');
            this.createResponsiveDropdownRangeItem(pv, 'Volume', 'fa-volume-high');
            this.createDropdownItem(
                role,
                peerPresenter ? 'Remove presenter role' : 'Set as presenter',
                menu
            );
            this.createDropdownItem(ban, 'Ban', menu, 'red');
            this.createDropdownItem(button, 'Don\\'t share', menu);
            `
        );
        fs.writeFileSync(
            path.join(fixtureLangDir, 'it.json'),
            JSON.stringify({ buttons: { 'Focus Mode': 'Modalità concentrazione', Stale: 'Obsoleto' } })
        );
    });

    afterEach(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

    it('extracts all dropdown helpers and both conditional captions, preserving existing translations', () => {
        execFileSync(process.execPath, [script]);
        const english = JSON.parse(fs.readFileSync(path.join(fixtureLangDir, 'en.json'), 'utf8'));
        const italian = JSON.parse(fs.readFileSync(path.join(fixtureLangDir, 'it.json'), 'utf8'));
        for (const label of [
            ...screenshotLabels,
            'Pin Video',
            'Volume',
            'Remove presenter role',
            'Set as presenter',
            'Ban',
            "Don't share",
        ]) {
            assert.equal(english.buttons[label], label);
        }
        assert.equal(italian.buttons['Focus Mode'], 'Modalità concentrazione');
        assert.equal(italian.buttons.Volume, 'Volume');
        assert.ok(!Object.hasOwn(italian.buttons, 'Stale'));
        assert.ok(!Object.hasOwn(english.buttons, 'compact'));
        assert.ok(!Object.hasOwn(english.buttons, 'red'));
        assert.ok(!Object.hasOwn(english.buttons, 'fa-volume-high'));

        const before = fs.readFileSync(path.join(fixtureLangDir, 'it.json'), 'utf8');
        execFileSync(process.execPath, [script]);
        assert.equal(fs.readFileSync(path.join(fixtureLangDir, 'it.json'), 'utf8'), before);
    });
});

describe('dynamic native dropdown translations', () => {
    let dom;
    let client;

    beforeEach(() => {
        dom = new JSDOM('<div id="tabLanguages"><span class="title">Language:</span></div>', {
            url: 'https://meet.example/room',
            runScripts: 'outside-only',
        });
        dom.window.eval(`${clientSource}\nwindow.RoomClient = RoomClient;`);
        client = Object.create(dom.window.RoomClient.prototype);
    });

    afterEach(() => dom.window.close());

    async function initialize(lang) {
        dom.window.BRAND = { app: { language: lang, translationMode: 'native' } };
        dom.window.fetch = async (url) => ({
            ok: true,
            json: async () => readLocale(path.basename(url, '.json')),
        });
        dom.window.tippy = () => [];
        dom.window.Swal = { fire() {} };
        dom.window.eval(i18nSource);
        dom.window.document.dispatchEvent(new dom.window.Event('brand:ready'));
        await dom.window.i18n.ready;
    }

    function appendMenu() {
        const menu = dom.window.document.createElement('div');
        const source = dom.window.document.createElement('button');
        source.id = 'snapshot';
        source.className = 'fas fa-camera-retro';
        let clicks = 0;
        source.addEventListener('click', () => clicks++);
        for (const label of screenshotLabels) {
            menu.appendChild(client.createResponsiveDropdownItem(source, label));
        }
        const range = dom.window.document.createElement('input');
        range.type = 'range';
        range.value = '25';
        menu.appendChild(client.createResponsiveDropdownRangeItem(range, 'Volume', 'fa-volume-high'));
        dom.window.document.body.append(source, range, menu);
        return { menu, source, range, clicks: () => clicks };
    }

    function assertCaptions(menu, lang) {
        const locale = lang === 'en' ? null : readLocale(lang);
        const captions = [...menu.querySelectorAll('span')].map((span) => span.textContent);
        assert.deepEqual(
            captions,
            [...screenshotLabels, 'Volume'].map((label) => (locale ? locale.buttons[label] : label))
        );
    }

    async function switchLanguage(lang) {
        const select = dom.window.document.getElementById('i18nLanguageSelect');
        select.value = lang;
        select.dispatchEvent(new dom.window.Event('change'));
        await tick();
        await tick();
    }

    it('translates immediately, retains icons and handlers, and switches existing captions from their English sources', async () => {
        await initialize('it');
        const { menu, range, clicks } = appendMenu();
        assertCaptions(menu, 'it');
        assert.ok(menu.querySelector('button').classList.contains('fa-camera-retro'));
        assert.equal(menu.querySelector('button').id, '');
        menu.firstElementChild.click();
        assert.equal(clicks(), 1);

        const proxyRange = menu.querySelector('input');
        proxyRange.value = '75';
        proxyRange.dispatchEvent(new dom.window.Event('input'));
        assert.equal(range.value, '75');
        range.value = '40';
        range.dispatchEvent(new dom.window.Event('input'));
        assert.equal(proxyRange.value, '40');

        await tick();
        assertCaptions(menu, 'it');
        await switchLanguage('de');
        assertCaptions(menu, 'de');
        await switchLanguage('en');
        assertCaptions(menu, 'en');
        menu.firstElementChild.click();
        assert.equal(clicks(), 2);
    });

    it('translates menus created in English after a live native-language switch', async () => {
        await initialize('en');
        const { menu } = appendMenu();
        assertCaptions(menu, 'en');
        await switchLanguage('it');
        assertCaptions(menu, 'it');
    });

    it('repositions an open menu after a longer translation changes its dimensions', async () => {
        await initialize('en');
        const { menu } = appendMenu();
        menu.className = 'navbar-dropdown-content';
        const trigger = dom.window.document.createElement('div');
        const button = dom.window.document.createElement('button');
        trigger.appendChild(button);
        dom.window.document.body.appendChild(trigger);
        Object.defineProperties(dom.window, {
            innerWidth: { value: 320, configurable: true },
            innerHeight: { value: 600, configurable: true },
        });
        button.getBoundingClientRect = () => ({ right: 310, top: 500, bottom: 530 });
        const positionedCaptions = [];
        menu.getBoundingClientRect = () => {
            positionedCaptions.push(menu.querySelector('span').textContent);
            const translated = dom.window.i18n.getLang() === 'it';
            return { width: translated ? 304 : 180, height: translated ? 300 : 200 };
        };
        client.handleDropdownEvents(trigger, button, menu);
        trigger.dispatchEvent(new dom.window.Event('mouseenter'));
        assert.equal(menu.style.left, '130px');
        assert.equal(menu.style.top, '298px');

        await switchLanguage('it');
        assertCaptions(menu, 'it');
        assert.equal(menu.style.left, '8px');
        assert.equal(menu.style.top, '198px');
        assert.equal(positionedCaptions.at(-1), readLocale('it').buttons['Focus Mode']);
        assert.ok(menu.classList.contains('show'));
    });

    it('keeps English captions and actions intact without the native translator', () => {
        const { menu, clicks } = appendMenu();
        assertCaptions(menu, 'en');
        menu.firstElementChild.click();
        assert.equal(clicks(), 1);
    });
});

describe('Google Translate gating (UI_TRANSLATION_MODE)', () => {
    const translateSource = fs.readFileSync(path.join(root, 'public/js/Translate.js'), 'utf8');
    const GOOGLE_SRC = 'translate.google.com/translate_a/element.js';
    let dom;

    afterEach(() => dom && dom.window.close());

    function createDom(brand) {
        dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
            url: 'https://meet.example/whoAreYou/test',
            runScripts: 'outside-only',
        });
        dom.window.BRAND = brand;
        dom.window.fetch = async (url) => ({
            ok: true,
            json: async () => readLocale(path.basename(url, '.json')),
        });
        return dom.window;
    }

    function googleLoaded(window) {
        return [...window.document.querySelectorAll('script')].some((s) => (s.src || '').includes(GOOGLE_SRC));
    }

    async function settle() {
        for (let i = 0; i < 5; i++) await tick();
    }

    it('does not load Google on pages without I18n.js when the mode is native', async () => {
        const window = createDom({ app: { language: 'nl', translationMode: 'native' } });
        window.eval(translateSource);
        window.document.dispatchEvent(new window.Event('brand:ready'));
        await settle();
        assert.equal(googleLoaded(window), false);
    });

    it('still loads Google on pages without I18n.js in the default google mode', async () => {
        const window = createDom({ app: { language: 'nl', translationMode: 'google' } });
        window.brandReady = true;
        window.eval(translateSource);
        await settle();
        assert.equal(googleLoaded(window), true);
    });

    it('does not load Google with I18n.js in native mode, even if brand:ready fired before I18n loaded', async () => {
        const window = createDom({ app: { language: 'nl', translationMode: 'native' } });
        window.brandReady = true;
        window.eval(i18nSource);
        window.eval(translateSource);
        const native = await window.i18n.ready;
        await settle();
        assert.equal(native, true);
        assert.equal(window.i18n.googleAllowed, false);
        assert.equal(googleLoaded(window), false);
    });

    it('loads I18n.js before Translate.js (both deferred) on every page that uses Translate.js', () => {
        const viewsDir = path.join(root, 'public/views');
        const pages = fs
            .readdirSync(viewsDir)
            .filter((file) => file.endsWith('.html'))
            .filter((file) => fs.readFileSync(path.join(viewsDir, file), 'utf8').includes('js/Translate.js'));
        assert.ok(pages.includes('whoAreYou.html') && pages.includes('login.html'));
        for (const file of pages) {
            const html = fs.readFileSync(path.join(viewsDir, file), 'utf8');
            const tag = (name) => (html.match(new RegExp(`<script[^>]*src="\\.\\./js/${name}\\.js"[^>]*>`)) || [])[0];
            for (const name of ['Brand', 'I18n', 'Translate']) {
                assert.ok(tag(name), `${file}: missing ${name}.js`);
                assert.match(tag(name), /\bdefer\b/, `${file}: ${name}.js must be deferred`);
                assert.doesNotMatch(tag(name), /\basync\b/, `${file}: ${name}.js must not be async`);
            }
            assert.ok(html.indexOf(tag('Brand')) < html.indexOf(tag('I18n')), `${file}: Brand.js before I18n.js`);
            assert.ok(
                html.indexOf(tag('I18n')) < html.indexOf(tag('Translate')),
                `${file}: I18n.js before Translate.js`
            );
        }
    });
});

describe('waiting room elapsed time (whoAreYou)', () => {
    const whoAreYouSource = fs.readFileSync(path.join(root, 'public/js/WhoAreYou.js'), 'utf8');
    let dom;

    afterEach(() => dom && dom.window.close());

    function load({ brand, i18n, brandReady = false }) {
        dom = new JSDOM(
            `<p id="waitingStatus"></p><a id="loginLink"></a>
            <div id="waitingRoomName"><span id="waitingRoomNameText"></span></div>
            <span id="waitingElapsedText">Just started waiting</span>`,
            { url: 'https://meet.example/whoAreYou/test', runScripts: 'outside-only' }
        );
        const { window } = dom;
        window.BRAND = brand;
        window.i18n = i18n;
        window.brandReady = brandReady;
        window.filterXSS = (value) => value;
        window.axios = { post: () => new Promise(() => {}) };
        window.eval(`${whoAreYouSource}\nwindow.__updateElapsedTime = updateElapsedTime;`);
        return window;
    }

    const text = (window) => window.document.getElementById('waitingElapsedText').textContent;

    function elapseMinutes(window, minutes) {
        window.__realNow = window.__realNow || window.Date.now.bind(window.Date);
        window.Date.now = () => window.__realNow() + minutes * 60 * 1000;
        window.__updateElapsedTime();
    }

    it('shows the configured "just started" text immediately on brand:ready', () => {
        const window = load({ brand: { whoAreYou: { waitingRoomElapsedJust: 'Je wacht net' } } });
        assert.equal(text(window), 'Just started waiting');
        window.document.dispatchEvent(new window.Event('brand:ready'));
        assert.equal(text(window), 'Je wacht net');
    });

    it('shows the configured "just started" text immediately when brand is already resolved', () => {
        const window = load({
            brand: { whoAreYou: { waitingRoomElapsedJust: 'Je wacht net' } },
            brandReady: true,
        });
        assert.equal(text(window), 'Je wacht net');
    });

    it('localizes the minutes unit in native mode', () => {
        const window = load({
            brand: { whoAreYou: { waitingRoomElapsedMinutes: 'Je wacht al {minutes}' } },
            i18n: { googleAllowed: false, isNative: () => true, getLang: () => 'nl' },
            brandReady: true,
        });
        elapseMinutes(window, 3);
        assert.equal(text(window), 'Je wacht al 3 minuten');
        elapseMinutes(window, 1);
        assert.equal(text(window), 'Je wacht al 1 minuut');
    });

    it('keeps the English unit when Google Translate handles the page', () => {
        const window = load({
            brand: { whoAreYou: { waitingRoomElapsedMinutes: 'Waiting for {minutes}' } },
            i18n: { googleAllowed: true, isNative: () => false, getLang: () => 'nl' },
            brandReady: true,
        });
        elapseMinutes(window, 1);
        assert.equal(text(window), 'Waiting for 1 minute');
        elapseMinutes(window, 3);
        assert.equal(text(window), 'Waiting for 3 minutes');
    });
});

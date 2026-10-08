'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const sinon = require('sinon');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/js/VideoDrawing.js'), 'utf8');

describe('screen annotation single selection', () => {
    let dom;
    let overlay;

    beforeEach(() => {
        dom = new JSDOM('<div id="screen"></div>', { runScripts: 'outside-only' });
        dom.window.fabric = {
            Canvas: function (element, options) {
                Object.assign(this, options, {
                    wrapperEl: element.parentElement,
                    on() {},
                    discardActiveObject() {},
                    requestRenderAll() {},
                });
            },
        };
        dom.window.eval(`${source}\nwindow.Overlay = VideoDrawingOverlay;`);
        const Overlay = dom.window.Overlay;
        Overlay.prototype._setupBrush = () => {};
        Overlay.prototype._setupPathListener = () => {};
        Overlay.prototype._setupResizeObserver = () => {};
        Overlay.getLocalDrawerId = () => 'drawer';
        overlay = new Overlay(dom.window.document.getElementById('screen'), 'screen-producer');
    });

    afterEach(() => dom.window.close());

    it('disables box selection and modifier-key grouping when creating the canvas', () => {
        assert.equal(overlay.fabricCanvas.selection, false);
        assert.equal(overlay.fabricCanvas.selectionKey, null);
    });

    it('keeps individual authorized objects selectable without enabling groups across tool changes', () => {
        const ownObject = {};
        const otherObject = {};
        overlay.annotations.set('own', { drawerId: 'drawer', object: ownObject });
        overlay.annotations.set('other', { drawerId: 'other-drawer', object: otherObject });

        for (const tool of ['select', 'pencil', 'select', null, 'select']) {
            overlay.setTool(tool);
            assert.equal(overlay.fabricCanvas.selection, false);
            assert.equal(overlay.fabricCanvas.selectionKey, null);
            assert.equal(ownObject.selectable, tool === 'select');
            assert.equal(ownObject.evented, tool === 'select');
            assert.equal(otherObject.selectable, false);
            assert.equal(otherObject.evented, false);
        }
    });
});

describe('screen annotation text toolbar', () => {
    let dom;
    let overlay;
    let editor;
    let input;
    let emitted;
    let history;

    const pointer = { preventDefault() {}, clientX: 80, clientY: 60 };

    beforeEach(() => {
        dom = new JSDOM('<div id="screen"><div id="canvas"></div></div>', { runScripts: 'outside-only' });
        dom.window.i18n = { t: (label, namespace) => `${namespace}:${label}` };
        dom.window.setTippy = (id, content, placement) => {
            const element = dom.window.document.getElementById(id);
            element._tippy = {
                __i18nSrc: content,
                placement,
                destroy() {
                    delete element._tippy;
                },
            };
        };
        dom.window.eval(`${source}\nwindow.Overlay = VideoDrawingOverlay;`);
        const Overlay = dom.window.Overlay;
        Overlay.getLocalDrawerId = () => 'drawer';
        Overlay.resolveDrawerName = () => 'Drawer';
        Overlay.onEmitDrawing = (data) => {
            emitted = data;
        };
        overlay = Object.create(Overlay.prototype);
        const screen = dom.window.document.getElementById('screen');
        const canvas = dom.window.document.getElementById('canvas');
        screen.getBoundingClientRect = canvas.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            width: 800,
            height: 600,
        });
        Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
        Object.assign(overlay, {
            cameraDivEl: screen,
            fabricCanvas: { wrapperEl: canvas, discardActiveObject() {}, requestRenderAll() {} },
            textStyle: {},
            textAnnotations: new Map(),
            annotations: new Map(),
            producerId: 'screen-producer',
            deleteButton: dom.window.document.createElement('button'),
            _recordHistory: (...commands) => {
                history = commands;
            },
        });
        emitted = history = undefined;
        overlay._beginTextInput(pointer);
        editor = overlay.textInput;
        input = editor.querySelector('textarea');
    });

    afterEach(() => dom.window.close());

    it('sizes new and reopened editors to their toolbar rather than a percentage of the canvas', () => {
        const prototype = dom.window.HTMLElement.prototype;
        Object.defineProperty(prototype, 'scrollWidth', { configurable: true, get: () => 280 });
        Object.defineProperty(prototype, 'offsetWidth', {
            configurable: true,
            get() {
                if (this.classList.contains('video-drawing-text-appearance')) return 36;
                if (this.classList.contains('video-drawing-text-actions')) return 69;
                return 480;
            },
        });
        Object.defineProperty(prototype, 'clientWidth', { configurable: true, get: () => 466 });
        overlay._beginTextInput(pointer);
        assert.equal(overlay.textInput.style.width, '399px');
        overlay._beginTextInput(pointer, {
            text: 'Wide note',
            x: 0.1,
            y: 0.1,
            boxWidth: 0.8,
            element: dom.window.document.createElement('div'),
        });
        assert.equal(overlay.textInput.style.width, '399px');
    });

    it('widens narrow saved text editors and caps their width to the screen-share frame', () => {
        const annotation = {
            text: 'Narrow note',
            x: 0.1,
            y: 0.1,
            boxWidth: 0.15,
            element: dom.window.document.createElement('div'),
        };
        overlay._beginTextInput(pointer, annotation);
        assert.equal(overlay.textInput.style.width, '480px');
        overlay.cameraDivEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 300 });
        overlay._beginTextInput(pointer, annotation);
        assert.equal(overlay.textInput.style.width, '304px');
    });

    it('groups primary formatting, fixed actions and hidden occasional controls with translated tooltips', () => {
        assert.equal(editor.getAttribute('aria-label'), 'labels:Edit screen text annotation');
        assert.equal(
            editor.querySelector('.video-drawing-text-formatting').getAttribute('aria-label'),
            'labels:Text formatting'
        );
        assert.equal(editor.querySelectorAll('.video-drawing-text-formatting button').length, 5);
        assert.equal(editor.querySelectorAll('.video-drawing-text-actions button').length, 2);
        assert.equal(editor.querySelector('.video-drawing-text-more-panel').hidden, true);
        assert.equal(editor.querySelector('.video-drawing-text-background-color').disabled, false);
        for (const control of editor.querySelectorAll('button, input, select')) {
            assert.ok(control.getAttribute('aria-label').startsWith('tooltips:'));
            assert.equal(control._tippy.placement, 'bottom');
            assert.equal(control.hasAttribute('title'), false);
        }
    });

    it('streams a live draft while typing and clears it when the editor closes', () => {
        const drafts = [];
        dom.window.Overlay.onEmitDrawing = (data) => drafts.push(data);
        overlay._canDraw = () => true;
        input.value = 'Hello';
        input.dispatchEvent(new dom.window.Event('input'));
        input.value = 'Hello world';
        input.dispatchEvent(new dom.window.Event('input'));
        assert.equal(drafts.length, 0);
        editor.querySelector('.video-drawing-text-cancel').click();
        assert.equal(drafts.length, 1);
        assert.equal(drafts[0].action, 'draft');
        assert.equal(drafts[0].text, '');
    });

    it('shows remote drafts as unmanageable temporary text and removes them when emptied', () => {
        overlay._positionTextAnnotation = () => {};
        const draft = { action: 'draft', drawerId: 'peer', annotationId: 'draft', text: 'Hi', x: 0.1, y: 0.1 };
        overlay.receiveText(draft);
        assert.equal(overlay.textAnnotations.get('draft:peer').element.querySelector('button'), null);
        overlay.receiveText({ ...draft, text: 'Hi there' });
        assert.equal(overlay.textAnnotations.size, 1);
        assert.equal(overlay.textAnnotations.get('draft:peer').text, 'Hi there');
        assert.ok(overlay.textAnnotations.get('draft:peer').element.classList.contains('video-drawing-text-highlight'));
        overlay.receiveText({ ...draft, text: '' });
        assert.equal(overlay.textAnnotations.size, 0);
        overlay.receiveText({ ...draft, action: 'create', annotationId: 'saved' });
        assert.ok(overlay.textAnnotations.get('saved').element.classList.contains('video-drawing-text-highlight'));
    });

    it('cycles alignment, previews formatting and persists all new fields', () => {
        input.value = 'Formatted annotation';
        const alignment = editor.querySelector('.video-drawing-text-alignment');
        for (const value of ['center', 'right', 'left']) {
            alignment.click();
            assert.equal(input.style.textAlign, value);
            assert.equal(alignment.dataset.alignment, value);
            assert.ok(alignment._tippy.__i18nSrc.includes(value));
        }
        for (const [key, shiftKey] of [
            ['b', false],
            ['i', false],
            ['u', false],
            ['x', true],
            ['e', true],
        ]) {
            input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey }));
        }
        assert.equal(input.style.textDecoration, 'underline line-through');
        const size = editor.querySelector('.video-drawing-text-size');
        size.value = '24';
        size.dispatchEvent(new dom.window.Event('change'));
        editor.querySelector('[aria-expanded]').click();
        const panel = editor.querySelector('.video-drawing-text-more-panel');
        panel.querySelector('button').click();
        const background = panel.querySelector('input');
        assert.equal(background.disabled, false);
        background.value = '#ff0000';
        background.dispatchEvent(new dom.window.Event('input'));
        panel.querySelector('select').value = '30';
        const controls = [...editor.querySelectorAll('button, input, select')];
        editor.querySelector('.video-drawing-text-save').click();
        for (const [key, value] of Object.entries({
            bold: true,
            italic: true,
            underline: true,
            strikethrough: true,
            fontSize: 24,
            textAlign: 'center',
            backgroundColor: '#ff0000',
            rotation: 30,
        })) {
            assert.equal(emitted[key], value);
        }
        const annotation = overlay.textAnnotations.get(emitted.annotationId);
        assert.equal(annotation.element.style.transform, 'rotate(30deg)');
        assert.equal(annotation.element.style.textAlign, 'center');
        assert.ok(annotation.element.classList.contains('video-drawing-text-has-background'));
        assert.equal(history[1][0].annotation.rotation, 30);
        assert.equal(editor.isConnected, false);
        assert.ok(controls.every((control) => !control._tippy));
    });

    for (const eventType of ['input', 'change']) {
        it(`enables the background on color ${eventType} and allows toggling it off and on`, () => {
            input.value = 'Colored background';
            editor.querySelector('[aria-expanded]').click();
            const background = editor.querySelector('.video-drawing-text-background-color');
            const toggle = editor.querySelector('.fa-fill-drip');
            assert.equal(toggle.getAttribute('aria-pressed'), 'false');
            assert.equal(background.disabled, false);
            background.focus();
            background.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
            assert.equal(editor.querySelector('.video-drawing-text-more-panel').hidden, false);
            background.value = '#00ff00';
            background.dispatchEvent(new dom.window.Event(eventType));
            assert.equal(toggle.getAttribute('aria-pressed'), 'true');
            assert.equal(input.style.backgroundColor, 'rgb(0, 255, 0)');
            assert.equal(input.style.getPropertyPriority('background'), 'important');
            assert.equal(input.style.backgroundImage, 'none');
            toggle.click();
            assert.equal(input.style.backgroundColor, 'transparent');
            assert.equal(input.style.getPropertyPriority('background'), 'important');
            assert.equal(input.style.backgroundImage, 'none');
            assert.equal(background.disabled, false);
            toggle.click();
            assert.equal(input.style.backgroundColor, 'rgb(0, 255, 0)');
            editor.querySelector('.video-drawing-text-save').click();
            assert.equal(emitted.backgroundColor, '#00ff00');
        });
    }

    it('dismisses More when focus moves to a known element outside the editor', () => {
        editor.querySelector('[aria-expanded]').click();
        const outside = dom.window.document.createElement('button');
        dom.window.document.body.appendChild(outside);
        editor.querySelector('.video-drawing-text-background-color').focus();
        outside.focus();
        assert.equal(editor.querySelector('.video-drawing-text-more-panel').hidden, true);
        assert.equal(editor.isConnected, true);
    });

    it('dismisses More first, then cancels from any toolbar control and destroys tooltips', () => {
        const more = editor.querySelector('[aria-expanded]');
        more.click();
        input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(editor.querySelector('.video-drawing-text-more-panel').hidden, true);
        assert.equal(editor.isConnected, true);
        more.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(editor.isConnected, false);
        overlay._beginTextInput(pointer);
        const controls = [...overlay.textInput.querySelectorAll('button, input, select')];
        overlay.textInput.querySelector('.video-drawing-text-cancel').click();
        assert.equal(overlay.textInput, null);
        assert.equal(emitted, undefined);
        assert.ok(controls.every((control) => !control._tippy));
    });

    it('duplicates styles and allows selected text deletion with reversible history', () => {
        input.value = 'Duplicate me';
        editor.querySelector('.fa-underline').click();
        editor.querySelector('.video-drawing-text-save').click();
        const original = overlay.textAnnotations.get(emitted.annotationId);
        original.element.querySelector('.video-drawing-text-duplicate').click();
        const duplicate = overlay.textAnnotations.get(emitted.annotationId);
        assert.notEqual(duplicate.annotationId, original.annotationId);
        assert.equal(duplicate.underline, true);
        assert.equal(duplicate.drawerId, 'drawer');
        assert.equal(duplicate.x, original.x + 0.02);
        overlay._selectTextAnnotation(duplicate.annotationId);
        assert.equal(overlay.deleteButton.disabled, false);
        assert.ok(duplicate.element.classList.contains('video-drawing-text-selected'));
        overlay.deleteSelectedAnnotation();
        assert.equal(overlay.textAnnotations.size, 1);
        assert.equal(emitted.action, 'delete');
        assert.equal(history[0][0].annotation.underline, true);
        assert.equal(overlay.selectedTextAnnotationId, null);
    });

    it('restores hidden annotations and clears old tooltips when replacing an editor', () => {
        input.value = 'Edit me';
        editor.querySelector('.video-drawing-text-save').click();
        const annotation = overlay.textAnnotations.get(emitted.annotationId);
        overlay._beginTextInput(pointer, annotation);
        const controls = [...overlay.textInput.querySelectorAll('button, input, select')];
        overlay._beginTextInput(pointer);
        assert.equal(annotation.element.classList.contains('video-drawing-text-editing'), false);
        assert.ok(controls.every((control) => !control._tippy));
    });

    it('defaults legacy and invalid styles safely', () => {
        const style = overlay._getTextStyle({
            underline: 'true',
            strikethrough: 1,
            textAlign: 'justify',
            backgroundColor: 'url(bad)',
            rotation: 90,
        });
        assert.equal(style.underline, false);
        assert.equal(style.strikethrough, false);
        assert.equal(style.textAlign, 'left');
        assert.equal(style.backgroundColor, 'transparent');
        assert.equal(style.rotation, 0);
    });
});

describe('screen annotation downloads and diamonds', () => {
    let dom;
    let overlay;
    let images;
    let video;
    let drawing;
    let label;

    beforeEach(() => {
        dom = new JSDOM('<div id="screen"><video></video><div id="canvas"></div></div>', {
            runScripts: 'outside-only',
        });
        dom.window.eval(`${source}\nwindow.Overlay = VideoDrawingOverlay;`);
        dom.window.Overlay.getLocalDrawerId = () => 'drawer';
        images = [];
        dom.window.HTMLCanvasElement.prototype.getContext = () => ({
            drawImage: (...args) => images.push(args),
            clearRect() {},
        });
        dom.window.HTMLCanvasElement.prototype.toBlob = (callback) => callback(new dom.window.Blob(['png']));
        video = dom.window.document.querySelector('video');
        Object.defineProperties(video, {
            videoWidth: { value: 1920 },
            videoHeight: { value: 1080 },
            readyState: { value: 2, configurable: true },
        });
        const wrapper = dom.window.document.getElementById('canvas');
        Object.defineProperties(wrapper, { offsetLeft: { value: 20 }, offsetTop: { value: 30 } });
        drawing = dom.window.document.createElement('canvas');
        label = { excludeFromExport: true, visible: true };
        overlay = Object.create(dom.window.Overlay.prototype);
        Object.assign(overlay, {
            cameraDivEl: dom.window.document.getElementById('screen'),
            fabricCanvas: {
                wrapperEl: wrapper,
                getWidth: () => 800,
                getHeight: () => 450,
                getObjects: () => [label, { visible: true }],
                toCanvasElement: () => {
                    assert.equal(label.visible, false);
                    return drawing;
                },
            },
            textAnnotations: new Map(),
            downloadButtons: [dom.window.document.createElement('button'), dom.window.document.createElement('button')],
        });
    });

    afterEach(() => dom.window.close());

    it('composes source-resolution video and drawings without author labels', async () => {
        const snapshot = await overlay.captureSnapshot();
        assert.equal(snapshot.width, 1920);
        assert.equal(snapshot.height, 1080);
        assert.deepEqual(images, [
            [video, 0, 0, 1920, 1080],
            [drawing, 0, 0, 1920, 1080],
        ]);
        assert.equal(label.visible, true);
    });

    it('restores label visibility when Fabric export fails', async () => {
        overlay.fabricCanvas.toCanvasElement = () => {
            throw new Error('Fabric failure');
        };
        await assert.rejects(overlay.captureSnapshot(), /Fabric failure/);
        assert.equal(label.visible, true);
    });

    it('exports only the video when annotations are hidden locally', async () => {
        overlay.annotationsHidden = true;
        overlay.textAnnotations.set('label', {});
        const snapshot = await overlay.captureSnapshot();
        assert.equal(snapshot.width, 1920);
        assert.deepEqual(images, [[video, 0, 0, 1920, 1080]]);
    });

    it('captures formatted text at canvas-relative coordinates and removes temporary DOM on failure', async () => {
        const element = dom.window.document.createElement('div');
        element.className = 'video-drawing-text-annotation video-drawing-text-selected video-drawing-text-bold';
        element.innerHTML =
            '<span class="video-drawing-text-content">Label</span><button>Edit</button><span class="video-drawing-text-author">Author</span>';
        element.style.transform = 'rotate(15deg)';
        for (const [property, value] of Object.entries({
            offsetLeft: 100,
            offsetTop: 90,
            offsetWidth: 150,
            offsetHeight: 60,
        })) {
            Object.defineProperty(element, property, { value });
        }
        overlay.textAnnotations.set('text', { element });
        dom.window.html2canvas = async (frame, options) => {
            const clone = frame.querySelector('.video-drawing-text-annotation');
            assert.equal(clone.style.left, '80px');
            assert.equal(clone.style.top, '60px');
            assert.equal(clone.style.transform, 'rotate(15deg)');
            assert.equal(clone.classList.contains('video-drawing-text-bold'), true);
            assert.equal(clone.classList.contains('video-drawing-text-selected'), false);
            assert.equal(clone.querySelector('button, .video-drawing-text-author'), null);
            assert.equal(options.scale, 2.4);
            throw new Error('renderer failure');
        };
        await assert.rejects(overlay.captureSnapshot(), /renderer failure/);
        assert.equal(dom.window.document.querySelector('[aria-hidden="true"]'), null);
        assert.equal(element.querySelector('button').textContent, 'Edit');
    });

    it('downloads a PNG through the existing room helper and restores controls', async () => {
        let saved;
        dom.window.rc = { saveBlobToFile: (blob, name) => (saved = { blob, name }) };
        await overlay.downloadSnapshot('png');
        assert.match(saved.name, /^screen-annotations-.*\.png$/);
        assert.ok(saved.blob instanceof dom.window.Blob);
        assert.equal(overlay.isCapturing, false);
        assert.ok(overlay.downloadButtons.every((button) => !button.disabled));
    });

    it('preserves source resolution when the text renderer returns rounded display dimensions', async () => {
        const element = dom.window.document.createElement('div');
        overlay.textAnnotations.set('text', { element });
        const rendered = dom.window.document.createElement('canvas');
        rendered.width = 1920;
        rendered.height = 1087;
        dom.window.html2canvas = async () => rendered;
        const snapshot = await overlay.captureSnapshot();
        assert.equal(snapshot.width, 1920);
        assert.equal(snapshot.height, 1080);
        assert.deepEqual(images.at(-1), [rendered, 0, 0, 1920, 1080]);
    });

    it('downloads a source-sized single-page PDF', async () => {
        let config;
        let image;
        let name;
        dom.window.jspdf = {
            jsPDF: class {
                constructor(options) {
                    config = options;
                }
                addImage(...args) {
                    image = args;
                }
                save(file) {
                    name = file;
                }
            },
        };
        await overlay.downloadSnapshot('pdf');
        assert.equal(config.orientation, 'landscape');
        assert.equal(config.unit, 'px');
        assert.deepEqual(Array.from(config.format), [1920, 1080]);
        assert.deepEqual(image.slice(1), ['PNG', 0, 0, 1920, 1080]);
        assert.match(name, /^screen-annotations-.*\.pdf$/);
        assert.ok(overlay.downloadButtons.every((button) => !button.disabled));
    });

    it('reports missing frames and libraries without leaving controls disabled', async () => {
        let reported;
        dom.window.console.error = () => {};
        dom.window.rc = { userLog: (type, message) => (reported = { type, message }) };
        Object.defineProperty(video, 'readyState', { value: 0, configurable: true });
        await overlay.downloadSnapshot('png');
        assert.equal(reported.message, 'Unable to download screen annotations');
        assert.equal(reported.type, 'error');
        assert.equal(images.length, 0);
        Object.defineProperty(video, 'readyState', { value: 2 });
        await overlay.downloadSnapshot('pdf');
        assert.equal(overlay.isCapturing, false);
        assert.ok(overlay.downloadButtons.every((button) => !button.disabled));
    });

    it('prevents overlapping downloads', async () => {
        let finish;
        let captures = 0;
        overlay.captureSnapshot = () => {
            captures++;
            return new Promise((resolve) => (finish = resolve));
        };
        dom.window.rc = { saveBlobToFile() {} };
        const download = overlay.downloadSnapshot('png');
        assert.ok(overlay.downloadButtons.every((button) => button.disabled));
        await overlay.downloadSnapshot('png');
        assert.equal(captures, 1);
        finish(dom.window.document.createElement('canvas'));
        await download;
        assert.ok(overlay.downloadButtons.every((button) => !button.disabled));
    });

    it('renders a closed diamond in either drag direction using normalized coordinates', () => {
        dom.window.fabric = {
            Polyline: class {
                constructor(points, options) {
                    this.points = points;
                    Object.assign(this, options);
                }
                set(options) {
                    Object.assign(this, options);
                }
            },
        };
        for (const points of [
            [
                { x: 0.2, y: 0.2 },
                { x: 0.6, y: 0.6 },
            ],
            [
                { x: 0.6, y: 0.6 },
                { x: 0.2, y: 0.2 },
            ],
        ]) {
            const object = overlay._createAnnotationObject({ tool: 'diamond', color: '#ffeb3b', width: 0.004, points });
            const vertices = Array.from(object.points, ({ x, y }) => [x, y]);
            assert.equal(vertices.length, 5);
            assert.deepEqual(vertices[0], vertices[4]);
            assert.deepEqual(
                vertices.slice(0, 4).sort(),
                [
                    [320, 90],
                    [480, 180],
                    [320, 270],
                    [160, 180],
                ].sort()
            );
            assert.equal(object.stroke, '#ffeb3b');
        }
    });
});

describe('server screen text style validation', () => {
    const server = fs.readFileSync(path.join(root, 'app/src/Server.js'), 'utf8');
    const start = server.indexOf('const getTextStyle = (fallback = {}) => {');
    const end = server.indexOf("if (action === 'create' || action === 'restore')", start);
    const validate = (data, fallback = {}) =>
        vm.runInNewContext(`${server.slice(start, end)} getTextStyle(fallback);`, { data, fallback });

    it('retains valid styles and falls back to stored styles on updates', () => {
        const fields = {
            underline: true,
            strikethrough: true,
            textAlign: 'center',
            backgroundColor: '#1a237e',
            rotation: 15,
        };
        for (const result of [validate(fields), validate({}, fields)]) {
            for (const [key, value] of Object.entries(fields)) assert.equal(result[key], value);
        }
        assert.equal(validate({}).backgroundColor, 'transparent');
        assert.equal(validate({}).rotation, 0);
    });

    it('rejects malformed styles before storing or broadcasting them', () => {
        for (const invalid of [
            { underline: 'true' },
            { strikethrough: 1 },
            { textAlign: 'justify' },
            { backgroundColor: 'red' },
            { backgroundColor: 'url(bad)' },
            { rotation: 90 },
            { rotation: '15' },
        ]) {
            assert.equal(validate(invalid), null);
        }
    });
});

describe('server diamond annotation relay', () => {
    const server = fs.readFileSync(path.join(root, 'app/src/Server.js'), 'utf8');
    const start = server.indexOf("socket.on('videoDrawing', (dataObject) => {");
    const end = server.indexOf("socket.on('setVideoOff'", start);
    let receive;
    let annotations;
    let relayed;
    let room;
    let socket;

    beforeEach(() => {
        annotations = new Map();
        relayed = [];
        room = {
            _moderator: {},
            videoDrawingPermissions: new Map(),
            getPeer: () => ({ peer_name: 'Drawer' }),
            isScreenProducer: (producerId) => producerId === 'screen',
            getProducerOwnerId: () => 'owner',
            getVideoDrawingAnnotations: () => annotations,
            getVideoTextAnnotations: () => annotations,
            broadCast: (...args) => relayed.push(args),
        };
        socket = { id: 'drawer', on: (event, handler) => (receive = handler), emit: (...args) => relayed.push(args) };
        vm.runInNewContext(server.slice(start, end), {
            socket,
            roomExists: () => true,
            checkXSS: (data) => ({ ...data }),
            getRoom: () => room,
        });
    });

    it('allows only the active screen owner to lock and gates every annotation type', () => {
        const permission = { type: 'permissions', producerId: 'screen', allowed: false };
        receive(permission);
        assert.equal(room.videoDrawingPermissions.size, 0);
        socket.id = 'owner';
        receive({ ...permission, allowed: 'false' });
        receive({ ...permission, producerId: 'camera' });
        assert.equal(relayed.length, 0);
        receive(permission);
        assert.equal(room.videoDrawingPermissions.get('screen'), false);
        assert.equal(relayed.length, 2);
        socket.id = 'drawer';
        for (const type of ['annotation', 'text', 'pen', 'laser']) {
            for (const action of ['create', 'move', 'delete', 'clear', 'restore']) {
                receive({ type, action, producerId: 'screen', paths: [{}], points: [{ x: 0.1, y: 0.2 }] });
            }
        }
        assert.equal(relayed.length, 2);
        socket.id = 'owner';
        receive({ type: 'laser', producerId: 'screen', points: [{ x: 0.1, y: 0.2 }] });
        assert.equal(relayed.length, 3);
        receive({ ...permission, allowed: true });
        assert.equal(room.videoDrawingPermissions.size, 0);
        socket.id = 'drawer';
        receive({ type: 'laser', producerId: 'screen', points: [{ x: 0.1, y: 0.2 }] });
        assert.equal(relayed.length, 6);
    });

    it('stores and relays diamonds, supports movement, and rejects unsupported tools', () => {
        const annotation = {
            type: 'annotation',
            action: 'create',
            annotationId: 'diamond',
            producerId: 'screen',
            tool: 'diamond',
            color: '#ffeb3b',
            width: 0.004,
            points: [
                { x: 0.2, y: 0.2 },
                { x: 0.6, y: 0.6 },
            ],
        };
        receive(annotation);
        assert.equal(annotations.get('diamond').tool, 'diamond');
        assert.equal(relayed[0][2].drawerId, 'drawer');
        const points = [
            { x: 0.3, y: 0.3 },
            { x: 0.7, y: 0.7 },
        ];
        receive({ ...annotation, action: 'move', points });
        assert.deepEqual(annotations.get('diamond').points, points);
        receive({ ...annotation, annotationId: 'invalid', tool: 'unsupported' });
        assert.equal(annotations.size, 1);
        assert.equal(relayed.length, 2);
    });

    it('relays text drafts with authenticated identity without persisting them', () => {
        const draft = {
            type: 'text',
            action: 'draft',
            producerId: 'screen',
            annotationId: 'draft',
            text: 'Typing',
            x: 0.1,
            y: 0.2,
            drawerId: 'spoofed',
        };
        receive(draft);
        assert.equal(relayed.length, 1);
        assert.equal(relayed[0][2].drawerId, 'drawer');
        assert.equal(relayed[0][2].peer_name, 'Drawer');
        receive({ ...draft, text: '' });
        assert.equal(relayed.length, 2);
        receive({ ...draft, text: 'x'.repeat(1001) });
        receive({ ...draft, x: 2 });
        receive({ ...draft, color: 'red' });
        assert.equal(relayed.length, 2);
        assert.equal(annotations.size, 0);
    });

    it('relays temporary laser positions with authenticated identity without persisting them', () => {
        const laser = {
            type: 'laser',
            producerId: 'screen',
            drawerId: 'spoofed',
            peer_name: 'spoofed',
            points: [{ x: 0.25, y: 0.75 }],
        };
        receive(laser);
        assert.equal(relayed[0][2].drawerId, 'drawer');
        assert.equal(relayed[0][2].peer_name, 'Drawer');
        assert.equal(relayed[0][2].end, false);
        receive({ ...laser, end: true });
        assert.equal(relayed[1][2].end, true);
        assert.equal(annotations.size, 0);
        for (const points of [
            [],
            [{ x: -0.1, y: 0 }],
            [{ x: 0, y: 2 }],
            [{ x: NaN, y: 0 }],
            [{ x: '0', y: 0 }],
            [null],
            [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
            ],
        ]) {
            receive({ ...laser, points });
        }
        receive({ ...laser, producerId: 'camera' });
        assert.equal(relayed.length, 2);
    });
});

describe('screen annotation laser pointer and color swatches', () => {
    let dom;
    let overlay;
    let clock;
    let emitted;

    beforeEach(() => {
        dom = new JSDOM('<div id="screen"><button id="draw"></button></div>', { runScripts: 'outside-only' });
        clock = sinon.useFakeTimers({ global: dom.window });
        class FabricObject {
            constructor(options = {}) {
                Object.assign(this, options);
            }
            set(options) {
                Object.assign(this, options);
            }
            setCoords() {}
            getBoundingRect() {
                return { left: this.left, top: this.top, width: 12, height: 12 };
            }
        }
        dom.window.fabric = {
            Circle: FabricObject,
            Shadow: FabricObject,
            Rect: FabricObject,
            Text: class extends FabricObject {
                constructor(text, options) {
                    super(options);
                    this.width = 50;
                }
            },
            Group: class extends FabricObject {
                constructor(objects, options) {
                    super(options);
                }
            },
            Canvas: function (element, options) {
                let width = 800;
                let height = 450;
                const objects = [];
                const upper = element.ownerDocument.createElement('canvas');
                element.parentElement.appendChild(upper);
                upper.getBoundingClientRect = () => ({ left: 0, top: 0, width, height });
                Object.assign(this, options, {
                    wrapperEl: element.parentElement,
                    upperCanvasEl: upper,
                    freeDrawingBrush: {},
                    on() {},
                    discardActiveObject() {},
                    requestRenderAll() {},
                    dispose() {},
                    getWidth: () => width,
                    getHeight: () => height,
                    setWidth: (value) => (width = value),
                    setHeight: (value) => (height = value),
                    getObjects: () => objects,
                    add: (object) => objects.push(object),
                    remove: (object) => {
                        const index = objects.indexOf(object);
                        if (index >= 0) objects.splice(index, 1);
                    },
                    clear: () => objects.splice(0),
                });
            },
        };
        dom.window.isMobileDevice = false;
        dom.window.eval(`${source}\nwindow.Overlay = VideoDrawingOverlay;`);
        const Overlay = dom.window.Overlay;
        Overlay.prototype._setupResizeObserver = () => {};
        Overlay.getLocalDrawerId = () => 'local';
        Overlay.resolveDrawerName = () => 'Drawer';
        emitted = [];
        Overlay.onEmitDrawing = (data) => emitted.push(data);
        overlay = new Overlay(dom.window.document.getElementById('screen'), 'screen-producer');
        overlay.bindControls(dom.window.document.getElementById('draw'));
    });

    afterEach(() => {
        overlay.destroy();
        clock.restore();
        dom.window.close();
    });

    function move(clientX = 400, clientY = 225) {
        overlay.fabricCanvas.upperCanvasEl.dispatchEvent(
            new dom.window.MouseEvent('pointermove', { clientX, clientY })
        );
    }

    it('reopens a collapsed toolbar without disabling the selected drawing tool', () => {
        overlay.toolButtons.highlighter.click();
        overlay.toolbar.querySelector('.video-drawing-close').click();
        assert.equal(overlay.isToolbarCollapsed, true);
        assert.equal(overlay.drawingButton.getAttribute('aria-label'), 'Show annotation toolbar');
        overlay.drawingButton.click();
        assert.equal(overlay.isToolbarCollapsed, false);
        assert.equal(overlay.isActive, true);
        assert.equal(overlay.activeTool, 'highlighter');
        overlay.drawingButton.click();
        assert.equal(overlay.isActive, false);
    });

    it('opens only one secondary panel and restores focus when Escape dismisses it', () => {
        overlay.drawingButton.click();
        const tools = overlay.toolbarPanels.get('tools');
        const appearance = overlay.toolbarPanels.get('appearance');
        assert.equal(tools.panel.hidden, true);
        tools.button.click();
        assert.equal(tools.panel.hidden, false);
        assert.equal(tools.button.getAttribute('aria-expanded'), 'true');
        assert.equal(tools.button.getAttribute('aria-controls'), tools.panel.id);
        appearance.button.click();
        assert.equal(tools.panel.hidden, true);
        assert.equal(appearance.panel.hidden, false);
        overlay.colorInput.focus();
        overlay.colorInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(appearance.panel.hidden, true);
        assert.equal(dom.window.document.activeElement, appearance.button);
        assert.equal(overlay.isActive, true);
        appearance.button.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(overlay.isToolbarCollapsed, true);
        assert.equal(dom.window.document.activeElement, overlay.drawingButton);
    });

    it('dismisses secondary tools after selection and when clicking outside', () => {
        overlay.drawingButton.click();
        const tools = overlay.toolbarPanels.get('tools');
        tools.button.click();
        overlay.toolButtons.arrow.click();
        assert.equal(overlay.activeTool, 'arrow');
        assert.equal(tools.panel.hidden, true);
        assert.equal(tools.button.classList.contains('video-drawing-tool-active'), true);
        assert.equal(tools.button.classList.contains('fa-arrow-right-long'), true);
        assert.equal(dom.window.document.activeElement, tools.button);
        tools.button.click();
        overlay.fabricCanvas.upperCanvasEl.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
        assert.equal(tools.panel.hidden, true);
    });

    it('previews the current color and width and offers an explicit exit action', () => {
        overlay.drawingButton.click();
        overlay.setColor('#ff1744');
        assert.equal(overlay.appearanceButton.firstChild.style.backgroundColor, 'rgb(255, 23, 68)');
        overlay.widthInput.value = '0.008';
        overlay.widthInput.dispatchEvent(new dom.window.Event('input'));
        assert.equal(overlay.annotationWidth, 0.008);
        assert.equal(overlay.widthPreview.style.height, '8px');
        assert.equal(overlay.widthPreview.style.backgroundColor, 'rgb(255, 23, 68)');
        overlay.toolbarPanels.get('more').button.click();
        overlay.toolbar.querySelector('.video-drawing-exit').click();
        assert.equal(overlay.isActive, false);
        assert.equal(overlay.toolbarPanels.get('more').panel.hidden, true);
        assert.equal(dom.window.document.activeElement, overlay.drawingButton);
    });

    it('erases only local strokes and text across a sweep with grouped undo and redo', () => {
        for (const [annotationId, drawerId, center] of [
            ['first', 'local', 0.25],
            ['second', 'local', 0.75],
            ['remote', 'remote', 0.25],
        ]) {
            overlay.annotations.set(annotationId, {
                annotationId,
                drawerId,
                tool: 'pencil',
                color: '#ff0000',
                width: 0.004,
                points: [
                    { x: center, y: 0.4 },
                    { x: center, y: 0.6 },
                ],
                object: {},
            });
        }
        for (const [annotationId, drawerId] of [
            ['text', 'local'],
            ['remote-text', 'remote'],
        ]) {
            overlay.addTextAnnotation({ annotationId, drawerId, text: 'Label', x: 0.5, y: 0.5 });
            overlay.textAnnotations.get(annotationId).element.getBoundingClientRect = () => ({
                left: 390,
                top: 210,
                right: 450,
                bottom: 245,
            });
        }
        overlay.toolButtons.eraser.click();
        overlay._startErasing({ preventDefault() {}, clientX: 80, clientY: 225, pointerId: 1 });
        move(720, 225);
        overlay._finishErasing();
        assert.deepEqual([...overlay.annotations.keys()], ['remote']);
        assert.deepEqual([...overlay.textAnnotations.keys()], ['remote-text']);
        assert.equal(overlay.undoStack.length, 1);
        assert.equal(emitted.filter((data) => data.action === 'delete').length, 3);
        const commands = [];
        overlay._executeHistoryCommand = (command) => commands.push(command);
        overlay.undo();
        assert.equal(commands.length, 3);
        assert.ok(commands.every((command) => command.action === 'create'));
        overlay.redo();
        assert.equal(commands.length, 6);
        assert.ok(commands.slice(3).every((command) => command.action === 'delete'));
    });

    it('hides annotations locally, retains incoming text and leaves viewing controls available', () => {
        overlay.setTool('laser');
        move();
        overlay.visibilityButton.click();
        assert.equal(overlay.annotationsHidden, true);
        assert.equal(overlay.laserPointers.size, 0);
        assert.equal(overlay.visibilityButton.getAttribute('aria-label'), 'Show annotations');
        assert.equal(overlay.toolButtons.pencil.disabled, true);
        assert.equal(overlay.drawingButton.disabled, false);
        assert.equal(overlay.downloadButtons[0].disabled, false);
        overlay.receiveText({
            action: 'create',
            annotationId: 'incoming',
            drawerId: 'remote',
            text: 'Label',
            x: 0.2,
            y: 0.2,
        });
        assert.equal(overlay.textAnnotations.size, 1);
        overlay.visibilityButton.click();
        assert.equal(overlay.annotationsHidden, false);
        assert.equal(overlay.toolButtons.pencil.disabled, false);
        assert.equal(overlay.textAnnotations.size, 1);
    });

    it('locks editing, cancels unfinished shapes and enables text received while locked after unlocking', () => {
        overlay.setTool('rectangle');
        overlay._beginShape({ clientX: 100, clientY: 100 });
        assert.equal(overlay.annotations.size, 1);
        overlay.setParticipantsAllowed(false);
        assert.equal(overlay.annotations.size, 0);
        assert.equal(overlay.activeShape, null);
        assert.equal(overlay.activeTool, 'view');
        assert.equal(overlay.toolButtons.pencil.disabled, true);
        overlay.addTextAnnotation({ annotationId: 'owned', drawerId: 'local', text: 'Label', x: 0.2, y: 0.2 });
        const annotation = overlay.textAnnotations.get('owned');
        assert.equal(annotation.element.querySelectorAll('button').length, 3);
        overlay._duplicateTextAnnotation(annotation);
        overlay._deleteTextAnnotationWithHistory(annotation);
        overlay.clearAnnotations(true);
        overlay.undo();
        assert.equal(overlay.textAnnotations.size, 1);
        assert.equal(emitted.length, 0);
        overlay.setParticipantsAllowed(true);
        assert.equal(overlay._canManageText(annotation), true);
        assert.equal(overlay.toolButtons.pencil.disabled, false);
    });

    it('queues permission events before tiles exist and exposes red lock controls only to the owner', () => {
        const Overlay = dom.window.Overlay;
        assert.equal(overlay.permissionsButton, undefined);
        Overlay.receiveRemoteDrawing({ type: 'permissions', cameraId: 'queued', producerId: 'queued', allowed: false });
        const tile = dom.window.document.createElement('div');
        tile.id = 'queued';
        dom.window.document.body.appendChild(tile);
        const queued = new Overlay(tile, 'queued');
        queued.bindControls(dom.window.document.createElement('button'));
        assert.equal(queued.participantsAllowed, false);
        assert.equal(queued.toolButtons.pencil.disabled, true);
        queued.destroy();
        assert.equal(Overlay.pendingPermissions.size, 0);
        Overlay.getProducerOwnerId = () => 'local';
        const ownerTile = dom.window.document.createElement('div');
        ownerTile.id = 'owner';
        dom.window.document.body.appendChild(ownerTile);
        const owner = new Overlay(ownerTile, 'owner-producer');
        owner.bindControls(dom.window.document.createElement('button'));
        owner.permissionsButton.click();
        assert.equal(owner.participantsAllowed, false);
        assert.equal(owner.toolButtons.pencil.disabled, false);
        assert.equal(owner.permissionsButton.classList.contains('video-drawing-permissions-locked'), true);
        assert.equal(owner.permissionsButton.getAttribute('aria-label'), 'Enable participant annotations');
        assert.equal(emitted.at(-1).type, 'permissions');
        owner.destroy();
    });

    it('cancels an in-progress text drag on lock without emitting a move', () => {
        overlay.addTextAnnotation({ annotationId: 'dragged', drawerId: 'local', text: 'Label', x: 0.2, y: 0.2 });
        const annotation = overlay.textAnnotations.get('dragged');
        annotation.element.setPointerCapture = () => {};
        annotation.element.dispatchEvent(new dom.window.MouseEvent('pointerdown', { clientX: 100, clientY: 100 }));
        annotation.x = 0.5;
        annotation.y = 0.6;
        overlay.setParticipantsAllowed(false);
        annotation.element.dispatchEvent(new dom.window.MouseEvent('pointerup', { clientX: 200, clientY: 200 }));
        assert.equal(annotation.x, 0.2);
        assert.equal(annotation.y, 0.2);
        assert.equal(emitted.length, 0);
    });

    it('follows hover without drawing and throttles to the latest position', () => {
        overlay.toolButtons.laser.click();
        move();
        move(600, 300);
        assert.equal(overlay.laserPointers.size, 1);
        assert.equal(overlay.fabricCanvas.isDrawingMode, false);
        assert.equal(overlay.annotations.size, 0);
        assert.equal(overlay.undoStack.length, 0);
        assert.equal(emitted.length, 0);
        clock.tick(50);
        assert.equal(emitted.length, 1);
        assert.deepEqual(JSON.parse(JSON.stringify(emitted[0].points)), [{ x: 0.75, y: 0.6667 }]);
    });

    it('clears on leave, tool change, cancellation and touch release without delayed updates', () => {
        for (const reason of ['pointerleave', 'tool', 'pointercancel', 'pointerup']) {
            overlay.setTool('laser');
            move();
            if (reason === 'tool') overlay.setTool('pencil');
            else {
                const event = new dom.window.Event(reason);
                Object.defineProperty(event, 'pointerType', { value: 'touch' });
                overlay.fabricCanvas.upperCanvasEl.dispatchEvent(event);
            }
            assert.equal(overlay.laserPointers.size, 0);
            assert.equal(emitted.at(-1).end, true);
        }
        clock.tick(50);
        assert.equal(emitted.length, 4);
    });

    it('replaces remote positions, excludes pointers from export and expires stale pointers', () => {
        const receive = (point, end = false) =>
            dom.window.Overlay.receiveRemoteDrawing({
                type: 'laser',
                cameraId: 'screen',
                producerId: 'screen-producer',
                drawerId: 'remote',
                points: [point],
                end,
            });
        receive({ x: 0.1, y: 0.2 });
        const object = overlay.laserPointers.get('remote').object;
        receive({ x: 0.3, y: 0.4 });
        assert.equal(overlay.laserPointers.size, 1);
        assert.equal(overlay.laserPointers.get('remote').object, object);
        assert.equal(object.left, 240);
        assert.equal(object.excludeFromExport, true);
        assert.equal(overlay.annotations.size, 0);
        clock.tick(1000);
        assert.equal(overlay.laserPointers.size, 0);
        assert.equal(overlay.fabricCanvas.getObjects().length, 0);
        receive({ x: 0.5, y: 0.5 });
        receive({ x: 0.5, y: 0.5 }, true);
        assert.equal(overlay.laserPointers.size, 0);
    });

    it('cancels pending emissions and timers when destroyed', () => {
        overlay.setTool('laser');
        move();
        overlay.receiveLaser({ drawerId: 'remote', points: [{ x: 0.1, y: 0.1 }] });
        overlay.destroy();
        clock.tick(1000);
        assert.equal(emitted.filter((data) => data.type === 'laser').length, 1);
        assert.equal(emitted[0].end, true);
        assert.equal(overlay.laserPointers.size, 0);
        assert.equal(overlay._laserTimers.size, 0);
    });

    it('synchronizes swatches and custom colors without changing tools', () => {
        overlay.setTool('pencil');
        assert.equal(overlay.colorButtons.length, 5);
        assert.equal(overlay.colorButtons[0].getAttribute('aria-pressed'), 'true');
        overlay.colorButtons[1].click();
        assert.equal(overlay.annotationColor, '#ff1744');
        assert.equal(overlay.colorInput.value, '#ff1744');
        assert.equal(overlay.fabricCanvas.freeDrawingBrush.color, '#ff1744');
        assert.equal(overlay.activeTool, 'pencil');
        overlay.colorInput.value = '#123456';
        overlay.colorInput.dispatchEvent(new dom.window.Event('input'));
        assert.ok(overlay.colorButtons.every((button) => button.getAttribute('aria-pressed') === 'false'));
        overlay.colorInput.value = '#ffffff';
        overlay.colorInput.dispatchEvent(new dom.window.Event('input'));
        assert.equal(overlay.colorButtons[4].getAttribute('aria-pressed'), 'true');
    });
});

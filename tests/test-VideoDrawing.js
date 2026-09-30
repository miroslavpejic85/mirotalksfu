'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

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
        assert.equal(editor.querySelector('.video-drawing-text-background-color').disabled, true);
        for (const control of editor.querySelectorAll('button, input, select')) {
            assert.ok(control.getAttribute('aria-label').startsWith('tooltips:'));
            assert.equal(control._tippy.placement, 'bottom');
            assert.equal(control.hasAttribute('title'), false);
        }
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

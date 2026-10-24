'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');

const roomSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/Room.js'), 'utf8');
const start = roomSource.indexOf('function handleDropdownHover(');
const end = roomSource.indexOf('function showButtons()', start);
const handleDropdownHoverSource = roomSource.slice(start, end);

describe('dropdown hover open/close (#282)', () => {
    let dom;
    let document;
    let clock;
    let dropdown;
    let toggle;
    let menu;
    let item;
    let outside;
    let instance;

    beforeEach(() => {
        assert.ok(start > -1 && end > start, 'handleDropdownHover must exist in Room.js');
        dom = new JSDOM(`<!doctype html><html><body>
            <div id="outside"></div>
            <div class="dropdown dropup">
                <button class="dropdown-toggle"></button>
                <div class="dropdown-menu"><button id="item">Item</button></div>
            </div>
        </body></html>`);
        document = dom.window.document;
        dropdown = document.querySelector('.dropdown');
        toggle = document.querySelector('.dropdown-toggle');
        menu = document.querySelector('.dropdown-menu');
        item = document.getElementById('item');
        outside = document.getElementById('outside');

        clock = sinon.useFakeTimers();
        instance = null;
        class Dropdown {
            constructor() {
                this.open = false;
                instance = this;
            }
            static getInstance() {
                return instance;
            }
            show() {
                this.open = true;
            }
            hide() {
                this.open = false;
            }
        }

        const context = vm.createContext({
            window: { matchMedia: () => ({ matches: true }) },
            document,
            bootstrap: { Dropdown },
            console: { log() {} },
            setTimeout,
            clearTimeout,
        });
        vm.runInContext(`${handleDropdownHoverSource}; handleDropdownHover();`, context);
    });

    afterEach(() => {
        clock.restore();
        dom.window.close();
    });

    // Fire mouseleave/mouseenter like a browser does when the pointer moves from one element to another
    function move(from, to) {
        const chain = (node) => {
            const nodes = [];
            for (; node; node = node.parentNode) nodes.push(node);
            return nodes;
        };
        const fromChain = chain(from);
        const toChain = chain(to);
        const { MouseEvent } = dom.window;
        fromChain
            .filter((n) => !toChain.includes(n))
            .forEach((n) => n.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: to })));
        toChain
            .filter((n) => !fromChain.includes(n))
            .reverse()
            .forEach((n) => n.dispatchEvent(new MouseEvent('mouseenter', { relatedTarget: from })));
    }

    const isOpen = () => !!instance && instance.open;

    describe('menu inside the dropdown (bottom bar)', () => {
        it('opens on hover and closes shortly after the pointer leaves', () => {
            move(outside, toggle);
            assert.equal(isOpen(), true);

            move(toggle, outside);
            clock.tick(199);
            assert.equal(isOpen(), true);
            clock.tick(1);
            assert.equal(isOpen(), false);
        });

        it('stays open when the menu briefly appears under the pointer before being positioned', () => {
            // Firefox: the unpositioned menu overlaps the toggle, so the pointer "enters" it and
            // then "leaves" it back onto the toggle without ever leaving the dropdown.
            move(outside, toggle);
            move(toggle, item);
            move(item, toggle);
            clock.tick(1000);
            assert.equal(isOpen(), true);
        });

        it('closes after leaving the menu', () => {
            move(outside, toggle);
            move(toggle, item);
            move(item, outside);
            clock.tick(200);
            assert.equal(isOpen(), false);
        });
    });

    describe('menu portaled to <body> while open (participants list)', () => {
        beforeEach(() => {
            move(outside, toggle);
            document.body.appendChild(menu);
        });

        it('stays open when moving from the toggle across the gap into the menu', () => {
            move(toggle, outside);
            move(outside, item);
            clock.tick(1000);
            assert.equal(isOpen(), true);
        });

        it('stays open when moving from the menu back onto the toggle', () => {
            move(toggle, outside);
            move(outside, item);
            move(item, outside);
            move(outside, toggle);
            clock.tick(1000);
            assert.equal(isOpen(), true);
        });

        it('closes after leaving the menu', () => {
            move(toggle, outside);
            move(outside, item);
            move(item, outside);
            clock.tick(200);
            assert.equal(isOpen(), false);
        });
    });
});

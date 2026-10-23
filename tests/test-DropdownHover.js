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

describe('bottom bar dropdown hover (#282)', () => {
    let dom;
    let document;
    let clock;
    let dropdown;
    let toggle;
    let menu;
    let instance;

    beforeEach(() => {
        assert.ok(start > -1 && end > start, 'handleDropdownHover must exist in Room.js');
        dom = new JSDOM(`<!doctype html><html><body>
            <div class="dropdown dropup">
                <button class="dropdown-toggle"></button>
                <div class="dropdown-menu"><button id="item">Item</button></div>
            </div>
        </body></html>`);
        document = dom.window.document;
        dropdown = document.querySelector('.dropdown');
        toggle = document.querySelector('.dropdown-toggle');
        menu = document.querySelector('.dropdown-menu');

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

    const fire = (el, type) => el.dispatchEvent(new dom.window.MouseEvent(type));

    it('opens on hover and closes shortly after the pointer leaves the dropdown', () => {
        fire(dropdown, 'mouseenter');
        assert.equal(instance.open, true);

        fire(dropdown, 'mouseleave');
        clock.tick(199);
        assert.equal(instance.open, true);
        clock.tick(1);
        assert.equal(instance.open, false);
    });

    it('stays open when the menu briefly appears under the pointer before being positioned', () => {
        // Firefox: the unpositioned menu overlaps the toggle, so the pointer "enters" it and
        // then "leaves" it back onto the toggle without ever leaving the dropdown.
        fire(dropdown, 'mouseenter');
        fire(menu, 'mouseenter');
        fire(menu, 'mouseleave');
        clock.tick(1000);
        assert.equal(instance.open, true);
    });

    it('stays open when moving from the menu back onto the toggle across the gap', () => {
        fire(dropdown, 'mouseenter');
        // toggle -> gap -> menu
        fire(dropdown, 'mouseleave');
        fire(dropdown, 'mouseenter');
        fire(menu, 'mouseenter');
        // menu -> gap -> toggle
        fire(menu, 'mouseleave');
        fire(dropdown, 'mouseleave');
        fire(dropdown, 'mouseenter');
        clock.tick(1000);
        assert.equal(instance.open, true);
    });
});

'use strict';

require('should');

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const templateSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'RoomTemplate.js'), 'utf8');

describe('test-RoomTemplates', () => {
    let renderRoomTemplate;
    let document;

    beforeEach(() => {
        const dom = new JSDOM('<!doctype html><html><body></body></html>');
        document = dom.window.document;

        const context = vm.createContext({ document, module: {}, exports: {} });
        vm.runInContext(templateSource, context);
        renderRoomTemplate = context.renderRoomTemplate;
    });

    it('preserves empty string attributes used by placeholder options', () => {
        const template = document.createElement('template');
        template.id = 'breakoutRoomOptionTemplate';
        template.innerHTML = '<option data-template-attr-value="value" data-template-text="label"></option>';
        document.body.appendChild(template);

        const rendered = renderRoomTemplate('breakoutRoomOptionTemplate', {
            text: { label: 'Not assigned' },
            attrs: { value: '' },
        });

        const select = document.createElement('select');
        select.innerHTML = rendered;
        select.value.should.equal('');
        select.options.length.should.equal(1);
        select.options[0].textContent.should.equal('Not assigned');
        select.options[0].getAttribute('value').should.equal('');
    });

    it('still renders non-empty attributes normally', () => {
        const template = document.createElement('template');
        template.id = 'participantTemplate';
        template.innerHTML = '<div data-template-attr-data-peer-id="peerId" data-template-text="peerName"></div>';
        document.body.appendChild(template);

        const rendered = renderRoomTemplate('participantTemplate', {
            text: { peerName: 'Alice' },
            attrs: { peerId: 'peer-1' },
        });

        const wrapper = document.createElement('div');
        wrapper.innerHTML = rendered;

        wrapper.firstElementChild.textContent.should.equal('Alice');
        wrapper.firstElementChild.getAttribute('data-peer-id').should.equal('peer-1');
    });
});

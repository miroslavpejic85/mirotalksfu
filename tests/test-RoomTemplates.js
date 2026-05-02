'use strict';

require('should');

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

function extractNamedFunction(source, functionName) {
    const signature = `function ${functionName}`;
    const start = source.indexOf(signature);

    if (start === -1) {
        throw new Error(`Unable to find ${functionName} in source file`);
    }

    const paramsStart = source.indexOf('(', start);
    let paramsDepth = 0;
    let bodyStart = -1;

    for (let index = paramsStart; index < source.length; index++) {
        const char = source[index];

        if (char === '(') paramsDepth++;
        if (char === ')') paramsDepth--;

        if (paramsDepth === 0) {
            bodyStart = source.indexOf('{', index);
            break;
        }
    }

    if (bodyStart === -1) {
        throw new Error(`Unable to find ${functionName} body in source file`);
    }

    let depth = 0;

    for (let index = bodyStart; index < source.length; index++) {
        const char = source[index];

        if (char === '{') depth++;
        if (char === '}') depth--;

        if (depth === 0) {
            return source.slice(start, index + 1);
        }
    }

    throw new Error(`Unable to parse ${functionName} from source file`);
}

describe('test-RoomTemplates', () => {
    let renderRoomTemplate;
    let document;

    beforeEach(() => {
        const dom = new JSDOM('<!doctype html><html><body></body></html>');
        document = dom.window.document;

        const roomClientPath = path.join(__dirname, '..', 'public', 'js', 'RoomClient.js');
        const roomClientSource = fs.readFileSync(roomClientPath, 'utf8');
        const functionSource = extractNamedFunction(roomClientSource, 'renderRoomTemplate');

        renderRoomTemplate = vm.runInNewContext(`(${functionSource})`, { document });
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

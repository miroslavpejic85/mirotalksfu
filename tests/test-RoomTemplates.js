'use strict';

require('should');

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const templateSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'RoomTemplate.js'), 'utf8');

describe('prejoin mobile audio guidance', () => {
    const roomSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'Room.js'), 'utf8');
    const guidanceSource = roomSource.slice(
        roomSource.indexOf('function showMobileAudioGuidance()'),
        roomSource.indexOf('function handleAudio()')
    );
    let document;

    function showGuidance(overrides = {}) {
        const context = vm.createContext({
            document,
            isMobileDevice: true,
            isEnumerateAudioDevices: true,
            BUTTONS: { main: { startAudioButton: true } },
            parserResult: { os: { name: 'iOS' } },
            ...overrides,
        });
        vm.runInContext(guidanceSource, context);
        context.showMobileAudioGuidance();
    }

    beforeEach(() => {
        const dom = new JSDOM(
            '<div id="initUser"><div class="initComands"><select id="initMicrophoneSelect"></select><select id="initSpeakerSelect"></select></div></div>'
        );
        document = dom.window.document;
    });

    it('places a persistent, accessible note after the controls without duplicating it', () => {
        showGuidance();
        showGuidance();
        const note = document.getElementById('mobileAudioGuidance');
        note.parentElement.id.should.equal('initUser');
        note.previousElementSibling.className.should.equal('initComands');
        note.getAttribute('role').should.equal('note');
        note.querySelector('i').getAttribute('aria-hidden').should.equal('true');
        note.textContent.should.containEql('iOS controls audio routing.');
        document.querySelectorAll('#mobileAudioGuidance').length.should.equal(1);
    });

    it('uses reconnection guidance on Android', () => {
        showGuidance({ parserResult: { os: { name: 'Android' } } });
        document.getElementById('mobileAudioGuidance').textContent.should.containEql('disconnect and reconnect it.');
    });

    for (const [scenario, overrides] of Object.entries({
        desktop: { isMobileDevice: false },
        'disabled audio controls': { BUTTONS: { main: { startAudioButton: false } } },
        'unavailable microphone access': { isEnumerateAudioDevices: false },
    })) {
        it(`does not show guidance with ${scenario}`, () => {
            showGuidance(overrides);
            document.querySelectorAll('#mobileAudioGuidance').length.should.equal(0);
        });
    }
});

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

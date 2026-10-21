'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/js/SipPhone.js'), 'utf8');
const roomHtml = fs.readFileSync(path.join(root, 'public/views/Room.html'), 'utf8');
const { parseSipTarget, formatCallDuration } = require('../public/js/SipPhone.js');

const ctx = { domain: 'pbx.example.com' };

describe('SIP phone target parsing', () => {
    it('routes short numeric and alphanumeric values as extensions on the SIP domain', () => {
        assert.deepEqual(parseSipTarget('1001', ctx), {
            type: 'extension',
            user: '1001',
            uri: 'sip:1001@pbx.example.com',
        });
        assert.equal(parseSipTarget(' alice1234 ', ctx).uri, 'sip:alice1234@pbx.example.com');
        assert.equal(parseSipTarget('*97', ctx).type, 'extension');
    });

    it('normalizes formatted phone numbers and keeps the international prefix', () => {
        assert.deepEqual(parseSipTarget('+1 (555) 123-4567', ctx), {
            type: 'phone',
            user: '+15551234567',
            uri: 'sip:+15551234567@pbx.example.com',
        });
        assert.equal(parseSipTarget('0039 06.1234.5678', ctx).uri, 'sip:00390612345678@pbx.example.com');
        assert.equal(parseSipTarget('5551234', ctx).type, 'phone');
        assert.equal(parseSipTarget('tel:+44-20-7946-0958;ext=1', ctx).uri, 'sip:+442079460958@pbx.example.com');
    });

    it('routes phone numbers through the optional gateway but keeps extensions on the SIP domain', () => {
        const withGateway = { domain: 'pbx.example.com', phoneDomain: 'pstn.provider.net' };
        assert.equal(parseSipTarget('+15551234567', withGateway).uri, 'sip:+15551234567@pstn.provider.net');
        assert.equal(parseSipTarget('1001', withGateway).uri, 'sip:1001@pbx.example.com');
    });

    it('escapes # in the SIP user part', () => {
        assert.equal(parseSipTarget('*72#', ctx).uri, 'sip:*72%23@pbx.example.com');
    });

    it('accepts full SIP addresses as-is', () => {
        assert.deepEqual(parseSipTarget('bob@example.org', ctx), {
            type: 'uri',
            user: 'bob',
            uri: 'sip:bob@example.org',
        });
        assert.equal(
            parseSipTarget('sips:carol@secure.example.org;transport=ws', ctx).uri,
            'sips:carol@secure.example.org;transport=ws'
        );
        assert.equal(parseSipTarget('SIP:1002', ctx).uri, 'sip:1002@pbx.example.com');
    });

    it('rejects empty, malformed or unroutable targets', () => {
        assert.equal(parseSipTarget('', ctx), null);
        assert.equal(parseSipTarget('   ', ctx), null);
        assert.equal(parseSipTarget('john smith', ctx), null);
        assert.equal(parseSipTarget('sip:', ctx), null);
        assert.equal(parseSipTarget('12+34', ctx), null);
        assert.equal(parseSipTarget('1001', { domain: '' }), null);
    });

    it('formats call durations', () => {
        assert.equal(formatCallDuration(0), '00:00');
        assert.equal(formatCallDuration(65.9), '01:05');
        assert.equal(formatCallDuration(3725), '1:02:05');
    });
});

describe('SIP phone dialer UI', () => {
    let dom;
    let window;
    let document;
    let byId;

    function setup(seedStorage = () => {}) {
        const start = roomHtml.indexOf('<div id="tabSipPhone"');
        const end = roomHtml.indexOf('<div id="tabVideoAI"');
        assert.ok(start > 0 && end > start, 'SIP tab markup not found');
        dom = new JSDOM(
            `<!DOCTYPE html><body><button id="tabSipPhoneBtn"></button>${roomHtml.slice(start, end)}</body>`,
            { url: 'https://meet.example.com/join/room', runScripts: 'outside-only', pretendToBeVisual: true }
        );
        window = dom.window;
        document = window.document;
        window.console = { log() {}, warn() {}, error() {} };
        seedStorage(window);
        window.eval(source);
        byId = (id) => document.getElementById(id);

        const ids = ['tabSipPhoneBtn', ...[...document.querySelectorAll('#tabSipPhone [id]')].map((el) => el.id)];
        const elements = Object.fromEntries(ids.map((id) => [id, byId(id)]));
        window.initSipPhoneMvp({ elements, getPeerName: () => 'Miro Talk' });
    }

    beforeEach(() => setup());

    afterEach(() => window.close());

    function click(element) {
        element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    }

    function type(value) {
        const input = byId('sipTarget');
        input.value = value;
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
    }

    it('fills sensible defaults and starts unregistered', () => {
        assert.equal(byId('sipWsServer').value, 'ws://meet.example.com:5066');
        assert.equal(byId('sipDomain').value, 'meet.example.com');
        assert.match(byId('sipUsername').value, /^mirota\d{4}$/);
        assert.equal(byId('sipAuthUsername').value, byId('sipUsername').value);
        assert.equal(byId('sipStatusBar').dataset.state, 'idle');
        assert.equal(byId('sipCallBtn').disabled, true);
        assert.ok(byId('sipHangupBtn').classList.contains('hidden'));
        assert.ok(byId('sipUnregisterBtn').classList.contains('hidden'));
    });

    it('builds a number from the keypad, with long-press 0 for +', async () => {
        const zero = document.querySelector('.sip-key[data-key="0"]');
        zero.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
        await new Promise((resolve) => setTimeout(resolve, 600));
        zero.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
        click(zero);
        for (const key of ['3', '9', '0']) click(document.querySelector(`.sip-key[data-key="${key}"]`));

        assert.equal(byId('sipTarget').value, '+390');
        assert.equal(byId('sipTargetType').textContent, 'Phone number');
        assert.equal(byId('sipTargetPreview').textContent, 'sip:+390@meet.example.com');
        assert.ok(!byId('sipBackspaceBtn').classList.contains('hidden'));

        click(byId('sipBackspaceBtn'));
        assert.equal(byId('sipTarget').value, '+39');
    });

    it('shows the detected target type and routes numbers through the gateway', () => {
        type('1001');
        assert.equal(byId('sipTargetType').textContent, 'Extension');
        assert.equal(byId('sipTargetPreview').textContent, 'sip:1001@meet.example.com');

        byId('sipPhoneGateway').value = 'pstn.provider.net';
        type('+1 555 123 4567');
        assert.equal(byId('sipTargetPreview').textContent, 'sip:+15551234567@pstn.provider.net');

        type('bob@example.org');
        assert.equal(byId('sipTargetType').textContent, 'SIP address');

        type('not valid');
        assert.ok(byId('sipTargetType').classList.contains('hidden'));
        assert.equal(byId('sipTargetPreview').textContent, '');
    });

    it('keeps the call button disabled until registered and explains why on Enter', () => {
        type('1001');
        assert.equal(byId('sipCallBtn').disabled, true);
        byId('sipTarget').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
            assert.equal(byId('sipStatus').textContent, 'Register first');
            assert.equal(byId('sipStatusBar').dataset.state, 'error');
        });
    });

    it('persists server settings but never the password', () => {
        byId('sipPassword').value = 'secret';
        byId('sipDomain').value = 'pbx.example.com';
        byId('sipDomain').dispatchEvent(new window.Event('change'));

        const settings = window.localStorage.getItem('MIROTALK_SIP_SETTINGS');
        const account = window.sessionStorage.getItem('MIROTALK_SIP_ACCOUNT');
        assert.ok(!settings.includes('secret'));
        assert.ok(!account.includes('secret'));
        assert.equal(JSON.parse(settings).domain, 'pbx.example.com');
    });

    it('restores saved settings and renders recent targets', () => {
        window.close();
        setup((win) => {
            win.localStorage.setItem('MIROTALK_SIP_RECENT', JSON.stringify(['+15551234567', '1002']));
            win.localStorage.setItem(
                'MIROTALK_SIP_SETTINGS',
                JSON.stringify({ domain: 'pbx.example.com', hackIpInContact: false })
            );
            win.sessionStorage.setItem(
                'MIROTALK_SIP_ACCOUNT',
                JSON.stringify({ username: '1001', authUsername: '1001' })
            );
        });

        assert.equal(byId('sipDomain').value, 'pbx.example.com');
        assert.equal(byId('sipUsername').value, '1001');
        assert.equal(byId('sipHackIpInContact').checked, false);

        const chips = [...document.querySelectorAll('#sipRecentList .sip-recent-chip')].map((chip) => chip.textContent);
        assert.deepEqual(chips, ['+15551234567', '1002']);
        assert.ok(!byId('sipRecentCalls').classList.contains('hidden'));

        click(document.querySelector('#sipRecentList .sip-recent-chip'));
        assert.equal(byId('sipTarget').value, '+15551234567');
        assert.equal(byId('sipTargetPreview').textContent, 'sip:+15551234567@pbx.example.com');
    });
});

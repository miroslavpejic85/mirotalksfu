'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const clientSource = fs.readFileSync(path.join(root, 'public/js/RoomClient.js'), 'utf8');
const templateSource = fs.readFileSync(path.join(root, 'public/js/RoomTemplate.js'), 'utf8');
const roomHtml = fs.readFileSync(path.join(root, 'public/views/Room.html'), 'utf8');

function createHarness({ enabled = true, presenter = true, domName, mapName } = {}) {
    let resolveDialog;
    const dialogs = [];
    const commands = [];
    const toasts = [];
    const template = roomHtml.match(/<template id="popupRemoteControlConfirmTemplate">[\s\S]*?<\/template>/)[0];
    const { document } = new JSDOM(template).window;
    if (domName !== undefined) {
        const nameEl = document.createElement('p');
        nameEl.id = 'participant-id__name';
        const badge = document.createElement('i');
        nameEl.append(badge, document.createTextNode(domName));
        document.body.appendChild(nameEl);
    }
    const context = vm.createContext({
        document,
        isPresenter: presenter,
        swalBackground: '#222',
        Swal: {
            fire: (options) => {
                dialogs.push(options);
                return new Promise((resolve) => {
                    resolveDialog = resolve;
                });
            },
        },
    });
    vm.runInContext(templateSource, context);
    vm.runInContext(`${clientSource}; globalThis.Client = RoomClient;`, context);
    const client = Object.create(context.Client.prototype);
    Object.assign(client, {
        remoteControlEnabled: enabled,
        peer_name: 'Presenter',
        peer_id: 'presenter-id',
        peer_uuid: 'presenter-uuid',
        peers: new Map(mapName ? [['participant-id', { peer_info: { peer_name: mapName } }]] : []),
        emitCmd: (cmd) => commands.push(cmd),
        userLog: (...args) => toasts.push(args),
    });
    return { client, context, dialogs, commands, toasts, resolve: (result) => resolveDialog(result) };
}

describe('remote control request confirmation', () => {
    it('explains consent and RustDesk before sending anything', async () => {
        const h = createHarness();
        const request = h.client.askPeerRemoteControl('participant-id');
        assert.equal(h.commands.length, 0);
        assert.equal(h.toasts.length, 0);
        assert.equal(h.client.remoteControlPeerId, undefined);
        const dialog = h.dialogs[0];
        assert.equal(dialog.confirmButtonText, 'Send request');
        assert.equal(dialog.cancelButtonText, 'Cancel');
        assert.equal(dialog.showCancelButton, true);
        assert.equal(dialog.focusCancel, true);
        const { document } = new JSDOM(dialog.html).window;
        assert.equal(document.querySelector('.remote-control__brand'), null);
        assert.equal(document.querySelector('b').textContent, 'Participant');
        assert.match(document.body.textContent, /control their mouse and keyboard with RustDesk/);
        assert.match(
            document.querySelector('.remote-control__note--info').textContent,
            /Both of you need the RustDesk app/
        );
        assert.match(
            document.querySelector('.remote-control__note--safe').textContent,
            /does not start remote control/
        );
        h.resolve({ isConfirmed: true });
        await request;
        assert.equal(h.client.remoteControlPeerId, 'participant-id');
        assert.deepEqual(JSON.parse(JSON.stringify(h.commands)), [
            {
                type: 'remoteControl',
                from_peer_name: 'Presenter',
                from_peer_id: 'presenter-id',
                from_peer_uuid: 'presenter-uuid',
                peer_id: 'participant-id',
                broadcast: false,
            },
        ]);
        assert.deepEqual(h.toasts, [
            ['success', 'Remote control requested. Waiting for confirmation...', 'top-end', 6000],
        ]);
    });

    for (const [source, options, expected] of [
        ['the video tile (peers who joined later)', { domName: ' Alex ', mapName: 'Old' }, 'Alex'],
        ['the peers map', { mapName: 'Sam' }, 'Sam'],
        [
            'markup in the name safely as text',
            { domName: '<img src=x onerror=alert(1)>' },
            '<img src=x onerror=alert(1)>',
        ],
    ]) {
        it(`shows the participant name from ${source}`, async () => {
            const h = createHarness(options);
            h.client.askPeerRemoteControl('participant-id');
            const { document } = new JSDOM(h.dialogs[0].html).window;
            assert.equal(document.querySelector('b').textContent, expected);
            assert.equal(document.querySelector('img'), null);
        });
    }

    for (const dismiss of ['cancel', 'esc', 'backdrop']) {
        it(`does not send or replace an existing pending request on ${dismiss}`, async () => {
            const h = createHarness();
            h.client.remoteControlPeerId = 'existing-peer';
            const request = h.client.askPeerRemoteControl('participant-id');
            h.resolve({ isConfirmed: false, dismiss });
            await request;
            assert.equal(h.commands.length, 0);
            assert.equal(h.toasts.length, 0);
            assert.equal(h.client.remoteControlPeerId, 'existing-peer');
        });
    }

    for (const options of [{ enabled: false }, { presenter: false }]) {
        it(`does not open a dialog when ${JSON.stringify(options)}`, async () => {
            const h = createHarness(options);
            await h.client.askPeerRemoteControl('participant-id');
            assert.equal(h.dialogs.length, 0);
            assert.equal(h.commands.length, 0);
        });
    }

    for (const change of ['feature disabled', 'presenter role removed']) {
        it(`does not send if ${change} while the dialog is open`, async () => {
            const h = createHarness();
            const request = h.client.askPeerRemoteControl('participant-id');
            if (change === 'feature disabled') h.client.remoteControlEnabled = false;
            else h.context.isPresenter = false;
            h.resolve({ isConfirmed: true });
            await request;
            assert.equal(h.commands.length, 0);
            assert.equal(h.toasts.length, 0);
        });
    }
});

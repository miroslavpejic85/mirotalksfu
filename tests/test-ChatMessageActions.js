'use strict';

// npx mocha tests/test-ChatMessageActions.js

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'RoomClient.js'), 'utf8');

function extractMethod(signature) {
    const start = source.indexOf(`    ${signature} {`);
    assert.ok(start !== -1, `${signature} not found`);
    const end = source.indexOf('\n    }\n', start);
    return source.slice(start, end + 7);
}

const GIF_URL = 'https://static.klipy.com/ii/abc/funny.webp';

function setup() {
    const dom = new JSDOM('<ul id="chatPublicMessages"></ul><ul id="chatGPTMessages"></ul>', {
        runScripts: 'outside-only',
    });
    const { window } = dom;
    // jsdom has no layout, so it lacks innerText
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
        get() {
            return this.textContent;
        },
    });
    const copied = [];
    const spoken = [];
    Object.assign(window, {
        filterXSS: (s) => s,
        hljs: { highlightAll() {} },
        icons: { speech: 'S', pen: 'E', paste: 'C', smile: ':)', trash: 'D' },
        chatHistory: { scrollTop: 0 },
        updateChatEmptyNotice() {},
        copyTextToClipboard: async (text) => (copied.push(text), true),
    });
    window.eval(`
        var chatMessagesId = 0;
        var chatPublicMessages = document.getElementById('chatPublicMessages');
        var chatGPTMessages = document.getElementById('chatGPTMessages');
        var deepSeekMessages = chatGPTMessages;
        var chatPrivateMessages = chatPublicMessages;
        var getId = (id) => document.getElementById(id);
        window.Client = class {
            ${[
                "appendMessage(side, img, fromName, fromId, msg, toId, toName, msgId = '')",
                'copyToClipboard(id)',
                'getChatImageOnlyUrl(source)',
                'speechElementText(elemId)',
                'isValidHttpURL(input)',
                'isOwnRelayedChatMessage(fromId, toId, msgId)',
            ]
                .map(extractMethod)
                .join('\n')}
        };
    `);
    const rc = new window.Client();
    Object.assign(rc, {
        peer_id: 'me',
        isSpeechSynthesisSupported: true,
        isMobileDevice: true,
        getId: (id) => window.document.getElementById(id),
        isValidAvatarURL: () => false,
        getTimeNow: () => '12:00:00',
        sanitizeHtml: (s) => s,
        formatMsg: (s) => s,
        collectMessages() {},
        processMessage: (s) => s,
        streamMessage: (el, s) => (el.innerHTML = s),
        userLog() {},
        speechText: (t) => spoken.push(t),
    });
    return { window, rc, copied, spoken };
}

const buttons = (window, n) =>
    [...window.document.querySelectorAll(`#msg-${n} .about-buttons button`)].map((b) => b.id.split('-')[1]);

describe('chat message actions', () => {
    it('hides Speech and Edit for image/GIF messages but keeps Copy (copies the URL)', async () => {
        const { window, rc, copied, spoken } = setup();
        rc.appendMessage('left', '', 'Me', 'me', `<img src="${GIF_URL}" width="200px">`, 'all', 'all', 'me_1');
        rc.appendMessage('left', '', 'Me', 'me', 'hello there', 'all', 'all', 'me_2');

        assert.deepEqual(buttons(window, 0), ['copy', 'react', 'delete']);
        assert.deepEqual(buttons(window, 1), ['copy', 'speech', 'react', 'edit', 'delete']);

        rc.copyToClipboard('message-0');
        rc.copyToClipboard('message-1');
        await new Promise((r) => setImmediate(r));
        assert.deepEqual(copied, [GIF_URL, 'hello there']);

        rc.speechElementText('message-0');
        rc.speechElementText('message-1');
        assert.deepEqual(spoken, ['hello there']);
    });

    it('hides Speech for image messages in the AI assistant chats', () => {
        const { window, rc } = setup();
        rc.appendMessage('left', '', 'Me', 'me', `<img src="${GIF_URL}">`, 'ChatGPT', 'ChatGPT');
        rc.appendMessage('right', '', 'ChatGPT', 'me', 'Hi, how can I help?', 'ChatGPT', 'ChatGPT');
        assert.deepEqual(buttons(window, 0), ['copy', 'react', 'delete']);
        assert.deepEqual(buttons(window, 1), ['copy', 'speech', 'react', 'delete']);
    });
});

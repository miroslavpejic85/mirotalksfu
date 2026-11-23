'use strict';

// npx mocha tests/test-ChatTimeFormat.js

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function extractMethod(source, signature) {
    const start = source.indexOf(`    ${signature} {`);
    assert.ok(start !== -1, `${signature} not found`);
    const end = source.indexOf('\n    }\n', start);
    return source.slice(start, end + 7);
}

function loadChatTimeMethods(document) {
    const src = read('public/js/RoomClient.js');
    const body = ['getTimeNow(date = new Date())', 'setChatTime12h(enabled)']
        .map((sig) => extractMethod(src, sig))
        .join('\n');
    const ctx = vm.createContext({ document, Number, Date });
    return vm.runInContext(`(class { ${body} })`, ctx);
}

describe('chat time format', () => {
    // 17:58:17 local time
    const date = new Date(2026, 10, 23, 17, 58, 17);

    it('formats 24-hour by default and 12-hour AM/PM when enabled', () => {
        const Methods = loadChatTimeMethods({ querySelectorAll: () => [] });
        const rc = new Methods();
        assert.equal(rc.getTimeNow(date), '17:58:17');
        rc.chatTime12h = true;
        assert.match(rc.getTimeNow(date), /^5:58:17\sPM$/);
        assert.match(rc.getTimeNow(new Date(2026, 10, 23, 0, 5, 9)), /^12:05:09\sAM$/);
    });

    it('re-renders existing message timestamps when toggled', () => {
        const el = { dataset: { ts: String(date.getTime()) }, textContent: '17:58:17' };
        const Methods = loadChatTimeMethods({
            querySelectorAll: (selector) => (selector === '.msg-time[data-ts]' ? [el] : []),
        });
        const rc = new Methods();
        rc.setChatTime12h(true);
        assert.match(el.textContent, /^5:58:17\sPM$/);
        rc.setChatTime12h(false);
        assert.equal(el.textContent, '17:58:17');
    });

    it('is configurable via CHAT_TIME_FORMAT and overridable per user', () => {
        assert.match(read('.env.template'), /^CHAT_TIME_FORMAT=24h/m);
        assert.match(
            read('app/src/config.template.js'),
            /chatTimeFormat: process\.env\.CHAT_TIME_FORMAT === '12h' \? '12h' : '24h'/
        );
        const room = read('public/js/Room.js');
        assert.match(room, /typeof localStorageSettings\.chat_time_12h === 'boolean'/);
        assert.match(room, /BUTTONS\.chat\?\.chatTimeFormat === '12h'/);
        assert.match(read('public/views/Room.html'), /id="chatTime12h"/);
    });
});

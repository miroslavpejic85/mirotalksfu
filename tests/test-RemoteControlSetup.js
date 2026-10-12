'use strict';

require('should');
const jwt = require('jsonwebtoken');
const {
    createSetupToken,
    isSetupTokenValid,
    resolveSetupConfig,
    buildImportString,
    renderSetupPage,
} = require('../app/src/RemoteControlSetup');
const { getJwtKeys } = require('../app/src/JwtSecret');

const KEY = 'nkxenH4xtSifc6k34GdgyHFu2y+00CQE7X+BfdmBVTM=';
const decode = (s) => JSON.parse(Buffer.from(s.split('').reverse().join(''), 'base64').toString('utf8'));

describe('RemoteControlSetup', () => {
    it('returns null without a valid ID server', () => {
        (resolveSetupConfig({}) === null).should.be.true();
        (resolveSetupConfig({ idServer: 'bad host<script>' }) === null).should.be.true();
    });

    it('drops invalid optional values', () => {
        const s = resolveSetupConfig({
            idServer: 'rd.example.com',
            relayServer: '<x>',
            apiServer: 'javascript:1',
            key: 'x',
        });
        s.should.deepEqual({ idServer: 'rd.example.com', relayServer: '', apiServer: '', key: '' });
    });

    it('builds a RustDesk import string that round-trips', () => {
        const setup = resolveSetupConfig({ idServer: 'rd.example.com', key: KEY });
        decode(buildImportString(setup)).should.deepEqual({ host: 'rd.example.com', relay: '', api: '', key: KEY });
    });

    it('renders the page with server values and escapes the app name', () => {
        const setup = resolveSetupConfig({ idServer: 'rd.example.com:21116', key: KEY });
        const html = renderSetupPage(setup, { appName: '<img src=x onerror=1>' });
        html.should.containEql('rd.example.com:21116');
        html.should.containEql(KEY);
        html.should.not.containEql('<img src=x');
    });

    it('resolves every placeholder and conditional block', () => {
        const only = renderSetupPage(resolveSetupConfig({ idServer: 'rd.example.com' }));
        only.should.not.match(/\{\{|<!--(IF|ELSE|ENDIF)/);
        only.should.containEql('leave empty');
        only.should.containEql('not set by the administrator');
        only.should.not.containEql('data-copy-text="relay.example.com"');

        const full = renderSetupPage(
            resolveSetupConfig({
                idServer: 'rd.example.com',
                relayServer: 'relay.example.com',
                apiServer: 'https://api.example.com',
                key: KEY,
            })
        );
        full.should.not.match(/\{\{|<!--(IF|ELSE|ENDIF)/);
        full.should.containEql('data-copy-text="relay.example.com"');
        full.should.containEql('data-copy-text="https://api.example.com"');
        full.should.containEql(`data-copy-text="${KEY}"`);
        // long keys are shown truncated but copied in full
        full.should.containEql('nkxenH…mBVTM=');
    });

    describe('setup token', () => {
        const { rcSetup, createRoom } = getJwtKeys('a'.repeat(32));

        it('accepts a freshly minted token', () => {
            isSetupTokenValid(rcSetup, createSetupToken(rcSetup, 'room1')).should.be.true();
        });

        it('rejects missing, malformed or non-string tokens', () => {
            [undefined, '', 'abc', ['x'], { t: 1 }].forEach((t) => isSetupTokenValid(rcSetup, t).should.be.false());
        });

        it('rejects a token signed with another purpose key', () => {
            isSetupTokenValid(rcSetup, createSetupToken(createRoom, 'room1')).should.be.false();
        });

        it('rejects a token with another scope or expired', () => {
            const other = jwt.sign({ scope: 'create-room', roomId: 'r' }, rcSetup);
            isSetupTokenValid(rcSetup, other).should.be.false();
            const expired = jwt.sign({ scope: 'rc-setup', roomId: 'r' }, rcSetup, { expiresIn: -10 });
            isSetupTokenValid(rcSetup, expired).should.be.false();
        });
    });
});

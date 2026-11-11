'use strict';

// npx mocha tests/test-LogRedactor.js

require('should');

const { redact, isSensitiveKey, REDACTED } = require('../app/src/LogRedactor');

describe('test-LogRedactor', () => {
    it('masks host user passwords and the users API secret (Server config)', () => {
        const out = redact({
            security: {
                host: {
                    protected: true,
                    users: [{ username: 'demo', password: 'Demo-Pass-123', displayname: 'Demo', allowed_rooms: ['*'] }],
                    users_api_secret_key: 'mirotalkweb_default_secret',
                    users_api_endpoint: 'http://localhost:9000/api/v1/user/isAuth',
                },
            },
        });
        JSON.stringify(out).should.not.containEql('Demo-Pass-123');
        JSON.stringify(out).should.not.containEql('mirotalkweb_default_secret');
        out.security.host.users[0].should.eql({
            username: 'demo',
            password: REDACTED,
            displayname: 'Demo',
            allowed_rooms: ['*'],
        });
        out.security.host.protected.should.be.true();
        out.security.host.users_api_endpoint.should.equal('http://localhost:9000/api/v1/user/isAuth');
    });

    it('masks integration secrets in config shapes', () => {
        const out = redact({
            oidc: {
                config: { clientSecret: 'cs', secret: 's', clientID: 'id', authorizationParams: { scope: 'openid' } },
            },
            chatGPT: { apiKey: 'sk-1', max_tokens: 1024, model: 'gpt' },
            ngrok: { authToken: 'ngrok-1' },
            sentry: { DSN: 'https://abc@sentry.io/1' },
            email: { username: 'u', password: 'p', port: 587 },
            rtmp: { streamKey: 'sk', apiSecret: 'as', tokenExpire: '4h' },
            s3: { accessKeyId: 'AKIA', secretAccessKey: 'xyz' },
            jwt: { key: 'jwt-secret' },
            api: { keySecret: 'api-secret', allowed: { token: true } },
        });
        out.oidc.config.should.eql({
            clientSecret: REDACTED,
            secret: REDACTED,
            clientID: 'id',
            authorizationParams: { scope: 'openid' },
        });
        out.chatGPT.should.eql({ apiKey: REDACTED, max_tokens: 1024, model: 'gpt' });
        out.ngrok.authToken.should.equal(REDACTED);
        out.sentry.DSN.should.equal(REDACTED);
        out.email.should.eql({ username: 'u', password: REDACTED, port: 587 });
        out.rtmp.should.eql({ streamKey: REDACTED, apiSecret: REDACTED, tokenExpire: '4h' });
        out.s3.should.eql({ accessKeyId: REDACTED, secretAccessKey: REDACTED });
        out.jwt.key.should.equal(REDACTED);
        out.api.should.eql({ keySecret: REDACTED, allowed: { token: true } });
    });

    it('masks debug-log credentials and request headers', () => {
        const headers = Object.create(null);
        headers.authorization = 'mirotalksfu_default_secret';
        headers['x-api-key'] = 'k';
        headers.cookie = 'appSession=abc';
        headers['user-agent'] = 'curl';
        const out = redact({ ip: '1.2.3.4', username: 'demo', password: 'pw', peer_password: 'pw', header: headers });
        out.password.should.equal(REDACTED);
        out.peer_password.should.equal(REDACTED);
        out.username.should.equal('demo');
        out.header.authorization.should.equal(REDACTED);
        out.header['x-api-key'].should.equal(REDACTED);
        out.header.cookie.should.equal(REDACTED);
        out.header['user-agent'].should.equal('curl');
    });

    it('keeps empty/unset and boolean values visible', () => {
        redact({ apiKey: '', token: undefined, secret: null, allowToken: false }).should.eql({
            apiKey: '',
            token: undefined,
            secret: null,
            allowToken: false,
        });
    });

    it('masks credentials embedded in URLs', () => {
        redact('redis://:p4ss@redis:6379').should.equal('redis://:***@redis:6379');
        redact({ redisUrl: 'redis://user:p4ss@redis:6379/0' }).redisUrl.should.equal('redis://user:***@redis:6379/0');
        redact('https://sfu.example.com/join?room=test').should.equal('https://sfu.example.com/join?room=test');
    });

    it('does not mutate the input, handles cycles and leaves class instances untouched', () => {
        const input = { password: 'pw', nested: { list: [{ token: 't' }] } };
        input.self = input;
        const out = redact(input);
        input.password.should.equal('pw');
        input.nested.list[0].token.should.equal('t');
        out.nested.list[0].token.should.equal(REDACTED);
        out.self.should.equal(out);

        const err = new Error('boom');
        redact(err).should.equal(err);
        redact('').should.equal('');
        redact(42).should.equal(42);
    });

    it('does not flag common non-secret keys', () => {
        [
            'keywords',
            'keyPrefix',
            'keyboardShortcuts',
            'max_tokens',
            'tokenExpire',
            'authorizationParams',
            'username',
        ].forEach((key) => isSensitiveKey(key).should.be.false(key));
    });
});

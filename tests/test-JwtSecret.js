'use strict';

require('should');
const { getJwtKeys, resolveJwtSecret, KNOWN_DEFAULT_SECRETS } = require('../app/src/JwtSecret');

describe('JwtSecret', () => {
    const strong = 'a'.repeat(32);

    it('rejects a missing secret', () => {
        (() => resolveJwtSecret(undefined)).should.throw(/not set/);
        (() => resolveJwtSecret('')).should.throw(/not set/);
    });

    it('rejects the published default secret', () => {
        (() => resolveJwtSecret(KNOWN_DEFAULT_SECRETS[0])).should.throw(/publicly known/);
    });

    it('rejects a short secret', () => {
        (() => resolveJwtSecret('short')).should.throw(/at least 32/);
    });

    it('accepts a strong secret', () => {
        resolveJwtSecret(strong).should.equal(strong);
    });

    it('derives distinct, deterministic keys per purpose', () => {
        const keys = getJwtKeys(strong);
        new Set([keys.auth, keys.recUpload, keys.rtmp]).size.should.equal(3);
        Object.values(keys).forEach((k) => k.should.not.equal(strong));
        getJwtKeys(strong).should.deepEqual(keys);
    });
});

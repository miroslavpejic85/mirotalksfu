'use strict';

const crypto = require('crypto');

const MIN_SECRET_LENGTH = 32;

// Values that were published in the source/templates and must never be accepted.
const KNOWN_DEFAULT_SECRETS = ['mirotalksfu_jwt_secret'];

// Purposes get independent keys derived from the master secret (HKDF), so a token
// minted for one purpose can never be replayed for another.
const PURPOSES = { auth: 'auth', recUpload: 'rec-upload', rtmp: 'rtmp-stream' };

let cached = null;

function validateSecret(secret) {
    if (!secret || typeof secret !== 'string') return 'JWT_SECRET is not set';
    if (KNOWN_DEFAULT_SECRETS.includes(secret)) return 'JWT_SECRET is set to a publicly known default value';
    if (secret.length < MIN_SECRET_LENGTH) return `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters long`;
    return null;
}

// Returns a usable master secret or throws; there is deliberately no insecure fallback.
function resolveJwtSecret(rawSecret) {
    const problem = validateSecret(rawSecret);
    if (problem) {
        throw new Error(`${problem}. Set a strong secret (e.g. "openssl rand -hex 32") in JWT_SECRET.`);
    }
    return rawSecret;
}

function deriveKey(secret, purpose) {
    return Buffer.from(crypto.hkdfSync('sha256', secret, '', `mirotalksfu:${purpose}`, 32)).toString('hex');
}

// Memoized so every module (Server, ServerApi) signs and verifies with the same keys.
function getJwtKeys(rawSecret = process.env.JWT_SECRET) {
    const secret = resolveJwtSecret(rawSecret);
    if (!cached || cached.secret !== secret) {
        cached = {
            secret,
            keys: Object.freeze({
                auth: deriveKey(secret, PURPOSES.auth),
                recUpload: deriveKey(secret, PURPOSES.recUpload),
                rtmp: deriveKey(secret, PURPOSES.rtmp),
            }),
        };
    }
    return cached.keys;
}

module.exports = {
    getJwtKeys,
    resolveJwtSecret,
    deriveKey,
    MIN_SECRET_LENGTH,
    KNOWN_DEFAULT_SECRETS,
    PURPOSES,
};

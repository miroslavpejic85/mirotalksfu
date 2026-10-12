'use strict';

const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '../../public/views/remoteControlSetup.html');

const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/i;
const KEY_RE = /^[A-Za-z0-9+/=_-]{20,128}$/;

const escapeHtml = (value) =>
    String(value ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

const clean = (value) => String(value ?? '').trim();

const SETUP_TOKEN_SCOPE = 'rc-setup';
const SETUP_TOKEN_EXP = '15m';

let templateCache = null;
const loadTemplate = () => (templateCache ??= fs.readFileSync(TEMPLATE_PATH, 'utf8'));

/**
 * Normalize the RustDesk server settings from config.
 * Returns null unless a valid ID server is set (the page is then not served).
 * The public key is not a secret; the private key (id_ed25519) must never be configured here.
 */
function resolveSetupConfig(cfg = {}) {
    const idServer = clean(cfg.idServer);
    if (!HOST_RE.test(idServer)) return null;

    const relayServer = clean(cfg.relayServer);
    const apiServer = clean(cfg.apiServer);
    const key = clean(cfg.key);

    return {
        idServer,
        relayServer: HOST_RE.test(relayServer) ? relayServer : '',
        apiServer: /^https?:\/\/[^\s<>"']+$/i.test(apiServer) ? apiServer : '',
        key: KEY_RE.test(key) ? key : '',
    };
}

/**
 * Short-lived token bound to a room, minted by the server when a presenter sends a remote control
 * request. It lets the participant open the setup page without making it public.
 */
function createSetupToken(key, roomId) {
    return jwt.sign({ scope: SETUP_TOKEN_SCOPE, roomId: String(roomId) }, key, { expiresIn: SETUP_TOKEN_EXP });
}

function isSetupTokenValid(key, token) {
    if (!token || typeof token !== 'string') return false;
    try {
        return jwt.verify(token, key, { algorithms: ['HS256'] })?.scope === SETUP_TOKEN_SCOPE;
    } catch {
        return false;
    }
}

/**
 * RustDesk "import configuration" string: reversed base64 of the server JSON.
 */
function buildImportString({ idServer, relayServer, apiServer, key }) {
    const json = JSON.stringify({ host: idServer, relay: relayServer, api: apiServer, key });
    return Buffer.from(json, 'utf8').toString('base64').split('').reverse().join('');
}

/**
 * Fill public/views/remoteControlSetup.html:
 * - {{NAME}} placeholders are HTML-escaped values
 * - <!--IF:NAME-->a<!--ELSE-->b<!--ENDIF--> picks a when NAME is non-empty, else b
 */
function renderSetupPage(setup, { appName = 'MiroTalk SFU' } = {}) {
    const values = {
        APP_NAME: appName,
        ID_SERVER: setup.idServer,
        RELAY_SERVER: setup.relayServer,
        API_SERVER: setup.apiServer,
        KEY: setup.key,
        KEY_SHORT: setup.key.length > 16 ? `${setup.key.slice(0, 6)}…${setup.key.slice(-6)}` : setup.key,
        IMPORT_CONFIG: buildImportString(setup),
    };

    return loadTemplate()
        .replace(/<!--IF:(\w+)-->([\s\S]*?)<!--ELSE-->([\s\S]*?)<!--ENDIF-->/g, (_, name, yes, no) =>
            values[name] ? yes : no
        )
        .replace(/\{\{(\w+)\}\}/g, (_, name) => escapeHtml(values[name]));
}

module.exports = {
    createSetupToken,
    isSetupTokenValid,
    resolveSetupConfig,
    buildImportString,
    renderSetupPage,
    escapeHtml,
};

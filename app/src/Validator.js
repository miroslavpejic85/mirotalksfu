'use strict';

const path = require('path');

const checkXSS = require('./XSS.js');

function isValidRoomName(input) {
    if (!input || typeof input !== 'string') {
        return false;
    }
    const room = checkXSS(input);

    if (!room || ['false', 'undefined', '', null, undefined, 'favicon.ico'].includes(room.trim().toLowerCase())) {
        return false;
    }

    return !hasPathTraversal(room);
}

function isValidRecFileNameFormat(input) {
    if (!input || typeof input !== 'string') {
        return false;
    }
    const validPattern = /^Rec_[a-zA-Z0-9_.-]+\.webm$/;
    if (!validPattern.test(input)) {
        return false;
    }
    return !hasPathTraversal(input);
}

function hasPathTraversal(input) {
    if (!input || typeof input !== 'string') {
        return false;
    }

    let decodedInput = input;
    try {
        decodedInput = decodeURIComponent(input);
        decodedInput = decodeURIComponent(decodedInput);
    } catch (err) {}

    const pathTraversalPattern = /(\.\.(\/|\\))+/;
    const excessiveDotsPattern = /(\.{4,}\/+|\.{4,}\\+)/;
    const complexTraversalPattern = /(\.{2,}(\/+|\\+))/;

    if (complexTraversalPattern.test(decodedInput)) {
        return true;
    }

    const normalizedPath = path.normalize(decodedInput);

    if (pathTraversalPattern.test(normalizedPath) || excessiveDotsPattern.test(normalizedPath)) {
        return true;
    }

    return false;
}

function isValidEmail(email) {
    const emailRegex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
    return emailRegex.test(email);
}

function parseEmailList(input) {
    if (typeof input !== 'string') {
        return [];
    }

    return [...new Set(input.split(',').map((email) => email.trim().toLowerCase()))].filter((email) =>
        isValidEmail(email)
    );
}

function hasAllowedEmailDomains(emails, allowedDomains = []) {
    if (!Array.isArray(emails) || emails.length === 0) {
        return false;
    }

    if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) {
        return true;
    }

    const normalizedAllowedDomains = allowedDomains
        .map((domain) => String(domain).trim().toLowerCase())
        .filter(Boolean);

    if (normalizedAllowedDomains.length === 0) {
        return true;
    }

    return emails.every((email) => {
        const domain = email.split('@')[1]?.toLowerCase();
        return normalizedAllowedDomains.includes(domain);
    });
}

function isValidData(data) {
    if (!data || typeof data !== 'object') {
        return false;
    }
    return Object.keys(data).length > 0;
}

/**
 * Block private / loopback / link-local / unspecified hosts.
 * Note: does NOT do DNS resolution, so a public domain that resolves to
 * an internal IP (DNS rebinding) is not caught here — defending against
 * that on a signaling broadcast is out of scope.
 * @param {string} host hostname or IP literal (no brackets, no port)
 * @returns {boolean} true if the host is considered unsafe
 */
function isPrivateOrLoopbackHost(host) {
    if (!host || typeof host !== 'string') return true;
    const h = host.trim().toLowerCase();
    if (!h) return true;

    // Hostnames that always resolve to loopback
    if (h === 'localhost' || h.endsWith('.localhost')) return true;

    // IPv4 literal
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
        const o = h.split('.').map((x) => parseInt(x, 10));
        if (o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → unsafe
        if (o[0] === 0) return true; // 0.0.0.0/8
        if (o[0] === 10) return true; // 10/8
        if (o[0] === 127) return true; // loopback
        if (o[0] === 169 && o[1] === 254) return true; // link-local
        if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // 172.16/12
        if (o[0] === 192 && o[1] === 168) return true; // 192.168/16
        if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT
        if (o[0] >= 224) return true; // multicast / reserved
        return false;
    }

    // IPv6 literal (already stripped of [])
    if (h.includes(':')) {
        if (h === '::' || h === '::1') return true;
        if (h.startsWith('fe80')) return true; // link-local
        if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // ULA fc00::/7
        if (h.startsWith('ff')) return true; // multicast
        // IPv4-mapped: ::ffff:127.0.0.1
        const v4 = h.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
        if (v4) return isPrivateOrLoopbackHost(v4[1]);
        return false;
    }

    // Plain hostname — not resolved here
    return false;
}

/**
 * Validate that a fabric.js `image.src` URL is safe to broadcast.
 * Allows http(s) to non-private hosts and `data:image/...` URIs.
 * Rejects javascript:, vbscript:, file:, blob:, gopher:, ftp:, anything pointing
 * at loopback / private / link-local hosts, and malformed inputs.
 * @param {string} src
 * @returns {boolean}
 */
function isSafeImageSrc(src) {
    if (!src || typeof src !== 'string') return false;
    const s = src.trim();
    if (!s) return false;

    // data: URI — only image/* subtypes
    if (/^data:/i.test(s)) {
        return /^data:image\/[a-z0-9.+-]+[;,]/i.test(s);
    }

    // Must be http(s) — reject every other scheme (javascript:, file:, blob:, ftp:, gopher:, …)
    if (!/^https?:\/\//i.test(s)) return false;

    let u;
    try {
        u = new URL(s);
    } catch (_) {
        return false;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

    let host = u.hostname || '';
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1); // IPv6 literal
    return !isPrivateOrLoopbackHost(host);
}

/**
 * Filter fabric.js canvas JSON in place: drop any `image` objects whose `src`
 * fails `isSafeImageSrc`. Accepts either a JSON string or an object and
 * returns the sanitized value in the same shape it was given.
 * @param {string|object} payload
 * @param {function({src:string}):void} [onDrop] optional callback invoked per dropped image
 * @returns {string|object|null} sanitized payload (same type as input), or original on parse failure
 */
function sanitizeWbCanvasJson(payload, onDrop) {
    if (payload == null) return payload;

    let parsed = payload;
    let wasString = false;
    if (typeof payload === 'string') {
        wasString = true;
        try {
            parsed = JSON.parse(payload);
        } catch (_) {
            // Not parseable JSON, leave untouched.
            return payload;
        }
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.objects)) {
        return wasString ? JSON.stringify(parsed) : parsed;
    }

    parsed.objects = parsed.objects.filter((obj) => {
        if (!obj || typeof obj !== 'object') return true;
        const type = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
        if (type !== 'image') return true;
        if (isSafeImageSrc(obj.src)) return true;
        if (typeof onDrop === 'function') {
            try {
                onDrop({ src: obj.src });
            } catch (_) {}
        }
        return false;
    });

    return wasString ? JSON.stringify(parsed) : parsed;
}

module.exports = {
    isValidRoomName,
    isValidRecFileNameFormat,
    hasPathTraversal,
    isValidEmail,
    parseEmailList,
    hasAllowedEmailDomains,
    isValidData,
    isPrivateOrLoopbackHost,
    isSafeImageSrc,
    sanitizeWbCanvasJson,
};

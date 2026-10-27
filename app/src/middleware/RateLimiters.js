'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

const MINUTE_MS = 60 * 1000;

// Extract client IP (only trust X-Forwarded-For when behind a trusted reverse proxy)
const ipKeyGenerator = (req) => {
    const forwarded = Boolean(config?.server?.trustProxy)
        ? req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']
        : null;
    return (forwarded || '').split(',')[0].trim() || req.socket?.remoteAddress || req.ip;
};

// Pluralize "N minute(s)" consistently across limiter messages
const minutesLabel = (n) => `${n} minute${n === 1 ? '' : 's'}`;

const toMinutes = (windowMs) => Math.ceil(windowMs / MINUTE_MS);

/**
 * Build an express-rate-limit middleware keyed per IP with standard headers.
 * `messageKey` is the response body property holding the message ('error' | 'message').
 */
function createIpLimiter({ windowMs, max, text, messageKey = 'error' }) {
    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { [messageKey]: `${text} Please try again after ${minutesLabel(toMinutes(windowMs))}.` },
        keyGenerator: (req) => ipKeyGenerator(req),
    });
}

/**
 * In-memory sliding window limiter (per key), used for Socket.IO events.
 * Returns true if the hit is allowed, false if the limit is exceeded.
 */
function createSlidingWindowLimiter({ windowMs, max }) {
    const hitsByKey = new Map(); // key -> number[] (timestamps)

    // Periodic cleanup to bound memory.
    setInterval(
        () => {
            const cutoff = Date.now() - windowMs;
            for (const [key, hits] of hitsByKey) {
                const kept = hits.filter((t) => t > cutoff);
                if (kept.length === 0) hitsByKey.delete(key);
                else hitsByKey.set(key, kept);
            }
        },
        Math.max(windowMs, MINUTE_MS)
    ).unref?.();

    return function check(key) {
        const now = Date.now();
        const windowStart = now - windowMs;
        const hits = (hitsByKey.get(key) || []).filter((t) => t > windowStart);
        if (hits.length >= max) {
            hitsByKey.set(key, hits);
            return false;
        }
        hits.push(now);
        hitsByKey.set(key, hits);
        return true;
    };
}

/**
 * Create all application rate limiters from the config.
 * @param {Object} deps
 * @param {(req) => string} deps.getRequesterKey - per-requester key (OIDC user > token user > IP)
 */
function createRateLimiters({ getRequesterKey }) {
    // Login attempts
    const maxAttempts = config?.security?.host?.maxAttempts || 5;
    const minBlockTime = config?.security?.host?.minBlockTime || 15; // minutes
    const loginLimiter = rateLimit({
        windowMs: minBlockTime * MINUTE_MS,
        max: maxAttempts,
        message: {
            message: `Too many login attempts. Please try again after ${minutesLabel(minBlockTime)}.`,
        },
        keyGenerator: (req) => req.body?.username || ipKeyGenerator(req),
    });

    // Room scheduler
    const scheduleMeetingCfg = config.features?.scheduleMeeting || {};
    const scheduleMeetingWindowMs = scheduleMeetingCfg.rateLimit?.windowMs || 60 * MINUTE_MS;
    const scheduleMeetingLimiter = rateLimit({
        windowMs: scheduleMeetingWindowMs,
        max: scheduleMeetingCfg.rateLimit?.max || 5,
        message: {
            message: `Too many schedule meeting requests. Please try again after ${minutesLabel(toMinutes(scheduleMeetingWindowMs))}.`,
        },
        keyGenerator: getRequesterKey,
    });

    // Active rooms endpoint (per IP) — public endpoint, so prevent
    // enumeration / scraping abuse without breaking the public "event zone" UX.
    const activeRoomsCfg = config.ui?.rooms?.activeRoomsRateLimit || {};
    const activeRoomsLimiter = createIpLimiter({
        windowMs: activeRoomsCfg.windowMs || MINUTE_MS,
        max: activeRoomsCfg.max || 60,
        text: 'Too many requests.',
    });

    // Server recording chunk upload (per IP). The /recSync* endpoints accept binary
    // writes to disk, so cap request volume to mitigate flooding and disk exhaustion
    // even from an authenticated/joined peer.
    const recSyncCfg = config.media?.recording?.rateLimit || {};
    const recSyncLimiter = createIpLimiter({
        windowMs: recSyncCfg.windowMs || MINUTE_MS,
        max: recSyncCfg.max || 300,
        text: 'Too many recording upload requests.',
    });

    // createRoom (per IP), shared by Socket.IO `createRoom` and HTTP /createRoomToken.
    // Prevents unauthenticated sockets from spamming arbitrary room entries
    // into the in-memory roomList (which feeds /api/v1/activeRooms).
    const createRoomCfg = config.features?.createRoomRateLimit || {};
    const createRoomWindowMs = createRoomCfg.windowMs || MINUTE_MS;
    const createRoomMax = createRoomCfg.max || 10;
    const createRoomLimiterMinutes = toMinutes(createRoomWindowMs);

    // The endpoint runs the room creation policy (join token / user lookups), so cap request volume.
    const createRoomTokenLimiter = createIpLimiter({
        windowMs: createRoomWindowMs,
        max: createRoomMax,
        text: 'Too many room token requests.',
        messageKey: 'message',
    });

    const checkCreateRoomLimit = createSlidingWindowLimiter({ windowMs: createRoomWindowMs, max: createRoomMax });

    // WHIP ingestion (per IP). Each POST allocates a WebRTC transport, so cap session churn.
    const whipCfg = config.media?.whip?.rateLimit || {};
    const whipLimiter = createIpLimiter({
        windowMs: whipCfg.windowMs || MINUTE_MS,
        max: whipCfg.max || 30,
        text: 'Too many WHIP requests.',
    });

    return {
        loginLimiter,
        scheduleMeetingLimiter,
        activeRoomsLimiter,
        recSyncLimiter,
        createRoomTokenLimiter,
        checkCreateRoomLimit,
        createRoomLimiterMinutes,
        whipLimiter,
    };
}

module.exports = { createRateLimiters, ipKeyGenerator, minutesLabel };

'use strict';

const config = require('../config');
const Logger = require('../Logger');
const log = new Logger('RestrictAccessByIP');

const { enabled = false, allowedIPs = [] } = config?.security?.middleware?.IpWhitelist || {};
const trustProxy = Boolean(config?.server?.trustProxy);

// Works for both Express requests and raw http.IncomingMessage (e.g. the Socket.IO handshake)
const getRequestIP = (req) => {
    // Security: only honour X-Forwarded-For when behind a trusted reverse proxy;
    // otherwise the header is attacker-controlled and would bypass the allow-list.
    const forwarded = trustProxy ? req.headers?.['x-forwarded-for'] : null;
    return (forwarded && String(forwarded).split(',')[0].trim()) || req.socket?.remoteAddress || req.ip;
};

// IPv4-mapped IPv6 addresses (::ffff:1.2.3.4) also match their plain IPv4 entry
const isIPWhitelisted = (ip) => {
    if (!ip) return false;
    return allowedIPs.includes(ip) || allowedIPs.includes(ip.replace(/^::ffff:/i, ''));
};

const restrictAccessByIP = (req, res, next) => {
    if (!enabled) return next();
    const clientIP = getRequestIP(req);
    log.debug('Check IP', clientIP);
    if (isIPWhitelisted(clientIP)) {
        next();
    } else {
        log.info('Forbidden: Access denied from this IP address', { clientIP: clientIP });
        res.status(403).json({ error: 'Forbidden', message: 'Access denied from this IP address.' });
    }
};

// Socket.IO (Engine.IO) allowRequest hook: rejects the handshake before any socket event is handled
const allowSocketRequest = (req, callback) => {
    if (!enabled) return callback(null, true);
    const clientIP = getRequestIP(req);
    if (isIPWhitelisted(clientIP)) return callback(null, true);
    log.info('Forbidden: Socket access denied from this IP address', { clientIP: clientIP });
    callback('Access denied from this IP address.', false);
};

module.exports = restrictAccessByIP;
module.exports.allowSocketRequest = allowSocketRequest;
module.exports.isIPWhitelisted = isIPWhitelisted;
module.exports.getRequestIP = getRequestIP;

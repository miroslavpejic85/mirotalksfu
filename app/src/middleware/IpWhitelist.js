'use strict';

const config = require('../config');
const Logger = require('../Logger');
const log = new Logger('RestrictAccessByIP');

const { enabled = false, allowedIPs = [] } = config?.security?.middleware?.IpWhitelist || {};
const trustProxy = Boolean(config?.server?.trustProxy);

const restrictAccessByIP = (req, res, next) => {
    if (!enabled) return next();
    // Security: only honour X-Forwarded-For when behind a trusted reverse proxy;
    // otherwise the header is attacker-controlled and would bypass the allow-list.
    const forwarded = trustProxy ? req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'] : null;
    const clientIP = (forwarded && forwarded.split(',')[0].trim()) || req.socket.remoteAddress || req.ip;
    log.debug('Check IP', clientIP);
    if (allowedIPs.includes(clientIP)) {
        next();
    } else {
        log.info('Forbidden: Access denied from this IP address', { clientIP: clientIP });
        res.status(403).json({ error: 'Forbidden', message: 'Access denied from this IP address.' });
    }
};

module.exports = restrictAccessByIP;

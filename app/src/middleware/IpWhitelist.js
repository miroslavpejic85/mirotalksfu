'use strict';

const config = require('../config');
const Logger = require('../Logger');
const log = new Logger('RestrictAccessByIP');

const IpWhitelistEnabled = config.middleware ? config.middleware.IpWhitelist.enabled : false;
const allowedIPs = config.middleware ? config.middleware.IpWhitelist.allowed : [];

const restrictAccessByIP = (req, res, next) => {
    if (!IpWhitelistEnabled) return next();
    //
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
    log.debug('Check IP', clientIP);
    if (allowedIPs.includes(clientIP)) {
        next();
    } else {
        log.info('Forbidden: Access denied from this IP address', { clientIP: clientIP });
        res.status(403).json({ error: 'Forbidden', message: 'Access denied from this IP address.' });
    }
};

module.exports = restrictAccessByIP;

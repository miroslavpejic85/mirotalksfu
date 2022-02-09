'use strict';

const Logger = require('./Logger');
const log = new Logger('Host');

module.exports = class Host {
    constructor(ip, authorized) {
        this.auth = new Map();
        this.auth.set(ip, authorized);
        //log.debug('AUTH ---> ', this.auth.get(ip));
    }
    isAuthorized(ip) {
        return this.auth.has(ip);
    }
};

'use strict';

module.exports = class Logger {
    constructor(appName, debugOn = true) {
        if (appName) this.appName = appName;
        else this.appName = 'mirotalk';
        this.debugOn = debugOn;
    }

    debug(msg, op = '') {
        if (this.debugOn === false) return;
        let dataTime = new Date().toISOString().replace(/T/, ' ').replace(/Z/, '');
        console.log('[' + dataTime + '] [' + this.appName + '] ' + msg, op);
    }

    warn(msg, op = '') {
        let dataTime = new Date().toISOString().replace(/T/, ' ').replace(/Z/, '');
        console.warn('[' + dataTime + '] [' + this.appName + '] ' + msg, op);
    }

    error(msg, op = '') {
        let dataTime = new Date().toISOString().replace(/T/, ' ').replace(/Z/, '');
        console.error('[' + dataTime + '] [' + this.appName + '] ' + msg, op);
    }
};

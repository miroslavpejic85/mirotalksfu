'use strict';

const util = require('util');

const colors = require('colors');

const config = require('./config');

config.console.colors ? colors.enable() : colors.disable();

const options = {
    depth: null,
    colors: true,
};
module.exports = class Logger {
    constructor(appName = 'miroTalkSfu') {
        this.appName = colors.yellow(appName);
        this.debugOn = config.console.debug;
        this.timeStart = Date.now();
        this.timeEnd = null;
        this.timeElapsedMs = null;
        this.tzOptions = {
            timeZone: process.env.TZ || config.console.timeZone || 'UTC',
            hour12: false,
        };
    }

    debug(msg, op = '') {
        if (this.debugOn) {
            this.timeEnd = Date.now();
            this.timeElapsedMs = this.getFormatTime(Math.floor(this.timeEnd - this.timeStart));
            console.debug(
                '[' + this.getDateTime() + '] [' + this.appName + '] ' + msg,
                util.inspect(op, options),
                this.timeElapsedMs,
            );
            this.timeStart = Date.now();
        }
    }

    log(msg, op = '') {
        console.log('[' + this.getDateTime() + '] [' + this.appName + '] ' + msg, util.inspect(op, options));
    }

    info(msg, op = '') {
        console.info(
            '[' + this.getDateTime() + '] [' + this.appName + '] ' + colors.green(msg),
            util.inspect(op, options),
        );
    }

    warn(msg, op = '') {
        console.warn(
            '[' + this.getDateTime() + '] [' + this.appName + '] ' + colors.yellow(msg),
            util.inspect(op, options),
        );
    }

    error(msg, op = '') {
        console.error(
            '[' + this.getDateTime() + '] [' + this.appName + '] ' + colors.red(msg),
            util.inspect(op, options),
        );
    }

    getDateTime() {
        const currentTime = new Date().toLocaleString('en-US', this.tzOptions);
        const milliseconds = String(new Date().getMilliseconds()).padStart(3, '0');
        return colors.cyan(`${currentTime}:${milliseconds}`);
    }

    getFormatTime(ms) {
        let time = Math.floor(ms);
        let type = 'ms';

        if (ms >= 1000) {
            time = Math.floor((ms / 1000) % 60);
            type = 's';
        }
        if (ms >= 60000) {
            time = Math.floor((ms / 1000 / 60) % 60);
            type = 'm';
        }
        if (ms >= (3, 6e6)) {
            time = Math.floor((ms / 1000 / 60 / 60) % 24);
            type = 'h';
        }
        return colors.magenta('+' + time + type);
    }
};

'use strict';

const xss = require('xss');
const Logger = require('./Logger');
const log = new Logger('Xss');

const checkXSS = (dataObject) => {
    if (typeof dataObject === 'object' && dataObject !== null) {
        const data = xss(JSON.stringify(dataObject));
        log.debug('Sanitization done');
        return JSON.parse(data);
    }
    return dataObject;
};

module.exports = checkXSS;

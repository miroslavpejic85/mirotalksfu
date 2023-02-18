'use strict';

const xss = require('xss');
const Logger = require('./Logger');
const log = new Logger('Xss');

const checkXSS = (dataObject) => {
    const data = xss(JSON.stringify(dataObject));
    log.debug('Sanitization done');
    return JSON.parse(data);
};

module.exports = checkXSS;

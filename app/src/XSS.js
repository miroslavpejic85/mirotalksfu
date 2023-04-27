'use strict';

const xss = require('xss');
const Logger = require('./Logger');
const log = new Logger('Xss');

const checkXSS = (dataObject) => {
    try {
        if (typeof dataObject === 'object' && Object.keys(dataObject).length > 0) {
            const data = xss(JSON.stringify(dataObject));
            log.debug('Check XSS done');
            return JSON.parse(data);
        }
        return xss(dataObject);
    } catch (error) {
        log.error('Check XSS error', { error: error, data: dataObject });
        return dataObject;
    }
};

module.exports = checkXSS;

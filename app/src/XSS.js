'use strict';

const xss = require('xss');
const Logger = require('./Logger');
const log = new Logger('Xss');

const checkXSS = (dataObject) => {
    try {
        if (typeof dataObject === 'object' && Object.keys(dataObject).length > 0) {
            const escapedObj = escapeObject(dataObject);
            const data = xss(JSON.stringify(escapedObj));
            log.debug('Check XSS done');
            return JSON.parse(data);
        }
        return xss(dataObject);
    } catch (error) {
        log.error('Check XSS error', { error: error, data: dataObject });
        return dataObject;
    }
};

function escapeObject(obj) {
    const escapedObj = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const escapedKey = key.replace(/[\\"']/g, '\\$&').replace(/\u0000/g, '\\0');
            escapedObj[escapedKey] = obj[key];
        }
    }
    return escapedObj;
}

module.exports = checkXSS;

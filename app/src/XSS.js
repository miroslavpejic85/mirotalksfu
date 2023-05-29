'use strict';

const xss = require('xss');
const Logger = require('./Logger');
const log = new Logger('Xss');

const checkXSS = (dataObject) => {
    try {
        if (typeof dataObject === 'object' && Object.keys(dataObject).length > 0) {
            let objectJson = objectToJSONString(dataObject);
            if (objectJson) {
                let jsonString = xss(objectJson);
                let jsonObject = JSONStringToObject(jsonString);
                if (jsonObject) {
                    log.debug('XSS Object sanitization done');
                    return jsonObject;
                }
            }
        }
        if (typeof dataObject === 'string' || dataObject instanceof String) {
            log.debug('XSS String sanitization done');
            return xss(dataObject);
        }
        log.warn('XSS not sanitized', dataObject);
        return dataObject;
    } catch (error) {
        log.error('XSS error', { data: dataObject, error: error });
        return dataObject;
    }
};

function objectToJSONString(dataObject) {
    try {
        return JSON.stringify(dataObject);
    } catch (error) {
        return false;
    }
}

function JSONStringToObject(jsonString) {
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        return false;
    }
}

module.exports = checkXSS;

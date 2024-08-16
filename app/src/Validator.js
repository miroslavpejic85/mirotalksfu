'use strict';

const checkXSS = require('./XSS.js');

function isValidRoomName(input) {
    if (typeof input !== 'string') {
        return false;
    }
    const room = checkXSS(input);
    return !room ? false : !hasPathTraversal(room);
}

function isValidRecFileNameFormat(input) {
    if (typeof input !== 'string') {
        return false;
    }
    if (!input.startsWith('Rec_') || !input.endsWith('.webm')) {
        return false;
    }
    return !hasPathTraversal(input);
}

function hasPathTraversal(input) {
    const pathTraversalPattern = /(\.\.(\/|\\))+/;
    return pathTraversalPattern.test(input);
}

module.exports = {
    isValidRoomName,
    isValidRecFileNameFormat,
    hasPathTraversal,
};

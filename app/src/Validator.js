'use strict';

const path = require('path');

const checkXSS = require('./XSS.js');

function isValidRoomName(input) {
    if (!input || typeof input !== 'string') {
        return false;
    }
    const room = checkXSS(input);
    return !room ? false : !hasPathTraversal(room);
}

function isValidRecFileNameFormat(input) {
    if (!input || typeof input !== 'string') {
        return false;
    }
    const validPattern = /^Rec_[a-zA-Z0-9_-]+\.webm$/;
    if (!validPattern.test(input)) {
        return false;
    }
    return !hasPathTraversal(input);
}

function hasPathTraversal(input) {
    if (!input || typeof input !== 'string') {
        return false;
    }

    let decodedInput = input;
    try {
        decodedInput = decodeURIComponent(input);
        decodedInput = decodeURIComponent(decodedInput);
    } catch (err) {}

    const pathTraversalPattern = /(\.\.(\/|\\))+/;
    const excessiveDotsPattern = /(\.{4,}\/+|\.{4,}\\+)/;
    const complexTraversalPattern = /(\.{2,}(\/+|\\+))/;

    if (complexTraversalPattern.test(decodedInput)) {
        return true;
    }

    const normalizedPath = path.normalize(decodedInput);

    if (pathTraversalPattern.test(normalizedPath) || excessiveDotsPattern.test(normalizedPath)) {
        return true;
    }

    return false;
}

module.exports = {
    isValidRoomName,
    isValidRecFileNameFormat,
    hasPathTraversal,
};

'use strict';

function isValidRoomName(input) {
    if (typeof input !== 'string') {
        return false;
    }
    return !hasPathTraversal(input);
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

'use strict';

const path = require('path');

const checkXSS = require('./XSS.js');

function isValidRoomName(input) {
    if (!input || typeof input !== 'string') {
        return false;
    }
    const room = checkXSS(input);

    if (!room || ['false', 'undefined', '', null, undefined, 'favicon.ico'].includes(room.trim().toLowerCase())) {
        return false;
    }

    return !hasPathTraversal(room);
}

function isValidRecFileNameFormat(input) {
    if (!input || typeof input !== 'string') {
        return false;
    }
    const validPattern = /^Rec_[a-zA-Z0-9_.-]+\.webm$/;
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

function isValidEmail(email) {
    const emailRegex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
    return emailRegex.test(email);
}

function parseEmailList(input) {
    if (typeof input !== 'string') {
        return [];
    }

    return [...new Set(input.split(',').map((email) => email.trim().toLowerCase()))].filter((email) =>
        isValidEmail(email)
    );
}

function hasAllowedEmailDomains(emails, allowedDomains = []) {
    if (!Array.isArray(emails) || emails.length === 0) {
        return false;
    }

    if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) {
        return true;
    }

    const normalizedAllowedDomains = allowedDomains
        .map((domain) => String(domain).trim().toLowerCase())
        .filter(Boolean);

    if (normalizedAllowedDomains.length === 0) {
        return true;
    }

    return emails.every((email) => {
        const domain = email.split('@')[1]?.toLowerCase();
        return normalizedAllowedDomains.includes(domain);
    });
}

function isValidData(data) {
    if (!data || typeof data !== 'object') {
        return false;
    }
    return Object.keys(data).length > 0;
}

module.exports = {
    isValidRoomName,
    isValidRecFileNameFormat,
    hasPathTraversal,
    isValidEmail,
    parseEmailList,
    hasAllowedEmailDomains,
    isValidData,
};

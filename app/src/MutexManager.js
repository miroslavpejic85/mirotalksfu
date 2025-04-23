'use strict';

const { Mutex } = require('async-mutex');

// In-memory file mutex registry
const fileLocks = new Map();

function getFileMutex(filePath) {
    if (!fileLocks.has(filePath)) {
        fileLocks.set(filePath, new Mutex());
    }
    return fileLocks.get(filePath);
}

async function withFileLock(filePath, fn) {
    const mutex = getFileMutex(filePath);
    const release = await mutex.acquire();

    try {
        return await fn();
    } finally {
        release();
        if (!mutex.isLocked()) {
            fileLocks.delete(filePath); // Clean up when no one is waiting
        }
    }
}

module.exports = { withFileLock };

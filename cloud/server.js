'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sanitizeFilename = require('sanitize-filename');
const helmet = require('helmet');
const app = express();
const port = process.env.PORT || 8080;

// Replace with your actual logging mechanism
const log = {
    warn: console.warn,
    error: console.error,
    debug: console.log,
};

// Recording max file size
const recMaxFileSize = 1 * 1024 * 1024 * 1024; // 1 GB

// Directory where recordings will be stored
const recordingDirectory = path.join(__dirname, 'rec');

// Flag to enable/disable server recording
const isServerRecordingEnabled = true;

// CORS options
const corsOptions = {
    origin: '*',
    methods: ['POST'],
};

// Middleware
app.use(helmet());
app.use(express.json());
app.use(cors(corsOptions));

// Ensure the recording directory exists
function ensureRecordingDirectoryExists() {
    if (!fs.existsSync(recordingDirectory)) {
        fs.mkdirSync(recordingDirectory, { recursive: true });
    }
}

// Endpoint to handle recording uploads
app.post('/recSync', (req, res) => {
    try {
        if (!isServerRecordingEnabled) {
            return res.status(403).send('Server recording is disabled');
        }

        const { fileName } = req.query;

        if (!fileName) {
            return res.status(400).send('Filename not provided');
        }

        const safeFileName = sanitizeFilename(fileName);
        if (safeFileName !== fileName || !isValidRecFileNameFormat(fileName)) {
            log.warn('[RecSync] - Invalid file name:', fileName);
            return res.status(400).send('Invalid file name');
        }

        ensureRecordingDirectoryExists();

        const filePath = path.resolve(recordingDirectory, fileName);
        if (!filePath.startsWith(path.resolve(recordingDirectory))) {
            log.warn('[RecSync] - Attempt to save file outside allowed directory:', fileName);
            return res.status(400).send('Invalid file path');
        }

        if (!['application/octet-stream'].includes(req.headers['content-type'])) {
            log.warn('[RecSync] - Invalid content type:', req.headers['content-type']);
            return res.status(400).send('Invalid content type');
        }

        const writeStream = fs.createWriteStream(filePath, { flags: 'a' });

        let receivedBytes = 0;

        req.on('data', (chunk) => {
            receivedBytes += chunk.length;
            if (receivedBytes > recMaxFileSize) {
                req.destroy(); // Stop receiving data
                writeStream.destroy(); // Stop writing data
                log.warn('[RecSync] - File size exceeds limit:', fileName);
                return res.status(413).send('File too large');
            }
        });

        req.pipe(writeStream);

        writeStream.on('error', (err) => {
            log.error('[RecSync] - Error writing to file:', err.message);
            res.status(500).send('Internal Server Error');
        });

        writeStream.on('finish', () => {
            log.debug('[RecSync] - File saved successfully:', fileName);
            res.status(200).send('File uploaded successfully');
        });

        req.on('error', (err) => {
            log.error('[RecSync] - Error processing request:', err.message);
            res.status(500).send('Internal Server Error');
        });
    } catch (err) {
        log.error('[RecSync] - Error processing upload', err.message);
        res.status(500).send('Internal Server Error');
    }
});

// Start the server
app.listen(port, () => {
    log.debug(`Server is running on http://localhost:${port}`);
});

// Utils
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
    } catch (err) {
        // Ignore any errors during decoding
    }

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

'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sanitizeFilename = require('sanitize-filename');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
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

// Secret used to verify the per-session upload token.
// IMPORTANT: must match JWT_SECRET on the main MiroTalk SFU server that issues the token.
const jwtKey = process.env.JWT_SECRET || 'mirotalksfu_jwt_secret';

// Per-IP rate limiter for recording uploads (mitigates flooding / disk exhaustion)
const recSyncLimiter = rateLimit({
    windowMs: parseInt(process.env.RECORDING_RATE_LIMIT_WINDOW_MS) || 60 * 1000,
    max: parseInt(process.env.RECORDING_RATE_LIMIT_MAX) || 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many recording upload requests. Please try again later.',
});

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

// Extract the recording upload token from an Authorization: Bearer header or query param
function getRecUploadToken(req) {
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
    if (typeof req.query.uploadToken === 'string') return req.query.uploadToken;
    return null;
}

// Parse the roomId embedded in a recording filename (Rec_<roomId>_<...>.webm)
function getRoomIdFromFilename(fileName) {
    const parts = String(fileName).split('_');
    return parts.length >= 2 ? parts[1] : null;
}

// Authorize /recSync uploads: require a valid, unexpired token issued on join whose
// room matches the room encoded in the target filename.
function checkRecUploadToken(req, res, next) {
    try {
        const token = getRecUploadToken(req);
        if (!token) {
            return res.status(401).send('Missing upload token');
        }
        const decoded = jwt.verify(token, jwtKey);
        if (!decoded || decoded.scope !== 'rec-upload' || !decoded.roomId) {
            return res.status(401).send('Invalid upload token');
        }
        const { fileName } = req.query;
        if (!fileName || getRoomIdFromFilename(fileName) !== String(decoded.roomId)) {
            return res.status(403).send('Upload token room mismatch');
        }
        next();
    } catch (err) {
        log.warn('[RecSync] - Rejected upload with invalid token:', err.message);
        return res.status(401).send('Invalid or expired upload token');
    }
}

// Endpoint to handle recording uploads
app.post('/recSync', recSyncLimiter, checkRecUploadToken, (req, res) => {
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

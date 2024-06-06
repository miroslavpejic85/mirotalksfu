'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 8080;

// Replace with your actual logging mechanism
const log = {
    error: console.error,
    debug: console.log,
};

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
    if (!isServerRecordingEnabled) {
        return res.status(403).send('Server recording is disabled');
    }

    const { fileName } = req.query;

    if (!fileName) {
        return res.status(400).send('Filename not provided');
    }

    ensureRecordingDirectoryExists();

    const filePath = path.join(recordingDirectory, fileName);
    const writeStream = fs.createWriteStream(filePath, { flags: 'a' });

    req.pipe(writeStream);

    writeStream.on('error', (err) => {
        log.error('Error writing to file:', err.message);
        res.status(500).send('Internal Server Error');
    });

    writeStream.on('finish', () => {
        log.debug('File saved successfully:', fileName);
        res.status(200).send('File uploaded successfully');
    });

    req.on('error', (err) => {
        log.error('Error processing request:', err.message);
        res.status(500).send('Internal Server Error');
    });
});

// Start the server
app.listen(port, () => {
    log.debug(`Server is running on http://localhost:${port}`);
});

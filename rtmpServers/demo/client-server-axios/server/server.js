'use strict';

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto-js');
const RtmpStreamer = require('./RtmpStreamer.js'); // Import the RtmpStreamer class
const bodyParser = require('body-parser');
const path = require('path');

const port = 9999;

const rtmpCfg = {
    enabled: true,
    maxStreams: 1,
    server: 'rtmp://localhost:1935',
    appName: 'mirotalk',
    streamKey: '',
    secret: 'mirotalkRtmpSecret', // Must match the key in node-media-server/src/config.js if play and publish are set to true, otherwise leave it ''
    apiSecret: 'mirotalkRtmpApiSecret', // Must match the apiSecret specified in the Client side.
    expirationHours: 4,
};

const dir = {
    client: path.join(__dirname, '../', 'client'),
    index: path.join(__dirname, '../', 'client/index.html'),
};

const app = express();

const corsOptions = { origin: '*', methods: ['GET', 'POST'] };

app.use(cors(corsOptions));
app.use(express.static(dir.client)); // Expose client
app.use(express.json({ limit: '50mb' })); // Ensure the body parser can handle large files
app.use(bodyParser.raw({ type: 'video/webm', limit: '50mb' })); // handle raw binary data

const streams = {}; // Collect all rtmp streams

function checkRTMPApiSecret(req, res, next) {
    const expectedApiSecret = rtmpCfg && rtmpCfg.apiSecret;
    const apiSecret = req.headers.authorization;

    if (!apiSecret || apiSecret !== expectedApiSecret) {
        console.log('RTMP apiSecret Unauthorized', {
            apiSecret: apiSecret,
            expectedApiSecret: expectedApiSecret,
        });
        return res.status(401).send('Unauthorized');
    }
    next();
}

function checkMaxStreams(req, res, next) {
    const maxStreams = rtmpCfg.maxStreams || 10; // Set your maximum allowed streams here
    if (Object.keys(streams).length >= maxStreams) {
        console.log('Maximum number of streams reached', streams);
        return res.status(429).send('Maximum number of streams reached, please try later!');
    }
    next();
}

// Define a route handler for the default home page
app.get('/', (req, res) => {
    res.sendFile(dir.index);
});

app.get('/rtmpEnabled', (req, res) => {
    const rtmpEnabled = rtmpCfg && rtmpCfg.enabled;
    console.debug('RTMP enabled', rtmpEnabled);
    res.json({ enabled: rtmpEnabled });
});

app.post('/initRTMP', checkRTMPApiSecret, checkMaxStreams, (req, res) => {
    if (!rtmpCfg || !rtmpCfg.enabled) {
        return res.status(400).send('RTMP server is not enabled or missing the config');
    }

    const domainName = req.headers.host.split(':')[0];

    const rtmpServer = rtmpCfg.server != '' ? rtmpCfg.server : false;
    const rtmpServerAppName = rtmpCfg.appName != '' ? rtmpCfg.appName : 'live';
    const rtmpStreamKey = rtmpCfg.streamKey != '' ? rtmpCfg.streamKey : uuidv4();
    const rtmpServerSecret = rtmpCfg.secret != '' ? rtmpCfg.secret : false;
    const expirationHours = rtmpCfg.expirationHours || 4;
    const rtmpServerURL = rtmpServer ? rtmpServer : `rtmp://${domainName}:1935`;
    const rtmpServerPath = '/' + rtmpServerAppName + '/' + rtmpStreamKey;

    const rtmp = rtmpServerSecret
        ? generateRTMPUrl(rtmpServerURL, rtmpServerPath, rtmpServerSecret, expirationHours)
        : rtmpServerURL + rtmpServerPath;

    console.info('initRTMP', {
        headers: req.headers,
        rtmpServer,
        rtmpServerSecret,
        rtmpServerURL,
        rtmpServerPath,
        expirationHours,
        rtmpStreamKey,
        rtmp,
    });

    const stream = new RtmpStreamer(rtmp, rtmpStreamKey);
    streams[rtmpStreamKey] = stream;

    console.log('Active RTMP Streams', Object.keys(streams).length);

    res.json({ rtmp });
});

app.post('/streamRTMP', checkRTMPApiSecret, (req, res) => {
    if (!rtmpCfg || !rtmpCfg.enabled) {
        return res.status(400).send('RTMP server is not enabled');
    }
    if (!req.body || req.body.length === 0) {
        return res.status(400).send('Invalid video data');
    }

    const rtmpStreamKey = req.query.key;
    const stream = streams[rtmpStreamKey];

    if (!stream || !stream.isRunning()) {
        delete streams[rtmpStreamKey];
        console.debug('Stream not found', { rtmpStreamKey, streams: Object.keys(streams).length });
        return res.status(404).send('FFmpeg Stream not found');
    }

    console.debug('Received video data', {
        // data: req.body.slice(0, 20).toString('hex'),
        rtmpStreamKey: rtmpStreamKey,
        size: bytesToSize(req.headers['content-length']),
    });

    stream.write(Buffer.from(req.body));
    res.sendStatus(200);
});

app.post('/stopRTMP', checkRTMPApiSecret, (req, res) => {
    if (!rtmpCfg || !rtmpCfg.enabled) {
        return res.status(400).send('RTMP server is not enabled');
    }

    const rtmpStreamKey = req.query.key;
    const stream = streams[rtmpStreamKey];

    if (stream) {
        stream.end();
        delete streams[rtmpStreamKey];
        console.debug('Active RTMP Streams', Object.keys(streams).length);
    }

    res.sendStatus(200);
});

function generateRTMPUrl(baseURL, streamPath, secretKey, expirationHours = 4) {
    const currentTime = Math.floor(Date.now() / 1000);
    const expirationTime = currentTime + expirationHours * 3600;
    const hashValue = crypto.MD5(`${streamPath}-${expirationTime}-${secretKey}`).toString();
    const rtmpUrl = `${baseURL}${streamPath}?sign=${expirationTime}-${hashValue}`;

    console.debug('generateRTMPUrl', {
        currentTime,
        expirationTime,
        hashValue,
        rtmpUrl,
    });

    return rtmpUrl;
}

function bytesToSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes == 0) return '0 Byte';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
}

// Start the server and listen on port 3000
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`, rtmpCfg);
});

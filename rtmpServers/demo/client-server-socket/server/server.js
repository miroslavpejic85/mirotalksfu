'use strict';

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto-js');
const RtmpStreamer = require('./RtmpStreamer.js');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');

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

const streams = {}; // Collect all rtmp streams
const corsOptions = { origin: '*', methods: ['GET'] };

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    transports: ['websocket'],
    cors: corsOptions,
});

app.use(express.static(dir.client));
app.use(cors(corsOptions));

// Logs requests
app.use((req, res, next) => {
    console.debug('New request:', {
        method: req.method,
        path: req.originalUrl,
    });
    next();
});

function checkRTMPApiSecret(apiSecret) {
    return apiSecret && apiSecret === rtmpCfg.apiSecret;
}

function checkMaxStreams() {
    return Object.keys(streams).length < rtmpCfg.maxStreams;
}

app.get('/', (req, res) => {
    res.sendFile(dir.index);
});

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('initRTMP', ({ apiSecret }) => {
        //
        if (!checkRTMPApiSecret(apiSecret)) {
            return socket.emit('error', 'Unauthorized');
        }

        if (!checkMaxStreams()) {
            return socket.emit('error', 'Maximum number of streams reached, please try later!');
        }

        const hostHeader = socket.handshake.headers.host;
        const domainName = hostHeader.split(':')[0]; // Extract domain name

        const rtmpServer = rtmpCfg.server !== '' ? rtmpCfg.server : false;
        const rtmpServerAppName = rtmpCfg.appName !== '' ? rtmpCfg.appName : 'live';
        const rtmpStreamKey = rtmpCfg.streamKey !== '' ? rtmpCfg.streamKey : uuidv4();
        const rtmpServerSecret = rtmpCfg.secret !== '' ? rtmpCfg.secret : false;
        const expirationHours = rtmpCfg.expirationHours || 4;
        const rtmpServerURL = rtmpServer ? rtmpServer : `rtmp://${domainName}:1935`;
        const rtmpServerPath = '/' + rtmpServerAppName + '/' + rtmpStreamKey;

        const rtmp = rtmpServerSecret
            ? generateRTMPUrl(rtmpServerURL, rtmpServerPath, rtmpServerSecret, expirationHours)
            : rtmpServerURL + rtmpServerPath;

        console.info('initRTMP', {
            rtmpServer,
            rtmpServerSecret,
            rtmpServerURL,
            rtmpServerPath,
            expirationHours,
            rtmpStreamKey,
            rtmp,
        });

        const stream = new RtmpStreamer(rtmp, rtmpStreamKey, socket);
        streams[rtmpStreamKey] = stream;

        console.log('Active RTMP Streams', Object.keys(streams).length);

        return socket.emit('initRTMP', { rtmp, rtmpStreamKey });
    });

    socket.on('streamRTMP', async ({ apiSecret, rtmpStreamKey, data }) => {
        if (!checkRTMPApiSecret(apiSecret)) {
            return socket.emit('error', 'Unauthorized');
        }

        const stream = streams[rtmpStreamKey];

        if (!stream || !stream.isRunning()) {
            delete streams[rtmpStreamKey];
            console.debug('Stream not found', { rtmpStreamKey, streams: Object.keys(streams).length });
            return;
        }

        console.debug('Received video data via Socket.IO', {
            // data: data.slice(0, 20).toString('hex'),
            key: rtmpStreamKey,
            size: bytesToSize(data.length),
        });

        stream.write(Buffer.from(data));
        socket.emit('ack');
    });

    socket.on('stopRTMP', ({ apiSecret, rtmpStreamKey }) => {
        if (!checkRTMPApiSecret(apiSecret)) {
            return socket.emit('error', 'Unauthorized');
        }

        const stream = streams[rtmpStreamKey];

        if (stream) {
            stream.end();
            delete streams[rtmpStreamKey];
            console.debug('Streams', Object.keys(streams).length);
        }

        socket.emit('stopRTMP');
    });

    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
    });
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
    if (bytes === 0) return '0 Byte';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
}

server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`, rtmpCfg);
});

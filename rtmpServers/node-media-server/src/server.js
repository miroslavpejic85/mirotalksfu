'use strict';

const NodeMediaServer = require('node-media-server');

const config = require('./config');

console.log('Rtmp Server config', {
    config: config,
    http: {
        admin: 'http://localhost:8081/admin',
        stats: 'http://localhost:8081/api/server',
        streams: 'http://localhost:8081/api/streams',
    },
    https: {
        admin: 'https://localhost:8043/admin',
        stats: 'https://localhost:8043/api/server',
        streams: 'http://localhost:8043/api/streams',
    },
});

const nms = new NodeMediaServer(config);

nms.run();

nms.on('preConnect', (id, args) => {
    console.log('[NodeEvent on preConnect]', `id=${id} args=${JSON.stringify(args)}`);
    // let session = nms.getSession(id);
    // session.reject();
});

nms.on('postConnect', (id, args) => {
    console.log('[NodeEvent on postConnect]', `id=${id} args=${JSON.stringify(args)}`);
});

nms.on('doneConnect', (id, args) => {
    console.log('[NodeEvent on doneConnect]', `id=${id} args=${JSON.stringify(args)}`);
});

nms.on('prePublish', (id, StreamPath, args) => {
    console.log('[NodeEvent on prePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
    // let session = nms.getSession(id);
    // session.reject();
});

nms.on('postPublish', (id, StreamPath, args) => {
    console.log('[NodeEvent on postPublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.on('donePublish', (id, StreamPath, args) => {
    console.log('[NodeEvent on donePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.on('prePlay', (id, StreamPath, args) => {
    console.log('[NodeEvent on prePlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.on('postPlay', (id, StreamPath, args) => {
    console.log('[NodeEvent on postPlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
    // let session = nms.getSession(id);
    // session.reject();
});

nms.on('donePlay', (id, StreamPath, args) => {
    console.log('[NodeEvent on donePlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.on('logMessage', (...args) => {
    // custom logger log message handler
});

nms.on('errorMessage', (...args) => {
    // custom logger error message handler
});

nms.on('debugMessage', (...args) => {
    // custom logger debug message handler
});

nms.on('ffDebugMessage', (...args) => {
    // custom logger ffmpeg debug message handler
});

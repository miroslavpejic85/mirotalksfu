'use strict';

const config = {
    rtmp: {
        port: 1935,
        chunk_size: 60000,
        gop_cache: true,
        ping: 60,
        ping_timeout: 30,
    },
    http: {
        port: 8081,
        allow_origin: '*',
    },
    https: {
        port: 8043,
        key: __dirname + '/key.pem',
        cert: __dirname + '/cert.pem',
    },
    auth: {
        api: true,
        api_user: 'mirotalk',
        api_pass: 'mirotalkRtmpPassword', // http://localhost:8081/admin
        play: false, // Require authentication for playing streams
        publish: false, // Require authentication for publishing streams
        secret: 'mirotalkRtmpSecret', // Check the sign.js file to generate a valid RTMP URL
    },
};

module.exports = config;

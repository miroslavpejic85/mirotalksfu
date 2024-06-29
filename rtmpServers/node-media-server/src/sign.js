'use strict';

const crypto = require('crypto-js');

const { v4: uuidv4 } = require('uuid');

/**
 * Generates an RTMP URL with an expiration timestamp and a hash value.
 *
 * @param {string} baseURL - The base URL of the RTMP server.
 * @param {string} streamPath - The path to the stream.
 * @param {string} secretKey - The secret key used for generating the hash.
 * @param {number} expirationHours - The number of hours until the URL expires.
 * @returns {string} - The generated RTMP URL for Node Media Server.
 */
function generateRTMPUrl(baseURL, streamPath, secretKey, expirationHours = 8) {
    // Current timestamp in seconds
    const currentTime = Math.floor(Date.now() / 1000);

    // Expiration time (current time + expirationHours in seconds)
    const expirationTime = currentTime + expirationHours * 3600;

    // Generate the hash value
    const hashValue = crypto.MD5(`${streamPath}-${expirationTime}-${secretKey}`).toString();

    // Construct the final request address
    const rtmpUrl = `${baseURL}${streamPath}?sign=${expirationTime}-${hashValue}`;

    // Print some log
    log.debug('generateRTMPUrl', {
        currentTime: currentTime,
        expirationTime: expirationTime,
        hashValue: hashValue,
        rtmpUrl: rtmpUrl,
    });

    return rtmpUrl;
}

// Example usage
const baseURL = 'rtmp://localhost:1935';
const streamKey = uuidv4();
const streamPath = '/live/' + streamKey; // path/stream-key
const secretKey = 'mirotalkRtmpSecret';
const expirationHours = 8;

// Run: node sign.js
const rtmpUrl = generateRTMPUrl(baseURL, streamPath, secretKey, expirationHours);
console.log('Generated RTMP URL:', rtmpUrl);

/*
OBS:
	- Server: rtmp://localhost:1935/live
	- StreamKey: demo?sign=1719169535-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

FFMPEG:
	- ffmpeg -re -i input.mp4 -c:v libx264 -preset veryfast -maxrate 3000k -bufsize 6000k -vf "scale=-2:720" -g 50 -c:a aac -b:a 128k -f flv "rtmp://localhost:1935/live/demo?sign=1719169535-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
*/

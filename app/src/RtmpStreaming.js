'use strict';

const config = require('./config');
const crypto = require('crypto-js');
const RtmpFile = require('./RtmpFile');
const RtmpUrl = require('./RtmpUrl');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Logger = require('./Logger');
const log = new Logger('RtmpStreaming');

class RtmpStreaming {
    constructor(room) {
        this.room = room;
        this.rtmpFileStreamer = null;
        this.rtmpUrlStreamer = null;
        this.rtmp = config?.media?.rtmp || false;
    }

    // Proxy method for RtmpFile/RtmpUrl callbacks
    send(socket_id, action, data) {
        this.room.send(socket_id, action, data);
    }

    // ##############################################
    // RTMP from FILE
    // ##############################################

    isRtmpFileStreamerActive() {
        return this.rtmpFileStreamer;
    }

    async getRTMP(dir = '../rtmp') {
        const folderPath = path.join(__dirname, dir);
        log.debug('[getRTMP] Files from dir', folderPath);

        try {
            if (!fs.existsSync(folderPath)) {
                log.debug('[getRTMP] Dir not exists going to create', folderPath);
                fs.mkdirSync(folderPath, { recursive: true });
            }
            const files = fs.readdirSync(folderPath);
            log.debug('[getRTMP] Files', files);
            return files;
        } catch (error) {
            log.error(`[getRTMP] Error reading directory: ${error.message}`);
            return [];
        }
    }

    async startRTMP(socket_id, room, host = 'localhost', port = 1935, file = '../rtmp/BigBuckBunny.mp4') {
        if (!this.rtmp || !this.rtmp.enabled) {
            log.debug('[startRTMP] Server is not enabled or missing the config');
            return false;
        }

        if (this.rtmpFileStreamer) {
            log.debug('[startRTMP] Already in progress');
            return false;
        }

        const inputFilePath = path.join(__dirname, file);

        if (!fs.existsSync(inputFilePath)) {
            log.error(`[startRTMP] File not found: ${inputFilePath}`);
            return false;
        }

        log.debug('[startRTMP] Read all stream from file', inputFilePath);

        this.rtmpFileStreamer = new RtmpFile(socket_id, this);

        const inputStream = fs.createReadStream(inputFilePath);

        const rtmpUrl = this.getRTMPUrl(host, port);

        const rtmpRun = await this.rtmpFileStreamer.start(inputStream, rtmpUrl);

        if (!rtmpRun) {
            this.rtmpFileStreamer = false;
            return this.rtmpFileStreamer;
        }
        return rtmpUrl;
    }

    stopRTMP() {
        if (!this.rtmp || !this.rtmp.enabled) {
            log.debug('[stopRTMP] Server is not enabled or missing the config');
            return false;
        }
        if (this.rtmpFileStreamer) {
            this.rtmpFileStreamer.stop();
            this.rtmpFileStreamer = null;
            log.debug('[stopRTMP] Streamer Stopped successfully!');
            return true;
        } else {
            log.debug('[stopRTMP] No process to stop');
            return false;
        }
    }

    // ####################################################
    // RTMP from URL
    // ####################################################

    isRtmpUrlStreamerActive() {
        return this.rtmpUrlStreamer;
    }

    async startRTMPfromURL(
        socket_id,
        room,
        host = 'localhost',
        port = 1935,
        inputVideoURL = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
    ) {
        if (!this.rtmp || !this.rtmp.enabled) {
            log.debug('[startRTMPfromURL] Server is not enabled or missing the config');
            return false;
        }

        if (this.rtmpUrlStreamer) {
            log.debug('[startRTMPfromURL] Already in progress');
            return false;
        }

        log.debug('[startRTMPfromURL] Input video URL', inputVideoURL);

        this.rtmpUrlStreamer = new RtmpUrl(socket_id, this);

        const rtmpUrl = this.getRTMPUrl(host, port);

        const rtmpRun = await this.rtmpUrlStreamer.start(inputVideoURL, rtmpUrl);

        if (!rtmpRun) {
            this.rtmpUrlStreamer = false;
            return this.rtmpUrlStreamer;
        }
        return rtmpUrl;
    }

    stopRTMPfromURL() {
        if (!this.rtmp || !this.rtmp.enabled) {
            log.debug('[stopRTMPfromURL] Server is not enabled or missing the config');
            return false;
        }
        if (this.rtmpUrlStreamer) {
            this.rtmpUrlStreamer.stop();
            this.rtmpUrlStreamer = null;
            log.debug('[stopRTMPfromURL] Streamer Stopped successfully!');
            return true;
        } else {
            log.debug('[stopRTMPfromURL] No process to stop');
            return false;
        }
    }

    // ####################################################
    // RTMP COMMON
    // ####################################################

    getRTMPUrl(host, port) {
        const rtmpUseNodeMediaServer = this.rtmp.useNodeMediaServer ?? true;
        const rtmpServer = this.rtmp.server != '' ? this.rtmp.server : false;
        const rtmpAppName = this.rtmp.appName != '' ? this.rtmp.appName : 'live';
        const rtmpStreamKey = this.rtmp.streamKey != '' ? this.rtmp.streamKey : uuidv4();
        const rtmpServerSecret = this.rtmp.secret != '' ? this.rtmp.secret : false;
        const expirationHours = this.rtmp.expirationHours || 4;
        const rtmpServerURL = rtmpServer ? rtmpServer : `rtmp://${host}:${port}`;
        const rtmpServerPath = '/' + rtmpAppName + '/' + rtmpStreamKey;

        const rtmpUrl = rtmpUseNodeMediaServer
            ? this.generateRTMPUrl(rtmpServerURL, rtmpServerPath, rtmpServerSecret, expirationHours)
            : rtmpServerURL + rtmpServerPath;

        log.info('RTMP Url generated', rtmpUrl);
        return rtmpUrl;
    }

    generateRTMPUrl(baseURL, streamPath, secretKey, expirationHours = 8) {
        const currentTime = Math.floor(Date.now() / 1000);
        const expirationTime = currentTime + expirationHours * 3600;
        const hashValue = crypto.MD5(`${streamPath}-${expirationTime}-${secretKey}`).toString();
        const rtmpUrl = `${baseURL}${streamPath}?sign=${expirationTime}-${hashValue}`;
        return rtmpUrl;
    }

    // ####################################################
    // CLEANUP
    // ####################################################

    closeAll() {
        if (this.isRtmpFileStreamerActive()) this.stopRTMP();
        if (this.isRtmpUrlStreamerActive()) this.stopRTMPfromURL();
    }
}

module.exports = RtmpStreaming;

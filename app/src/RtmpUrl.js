'use strict';

const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const Logger = require('./Logger');
const log = new Logger('RtmpUrl');

class RtmpUrl {
    constructor(socket_id = false, room = false) {
        this.room = room;
        this.socketId = socket_id;
        this.rtmpUrl = '';
        this.ffmpegProcess = null;
    }

    async start(inputVideoURL, rtmpUrl) {
        if (this.ffmpegProcess) {
            log.debug('Streaming is already in progress');
            return false;
        }

        this.rtmpUrl = rtmpUrl;

        try {
            this.ffmpegProcess = ffmpeg(inputVideoURL)
                .inputOptions('-re') // Read input in real-time
                .audioCodec('aac') // Set audio codec to AAC
                .audioBitrate('128k') // Set audio bitrate to 128 kbps
                .videoCodec('libx264') // Set video codec to H.264
                .videoBitrate('3000k') // Set video bitrate to 3000 kbps
                .size('1280x720') // Scale video to 1280x720 resolution
                .format('flv') // Set output format to FLV
                .output(rtmpUrl)
                .on('start', (commandLine) => log.info('ffmpeg process starting with command:', commandLine))
                .on('progress', (progress) => {
                    /* log.debug('Processing', progress); */
                })
                .on('error', (err, stdout, stderr) => {
                    this.ffmpegProcess = null;
                    if (!err.message.includes('Exiting normally')) {
                        this.handleError(err.message, stdout, stderr);
                    }
                })
                .on('end', () => {
                    log.info('FFmpeg processing finished');
                    this.ffmpegProcess = null;
                    this.handleEnd();
                })
                .run();

            log.info('RtmpUrl started', rtmpUrl);
            return true;
        } catch (error) {
            log.error('Error starting RtmpUrl', error.message);
            return false;
        }
    }

    async stop() {
        if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
            try {
                this.ffmpegProcess.kill('SIGTERM');
                this.ffmpegProcess = null;
                log.info('RtmpUrl stopped');
                return true;
            } catch (error) {
                log.error('Error stopping RtmpUrl', error.message);
                return false;
            }
        } else {
            log.debug('No RtmpUrl process to stop');
            return true;
        }
    }

    handleEnd() {
        if (!this.room) return;
        this.room.send(this.socketId, 'endRTMPfromURL', { rtmpUrl: this.rtmpUrl });
        this.room.rtmpUrlStreamer = false;
    }

    handleError(message, stdout, stderr) {
        if (!this.room) return;
        this.room.send(this.socketId, 'errorRTMPfromURL', { message });
        this.room.rtmpUrlStreamer = false;
        log.error('Error: ' + message, { stdout, stderr });
    }
}

module.exports = RtmpUrl;

'use strict';

const config = require('./config');
const ffmpegPath = config.media?.rtmp?.ffmpegPath || '/usr/bin/ffmpeg';
const { spawnFfmpeg } = require('./FfmpegProcess');

const Logger = require('./Logger');
const log = new Logger('RtmpFile');

class RtmpFile {
    constructor(socket_id = false, room = false) {
        this.socketId = socket_id;
        this.room = room;
        this.rtmpUrl = '';
        this.ffmpegProcess = null;
        this.stopping = false;
    }

    async start(inputStream, rtmpUrl) {
        if (this.ffmpegProcess) {
            log.debug('Streaming is already in progress');
            return false;
        }

        this.rtmpUrl = rtmpUrl;

        try {
            const args = [
                '-re',
                '-i',
                'pipe:0',
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-maxrate',
                '3000k',
                '-bufsize',
                '6000k',
                '-g',
                '50',
                '-c:a',
                'aac',
                '-b:a',
                '128k',
                '-f',
                'flv',
                rtmpUrl,
            ];
            this.ffmpegProcess = spawnFfmpeg(ffmpegPath, args, inputStream, {
                onStart: (commandLine) => log.debug('ffmpeg process starting with command:', commandLine),
                onError: (err, stdout, stderr) => {
                    this.ffmpegProcess = null;
                    if (!this.stopping) this.handleError(err.message, stdout, stderr);
                },
                onEnd: () => {
                    log.debug('FFmpeg processing finished');
                    this.ffmpegProcess = null;
                    this.handleEnd();
                },
            });

            log.debug('RtmpFile started', rtmpUrl);
            return true;
        } catch (error) {
            log.error('Error starting RtmpFile', error.message);
            return false;
        }
    }

    async stop() {
        if (this.stopping) return true;
        this.stopping = true;

        if (this.ffmpegProcess) {
            try {
                this.ffmpegProcess.kill('SIGTERM');
                this.ffmpegProcess = null;
                log.debug('RtmpFile stopped');
                return true;
            } catch (error) {
                log.error('Error stopping RtmpFile', error.message);
                return false;
            }
        } else {
            log.debug('No RtmpFile process to stop');
            return true;
        }
    }

    handleEnd() {
        if (!this.room) return;
        this.room.send(this.socketId, 'endRTMP', { rtmpUrl: this.rtmpUrl });
        this.room.rtmpFileStreamer = null;
    }

    handleError(message, stdout, stderr) {
        if (!this.room) return;
        this.room.send(this.socketId, 'errorRTMP', { message });
        this.room.rtmpFileStreamer = null;
        log.error('Error: ' + message, { stdout, stderr });
    }
}

module.exports = RtmpFile;

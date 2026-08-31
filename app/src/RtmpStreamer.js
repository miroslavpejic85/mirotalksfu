'use strict';

const config = require('./config');
const { PassThrough } = require('stream');
const ffmpegPath = config.media?.rtmp?.ffmpegPath || '/usr/bin/ffmpeg';
const { spawnFfmpeg } = require('./FfmpegProcess');

const Logger = require('./Logger');
const log = new Logger('RtmpStreamer');

class RtmpStreamer {
    constructor(rtmpUrl, rtmpKey) {
        this.rtmpUrl = rtmpUrl;
        this.rtmpKey = rtmpKey;
        this.log = log;
        this.stream = new PassThrough();
        this.ffmpegStream = null;
        this.ending = false;
        this.initFFmpeg();
        this.run = true;
    }

    initFFmpeg() {
        const args = [
            '-f',
            'webm',
            '-re',
            '-i',
            'pipe:0',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-tune',
            'zerolatency',
            '-b:v',
            '3000k',
            '-maxrate',
            '3000k',
            '-bufsize',
            '6000k',
            '-g',
            '60',
            '-keyint_min',
            '60',
            '-sc_threshold',
            '0',
            '-pix_fmt',
            'yuv420p',
            '-filter:v',
            'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
            '-f',
            'flv',
            this.rtmpUrl,
        ];
        this.ffmpegStream = spawnFfmpeg(ffmpegPath, args, this.stream, {
            onStart: (commandLine) => this.log.debug('ffmpeg command', { id: this.rtmpKey, cmd: commandLine }),
            onError: (err, stdout, stderr) => {
                this.ffmpegStream = null;
                if (!this.ending) {
                    this.log.error(`Error: ${err.message}`, { stdout, stderr });
                }
                this.end();
            },
            onEnd: () => {
                this.ffmpegStream = null;
                this.log.debug('FFmpeg process ended', this.rtmpKey);
                this.end();
            },
        });
    }

    write(data) {
        if (this.stream) this.stream.write(data);
    }

    isRunning() {
        return this.run;
    }

    end() {
        if (this.ending) return;
        this.ending = true;

        if (this.stream) {
            this.stream.end();
            this.stream = null;
            this.log.debug('RTMP streaming stopped', this.rtmpKey);
        }
        if (this.ffmpegStream) {
            this.ffmpegStream.kill('SIGTERM');
            this.ffmpegStream = null;
            this.log.debug('FFMPEG closed successfully', this.rtmpKey);
        }
        this.run = false;
    }
}

module.exports = RtmpStreamer;

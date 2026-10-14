'use strict';

const config = require('./config');
const { PassThrough } = require('stream');
const ffmpegPath = config.media?.rtmp?.ffmpegPath || '/usr/bin/ffmpeg';
const { spawnFfmpeg } = require('./FfmpegProcess');
const { resolveRtmpVideoSettings, buildLiveStreamArgs } = require('./RtmpQuality');

const Logger = require('./Logger');
const log = new Logger('RtmpStreamer');

class RtmpStreamer {
    constructor(rtmpUrl, rtmpKey, options = {}) {
        this.rtmpUrl = rtmpUrl;
        this.rtmpKey = rtmpKey;
        this.settings = resolveRtmpVideoSettings(config.media?.rtmp, options.quality);
        this.hasAudio = options.hasAudio !== false;
        this.log = log;
        this.stream = new PassThrough();
        this.ffmpegStream = null;
        this.ending = false;
        this.initFFmpeg();
        this.run = true;
    }

    initFFmpeg() {
        const args = buildLiveStreamArgs(this.settings, this.rtmpUrl, { hasAudio: this.hasAudio });
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

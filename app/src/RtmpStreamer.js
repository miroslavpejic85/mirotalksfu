'use strict';

const config = require('./config');
const { PassThrough } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = config.server.rtmp && config.server.rtmp.ffmpeg ? config.server.rtmp.ffmpeg : '/usr/bin/ffmpeg';
ffmpeg.setFfmpegPath(ffmpegPath);

const Logger = require('./Logger');
const log = new Logger('RtmpStreamer');

class RtmpStreamer {
    constructor(rtmpUrl, rtmpKey) {
        this.rtmpUrl = rtmpUrl;
        this.rtmpKey = rtmpKey;
        this.log = log;
        this.stream = new PassThrough();
        this.ffmpegStream = null;
        this.initFFmpeg();
        this.run = true;
    }

    initFFmpeg() {
        this.ffmpegStream = ffmpeg()
            .input(this.stream)
            .inputOptions('-re')
            .inputFormat('webm')
            .videoCodec('libx264')
            .videoBitrate('3000k')
            .size('1280x720')
            .audioCodec('aac')
            .audioBitrate('128k')
            .outputOptions(['-f flv'])
            .output(this.rtmpUrl)
            .on('start', (commandLine) => this.log.info('ffmpeg command', { id: this.rtmpKey, cmd: commandLine }))
            .on('progress', (progress) => {
                /* log.debug('Processing', progress); */
            })
            .on('error', (err, stdout, stderr) => {
                if (!err.message.includes('Exiting normally')) {
                    this.log.error(`Error: ${err.message}`, { stdout, stderr });
                }
                this.end();
            })
            .on('end', () => {
                this.log.info('FFmpeg process ended', this.rtmpKey);
                this.end();
            })
            .run();
    }

    write(data) {
        if (this.stream) this.stream.write(data);
    }

    isRunning() {
        return this.run;
    }

    end() {
        if (this.stream) {
            this.stream.end();
            this.stream = null;
            this.log.info('RTMP streaming stopped', this.rtmpKey);
        }
        if (this.ffmpegStream && !this.ffmpegStream.killed) {
            this.ffmpegStream.kill('SIGTERM');
            this.ffmpegStream = null;
            this.log.info('FFMPEG closed successfully', this.rtmpKey);
        }
        this.run = false;
    }
}

module.exports = RtmpStreamer;

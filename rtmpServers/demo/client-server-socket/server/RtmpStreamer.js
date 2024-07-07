'use strict';

const { PassThrough } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

class RtmpStreamer {
    constructor(rtmpUrl, rtmpKey, socket) {
        (this.socket = socket), (this.rtmpUrl = rtmpUrl);
        this.rtmpKey = rtmpKey;
        this.stream = new PassThrough();
        this.ffmpegStream = null;
        this.initFFmpeg();
        this.run = true;
    }

    initFFmpeg() {
        this.ffmpegStream = ffmpeg()
            .input(this.stream)
            .inputOptions('-re')
            .videoCodec('libx264')
            .videoBitrate('3000k')
            .size('1280x720')
            .audioCodec('aac')
            .audioBitrate('128k')
            .outputOptions(['-f flv'])
            .output(this.rtmpUrl)
            .on('start', (commandLine) => console.info('ffmpeg command', { id: this.rtmpKey, cmd: commandLine }))
            .on('error', (err, stdout, stderr) => {
                if (!err.message.includes('Exiting normally')) {
                    console.error('FFmpeg error:', { id: this.rtmpKey, error: err.message });
                    this.socket.emit('error', err.message);
                }
                this.end();
            })
            .on('end', () => {
                console.info('FFmpeg process ended', this.rtmpKey);
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
            console.info('RTMP streaming stopped', this.rtmpKey);
        }
        if (this.ffmpegStream && !this.ffmpegStream.killed) {
            this.ffmpegStream.kill('SIGTERM');
            this.ffmpegStream = null;
            console.info('FFMPEG closed successfully', this.rtmpKey);
        }
        this.run = false;
    }
}

module.exports = RtmpStreamer;

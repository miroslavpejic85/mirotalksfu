'use strict';

const { spawn } = require('node:child_process');
const { PassThrough } = require('stream');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

class RtmpStreamer {
    constructor(rtmpUrl, rtmpKey, socket) {
        this.socket = socket;
        this.rtmpUrl = rtmpUrl;
        this.rtmpKey = rtmpKey;
        this.stream = new PassThrough();
        this.ffmpegStream = null;
        this.initFFmpeg();
        this.run = true;
    }

    initFFmpeg() {
        const args = [
            '-re',
            '-i',
            'pipe:0',
            '-c:v',
            'libx264',
            '-b:v',
            '3000k',
            '-s',
            '1280x720',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-f',
            'flv',
            this.rtmpUrl,
        ];
        let spawnError = null;
        let stderr = '';

        this.ffmpegStream = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });
        this.stream.pipe(this.ffmpegStream.stdin);
        this.ffmpegStream.stderr.on('data', (data) => (stderr += data));
        this.ffmpegStream.stdin.on('error', (error) => {
            if (error.code !== 'EPIPE') spawnError = error;
        });
        this.ffmpegStream.on('spawn', () =>
            console.info('ffmpeg command', { id: this.rtmpKey, cmd: [ffmpegPath, ...args].join(' ') })
        );
        this.ffmpegStream.on('error', (error) => {
            spawnError = error;
        });
        this.ffmpegStream.on('close', (code, signal) => {
            if (!this.ending && (spawnError || code !== 0)) {
                const error = spawnError || new Error(`FFmpeg exited with code ${code}${signal ? ` (${signal})` : ''}`);
                console.error('FFmpeg error:', { id: this.rtmpKey, error: error.message, stderr });
                this.socket.emit('error', error.message);
            } else if (!this.ending) {
                console.info('FFmpeg process ended', this.rtmpKey);
            }
            this.end();
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

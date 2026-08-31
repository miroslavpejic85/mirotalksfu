'use strict';

const config = require('./config');
const ffmpegPath = config.media?.rtmp?.ffmpegPath || '/usr/bin/ffmpeg';
const { spawnFfmpeg } = require('./FfmpegProcess');

const fs = require('node:fs');
const http = require('http');
const https = require('https');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const Validator = require('./Validator');

const Logger = require('./Logger');
const log = new Logger('RtmpUrl');

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 15000;

class RtmpUrl {
    constructor(socket_id = false, room = false) {
        this.room = room;
        this.socketId = socket_id;
        this.rtmpUrl = '';
        this.ffmpegProcess = null;
        this.inputRequest = null;
        this.inputResponse = null;
        this.tempDir = null;
        this.stopping = false;
    }

    /**
     * Perform the HTTP(S) fetch in Node instead of letting FFmpeg do it, so that the
     * initial URL and every redirect hop are validated against the SSRF denylist and
     * connections can only be opened to the resolved public addresses.
     * @param {string} inputVideoURL
     * @returns {Promise<import('http').IncomingMessage>} the validated response stream
     */
    async openValidatedStream(inputVideoURL) {
        let currentUrl = inputVideoURL;

        for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
            if (!(await Validator.isPublicHttpUrl(currentUrl))) {
                throw new Error(`Blocked unsafe URL (SSRF): ${currentUrl}`);
            }

            const response = await this.request(currentUrl);
            const status = response.statusCode || 0;
            const location = response.headers.location;

            if (status >= 300 && status < 400 && location) {
                response.resume(); // drain and drop
                currentUrl = new URL(location, currentUrl).toString();
                continue;
            }

            if (status < 200 || status >= 300) {
                response.resume();
                throw new Error(`Unexpected response status ${status} for the input video URL`);
            }

            return response;
        }

        throw new Error('Too many redirects for the input video URL');
    }

    request(url) {
        return new Promise((resolve, reject) => {
            const client = new URL(url).protocol === 'https:' ? https : http;
            const req = client.get(
                url,
                {
                    lookup: Validator.safeDnsLookup,
                    timeout: REQUEST_TIMEOUT_MS,
                    headers: { 'User-Agent': 'MiroTalkSFU' },
                },
                resolve
            );
            req.on('timeout', () => req.destroy(new Error('Input video URL request timed out')));
            req.on('error', reject);
            this.inputRequest = req;
        });
    }

    async downloadValidatedFile(inputVideoURL) {
        const inputStream = await this.openValidatedStream(inputVideoURL);
        this.inputResponse = inputStream;
        this.tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mirotalk-rtmp-'));
        const inputFilePath = path.join(this.tempDir, 'input-media');

        await pipeline(inputStream, fs.createWriteStream(inputFilePath));
        this.inputResponse = null;
        this.inputRequest = null;
        return inputFilePath;
    }

    async start(inputVideoURL, rtmpUrl) {
        if (this.ffmpegProcess) {
            log.debug('Streaming is already in progress');
            return false;
        }

        this.rtmpUrl = rtmpUrl;

        try {
            const inputFilePath = await this.downloadValidatedFile(inputVideoURL);
            if (this.stopping) {
                this.closeInput();
                return false;
            }

            const args = [
                '-re',
                '-i',
                inputFilePath,
                '-c:a',
                'aac',
                '-b:a',
                '128k',
                '-c:v',
                'libx264',
                '-b:v',
                '3000k',
                '-s',
                '1280x720',
                '-f',
                'flv',
                rtmpUrl,
            ];
            this.ffmpegProcess = spawnFfmpeg(ffmpegPath, args, null, {
                onStart: (commandLine) => log.debug('ffmpeg process starting with command:', commandLine),
                onError: (err, stdout, stderr) => {
                    this.ffmpegProcess = null;
                    this.closeInput();
                    if (!this.stopping) this.handleError(err.message, stdout, stderr);
                },
                onEnd: () => {
                    log.debug('FFmpeg processing finished');
                    this.ffmpegProcess = null;
                    this.closeInput();
                    this.handleEnd();
                },
            });

            log.debug('RtmpUrl started', rtmpUrl);
            return true;
        } catch (error) {
            this.closeInput();
            log.error('Error starting RtmpUrl', error.message);
            return false;
        }
    }

    closeInput() {
        if (this.inputResponse) {
            this.inputResponse.destroy();
            this.inputResponse = null;
        }
        if (this.inputRequest) {
            this.inputRequest.destroy();
            this.inputRequest = null;
        }
        if (this.tempDir) {
            fs.rmSync(this.tempDir, { recursive: true, force: true });
            this.tempDir = null;
        }
    }

    async stop() {
        if (this.stopping) return true;
        this.stopping = true;

        this.closeInput();

        if (this.ffmpegProcess) {
            try {
                this.ffmpegProcess.kill('SIGTERM');
                this.ffmpegProcess = null;
                log.debug('RtmpUrl stopped');
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
        this.room.rtmpUrlStreamer = null;
    }

    handleError(message, stdout, stderr) {
        if (!this.room) return;
        this.room.send(this.socketId, 'errorRTMPfromURL', { message });
        this.room.rtmpUrlStreamer = null;
        log.error('Error: ' + message, { stdout, stderr });
    }
}

module.exports = RtmpUrl;

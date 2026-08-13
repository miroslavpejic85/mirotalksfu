'use strict';

/**
 * Whisper (server-side) transcription.
 *
 * Records short audio segments from the microphone and sends them to the server
 * for transcription via the `getWhisperTranscription` socket request. Used as an
 * alternative to the browser's Web Speech API.
 *
 * Relies on globals defined for the in-room UI (userLog, hide, show, setColor,
 * transcriptionSpeech* elements, transcriptionDialect, rc, room_id, peer_name,
 * peer_avatar) and delegates transcript delivery back to the owning Transcription
 * instance.
 */
class WhisperTranscription {
    constructor(transcription) {
        this.transcription = transcription; // owning Transcription instance
        this.isEnabled = false; // set from server room config on join
        this.mode = false; // user toggle: use Whisper instead of the Web Speech API
        this.segmentMs = 5000; // length of each recorded audio segment
        this.stream = null;
        this.recorder = null;
        this.active = false;
        this.timer = null;
        this.audioContext = null;
        this.analyser = null;
        this.silenceThreshold = 12; // 0-128 peak on the time-domain waveform; below this = silence
    }

    toggleMode(enabled) {
        if (this.transcription.transcriptionRunning) {
            userLog('info', 'Please stop the current transcription before changing mode', 'top-end');
            return false;
        }
        this.mode = enabled && this.isEnabled;
        return this.mode;
    }

    start() {
        if (!this.isEnabled) {
            return userLog('warning', 'Whisper transcription is not enabled on this server', 'top-end');
        }
        if (this.active) return;
        navigator.mediaDevices
            .getUserMedia({ audio: true })
            .then((stream) => {
                this.stream = stream;
                this.active = true;
                this.transcription.transcriptionRunning = true;
                this.transcription.selectDisabled(true);
                this.setupAnalyser(stream);
                hide(transcriptionSpeechStart);
                show(transcriptionSpeechStop);
                setColor(transcriptionSpeechStatus, 'lime');
                userLog('info', 'Whisper transcription started', 'top-end');
                this.recordSegment();
            })
            .catch((error) => {
                this.active = false;
                this.transcription.transcriptionRunning = false;
                this.transcription.selectDisabled(false);
                userLog('error', `Microphone access error ${error.message}`, 'top-end', 6000);
                console.error('Whisper getUserMedia error', error);
            });
    }

    stop() {
        this.active = false;
        this.transcription.transcriptionRunning = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        try {
            if (this.recorder && this.recorder.state !== 'inactive') {
                this.recorder.stop();
            }
        } catch (error) {
            console.warn('Whisper recorder stop error', error);
        }
        if (this.stream) {
            this.stream.getTracks().forEach((track) => track.stop());
            this.stream = null;
        }
        if (this.audioContext) {
            try {
                this.audioContext.close();
            } catch (error) {
                console.warn('Whisper audio context close error', error);
            }
            this.audioContext = null;
            this.analyser = null;
        }
        this.recorder = null;
        this.transcription.selectDisabled(false);
        hide(transcriptionSpeechStop);
        show(transcriptionSpeechStart);
        setColor(transcriptionSpeechStatus, 'white');
        userLog('info', 'Whisper transcription stopped', 'top-end');
    }

    setupAnalyser(stream) {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            const source = this.audioContext.createMediaStreamSource(stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            source.connect(this.analyser);
        } catch (error) {
            this.analyser = null;
            console.warn('Whisper analyser setup error', error);
        }
    }

    getPeakLevel() {
        if (!this.analyser) return 255; // no analyser: never skip
        const data = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
            const v = Math.abs(data[i] - 128);
            if (v > peak) peak = v;
        }
        return peak;
    }

    recordSegment() {
        if (!this.active || !this.stream) return;

        const mimeType =
            typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';

        let recorder;
        try {
            recorder = new MediaRecorder(this.stream, { mimeType });
        } catch (error) {
            this.stop();
            return userLog('error', `Whisper recording not supported ${error.message}`, 'top-end', 6000);
        }

        this.recorder = recorder;
        const chunks = [];
        let hasSpeech = false;

        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        // Sample the mic level during the segment; only send if real speech was detected
        const levelMonitor = setInterval(() => {
            if (this.getPeakLevel() > this.silenceThreshold) hasSpeech = true;
        }, 150);

        recorder.onstop = () => {
            clearInterval(levelMonitor);
            const blob = new Blob(chunks, { type: mimeType });
            // Skip sending while the microphone is off.
            if (hasSpeech && blob.size > 1000 && !this.transcription.isAudioOff()) {
                this.sendBlob(blob, mimeType);
            }
            if (this.active) this.recordSegment();
        };

        recorder.start();

        this.timer = setTimeout(() => {
            if (recorder.state !== 'inactive') recorder.stop();
        }, this.segmentMs);
    }

    sendBlob(blob, mimeType) {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = String(reader.result).split(',')[1];
            if (!base64) return;

            const language = (transcriptionDialect.value || 'en-US').split('-')[0];

            rc.socket
                .request('getWhisperTranscription', { audio: base64, mimeType, language }, 30000)
                .then((res) => {
                    const text = res && res.text ? res.text.trim() : '';
                    if (!text) return;
                    const transcriptionData = {
                        type: 'transcript',
                        room_id: room_id,
                        peer_name: peer_name,
                        peer_avatar: peer_avatar,
                        text_data: text,
                        time_stamp: new Date(),
                        broadcast: true,
                    };
                    this.transcription.sendTranscript(transcriptionData);
                    this.transcription.handleTranscript(transcriptionData);
                })
                .catch((error) => {
                    console.error('Whisper transcription request error', error);
                });
        };
        reader.readAsDataURL(blob);
    }
}

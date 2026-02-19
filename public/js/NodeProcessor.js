'use strict';

// Handle UI updates and interactions
class UIManager {
    constructor(elements) {
        this.elements = elements;
    }

    updateStatus(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const printMessage = `[${timestamp}] ${message}`;
        switch (type) {
            case 'error':
                console.error(printMessage);
                break;
            case 'success':
                console.info(printMessage);
                break;
            case 'warning':
                console.warn(printMessage);
                break;
            default:
                console.log(printMessage);
                break;
        }
    }

    updateUI(isProcessing, noiseSuppressionEnabled) {
        this.updateStatus(
            `Audio processing ${isProcessing ? 'started' : 'stopped'}`,
            isProcessing ? 'success' : 'info'
        );

        this.elements.labelNoiseSuppression.style.color = noiseSuppressionEnabled ? 'lime' : 'white';
    }
}

// Handle audio worklet message processing
class MessageHandler {
    constructor(uiManager, wasmLoader) {
        this.uiManager = uiManager;
        this.wasmLoader = wasmLoader;
    }

    handleMessage(event) {
        if (event.data.type === 'request-wasm') {
            this.wasmLoader.loadWasmBuffer();
        } else if (event.data.type === 'wasm-ready') {
            this.uiManager.updateStatus('✅ RNNoise WASM initialized successfully', 'success');
        } else if (event.data.type === 'wasm-error') {
            this.uiManager.updateStatus('❌ RNNoise WASM error: ' + event.data.error, 'error');
        } else if (event.data.type === 'vad') {
            if (event.data.isSpeech) {
                //this.uiManager.updateStatus(`🗣️ Speech detected (VAD: ${event.data.probability.toFixed(2)})`, 'info');
            }
        }
    }
}

// Handle only WASM module loading
class WasmLoader {
    constructor(uiManager, getWorkletNode) {
        this.uiManager = uiManager;
        this.getWorkletNode = getWorkletNode;
    }

    async loadWasmBuffer() {
        try {
            this.uiManager.updateStatus('📦 Loading RNNoise sync module...', 'info');

            const jsResponse = await fetch('../js/RnnoiseSync.js');

            if (!jsResponse.ok) {
                throw new Error('Failed to load rnnoise-sync.js');
            }

            const jsContent = await jsResponse.text();
            this.uiManager.updateStatus('📦 Sending sync module to worklet...', 'info');

            this.getWorkletNode().port.postMessage({
                type: 'sync-module',
                jsContent: jsContent,
            });

            this.uiManager.updateStatus('📦 Sync module sent to worklet', 'info');
        } catch (error) {
            this.uiManager.updateStatus('❌ Failed to load sync module: ' + error.message, 'error');
            console.error('Sync module loading error:', error);
        }
    }
}

// Handle RNNoise processing
class RNNoiseProcessor {
    constructor() {
        this.audioContext = null;
        this.workletNode = null;
        this.mediaStream = null;
        this.sourceNode = null;
        this.destinationNode = null;
        this.isProcessing = false;
        this.noiseSuppressionEnabled = false;

        this.initializeUI();
        this.initializeDependencies();
    }

    /**
     * Check if AudioWorklet and WebAssembly are supported.
     * Mobile browsers may lack AudioWorklet or restrict synchronous WASM compilation.
     * @returns {boolean}
     */
    static isSupported() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            const hasAudioWorklet = AudioCtx && 'audioWorklet' in AudioCtx.prototype;
            const hasWebAssembly =
                typeof WebAssembly === 'object' &&
                typeof WebAssembly.Module === 'function' &&
                typeof WebAssembly.Instance === 'function';
            return !!(hasAudioWorklet && hasWebAssembly);
        } catch (e) {
            return false;
        }
    }

    initializeUI() {
        this.elements = {
            labelNoiseSuppression: document.getElementById('labelNoiseSuppression'),
            switchNoiseSuppression: document.getElementById('switchNoiseSuppression'),
        };

        this.elements.switchNoiseSuppression.onchange = (e) => {
            const enabled = e.currentTarget.checked;
            localStorageSettings.mic_noise_suppression = enabled;
            lS.setSettings(localStorageSettings);
            userLog(
                enabled ? 'success' : 'info',
                `Noise suppression ${enabled ? 'enabled' : 'disabled'}`,
                'top-end',
                3000
            );
            this.setNoiseSuppression(enabled);
        };
    }

    initializeDependencies() {
        this.uiManager = new UIManager(this.elements);
        this.wasmLoader = new WasmLoader(this.uiManager, () => this.workletNode);
        this.messageHandler = new MessageHandler(this.uiManager, this.wasmLoader);
    }

    async toggleProcessing(mediaStream = null) {
        this.isProcessing ? this.stopProcessing() : await this.startProcessing(mediaStream);
    }

    async startProcessing(mediaStream = null) {
        if (!mediaStream) {
            throw new Error('No media stream provided to startProcessing');
        }
        try {
            this.uiManager.updateStatus('🎤 Starting audio processing...', 'info');

            if (!RNNoiseProcessor.isSupported()) {
                this.uiManager.updateStatus(
                    '⚠️ AudioWorklet or WebAssembly not supported, skipping RNNoise',
                    'warning'
                );
                return null;
            }

            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
            const sampleRate = this.audioContext.sampleRate;
            this.uiManager.updateStatus(`🎵 Audio context created with sample rate: ${sampleRate}Hz`, 'info');

            if (this.audioContext.state === 'suspended') {
                try {
                    await this.audioContext.resume();
                    this.uiManager.updateStatus('🎵 AudioContext resumed after suspend', 'info');
                } catch (e) {
                    this.uiManager.updateStatus('⚠️ AudioContext could not be resumed: ' + e.message, 'warning');
                }
            }

            this.mediaStream = mediaStream;
            if (!this.mediaStream.getAudioTracks().length) {
                throw new Error('No audio tracks found in the provided media stream');
            }

            await this.audioContext.audioWorklet.addModule('../js/NoiseSuppressionProcessor.js');

            this.workletNode = new AudioWorkletNode(this.audioContext, 'NoiseSuppressionProcessor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [1],
            });

            this.workletNode.port.onmessage = (event) => this.messageHandler.handleMessage(event);

            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.destinationNode = this.audioContext.createMediaStreamDestination();

            this.sourceNode.connect(this.workletNode);
            this.workletNode.connect(this.destinationNode);

            this.isProcessing = true;
            this.uiManager.updateUI(this.isProcessing, this.noiseSuppressionEnabled);
            this.uiManager.updateStatus('🎤 Audio processing started', 'success');

            // Return the processed MediaStream (with noise suppression)
            return this.destinationNode.stream;
        } catch (error) {
            this.uiManager.updateStatus('❌ Error: ' + error.message, 'error');
            console.error('RNNoise startProcessing error:', error);
            this.stopProcessing();
            return null;
        }
    }

    stopProcessing() {
        this.mediaStream = null;

        // Signal the worklet to free WASM memory before disconnecting
        try {
            this.workletNode?.port?.postMessage({ type: 'destroy' });
        } catch (e) {}

        try {
            this.sourceNode?.disconnect();
        } catch (e) {}
        try {
            this.workletNode?.disconnect();
        } catch (e) {}
        try {
            this.destinationNode?.stream?.getTracks?.().forEach((t) => t.stop());
        } catch (e) {}

        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.workletNode = null;
        this.sourceNode = null;
        this.destinationNode = null;
        this.isProcessing = false;
        this.noiseSuppressionEnabled = false;

        this.uiManager.updateUI(this.isProcessing, this.noiseSuppressionEnabled);
        this.uiManager.updateStatus('🛑 Audio processing stopped', 'info');
    }

    setNoiseSuppression(enabled) {
        this.noiseSuppressionEnabled = enabled;

        if (this.workletNode) {
            this.workletNode.port.postMessage({
                type: 'enable',
                enabled: this.noiseSuppressionEnabled,
            });
        }

        this.noiseSuppressionEnabled
            ? this.uiManager.updateStatus('🔊 RNNoise enabled - background noise will be suppressed', 'success')
            : this.uiManager.updateStatus('🔇 RNNoise disabled - audio passes through unchanged', 'info');

        this.uiManager.updateUI(this.isProcessing, this.noiseSuppressionEnabled);
    }

    toggleNoiseSuppression() {
        this.setNoiseSuppression(!this.noiseSuppressionEnabled);
    }
}

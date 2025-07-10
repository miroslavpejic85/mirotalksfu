'use strict';
class VolumeProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.silenceThreshold = 0.01;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || input.length === 0) {
            return true;
        }

        const inputData = input[0];
        if (!inputData || inputData.length === 0) {
            return true;
        }

        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
        }

        const rms = Math.sqrt(sum / inputData.length);
        const volume = Math.max(0, Math.min(1, rms * 10));

        // Only send if not silent
        if (volume > this.silenceThreshold) {
            this.port.postMessage({
                type: 'volumeIndicator',
                volume: volume,
            });
        }

        return true;
    }
}

registerProcessor('volume-processor', VolumeProcessor);

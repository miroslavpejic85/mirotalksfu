// volume-processor.js
class VolumeProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
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

        // Send volume data for UI updates
        this.port.postMessage({
            type: 'volumeIndicator',
            volume: volume,
        });

        return true;
    }
}

registerProcessor('volume-processor', VolumeProcessor);

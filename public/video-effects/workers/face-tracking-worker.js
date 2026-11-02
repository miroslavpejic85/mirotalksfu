/**
 * MiroTalk Video Effects - face tracking worker (module worker).
 *
 * Runs MediaPipe Face Landmarker (Apache-2.0) off the main thread. The page sends downscaled
 * ImageBitmaps; the worker answers with the 478 normalized landmarks of the first face and the
 * blendshape scores (blinks, smile, brows...) used to animate avatars.
 */

// Blendshapes forwarded to the page (MediaPipe returns 52, avatars only need these)
const BLENDSHAPES = [
    'eyeBlinkLeft',
    'eyeBlinkRight',
    'jawOpen',
    'mouthSmileLeft',
    'mouthSmileRight',
    'browInnerUp',
    'browOuterUpLeft',
    'browOuterUpRight',
];

function pickBlendshapes(result) {
    const categories = result?.faceBlendshapes?.[0]?.categories;
    if (!categories?.length) return null;
    const scores = {};
    for (const category of categories) {
        if (BLENDSHAPES.includes(category.categoryName)) scores[category.categoryName] = category.score;
    }
    return scores;
}

let landmarker = null;
let lastTimestamp = -1;

async function createLandmarker(vision, fileset, config, delegate) {
    return vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: config.modelUrl, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: config.minDetectionConfidence,
        minFacePresenceConfidence: config.minPresenceConfidence,
        minTrackingConfidence: config.minTrackingConfidence,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
    });
}

async function init(config) {
    const vision = await import(config.visionBundleUrl);
    // true: load the ES module build of the WASM loader, module workers have no importScripts()
    const fileset = await vision.FilesetResolver.forVisionTasks(config.wasmBaseUrl, true);
    let delegate = config.delegate;
    try {
        landmarker = await createLandmarker(vision, fileset, config, delegate);
    } catch (error) {
        if (delegate !== 'GPU') throw error;
        // OffscreenCanvas WebGL is missing on some browsers: retry on the CPU
        delegate = 'CPU';
        landmarker = await createLandmarker(vision, fileset, config, delegate);
    }
    return delegate;
}

function detect({ id, bitmap, timestamp }) {
    let landmarks = null;
    let blendshapes = null;
    try {
        // MediaPipe requires strictly increasing timestamps in VIDEO mode
        const ts = Math.max(Math.round(timestamp), lastTimestamp + 1);
        lastTimestamp = ts;
        const result = landmarker.detectForVideo(bitmap, ts);
        const face = result?.faceLandmarks?.[0];
        if (face && face.length) {
            landmarks = new Float32Array(face.length * 3);
            for (let i = 0; i < face.length; i++) {
                landmarks[i * 3] = face[i].x;
                landmarks[i * 3 + 1] = face[i].y;
                landmarks[i * 3 + 2] = face[i].z;
            }
            blendshapes = pickBlendshapes(result);
        }
    } finally {
        bitmap.close();
    }
    if (landmarks) {
        self.postMessage({ type: 'result', id, landmarks, blendshapes }, [landmarks.buffer]);
    } else {
        self.postMessage({ type: 'result', id, landmarks: null });
    }
}

self.onmessage = async (event) => {
    const message = event.data || {};
    switch (message.type) {
        case 'init':
            try {
                const delegate = await init(message.config);
                self.postMessage({ type: 'ready', delegate });
            } catch (error) {
                self.postMessage({ type: 'error', stage: 'init', message: String(error?.message || error) });
            }
            break;
        case 'detect':
            if (!landmarker) {
                message.bitmap?.close();
                self.postMessage({ type: 'result', id: message.id, landmarks: null });
                break;
            }
            try {
                detect(message);
            } catch (error) {
                self.postMessage({
                    type: 'error',
                    stage: 'detect',
                    id: message.id,
                    message: String(error?.message || error),
                });
            }
            break;
        case 'close':
            try {
                landmarker?.close();
            } catch (error) {
                // ignore, the worker is going away
            }
            landmarker = null;
            self.close();
            break;
        default:
            break;
    }
};

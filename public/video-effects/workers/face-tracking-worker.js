/**
 * MiroTalk Video Effects - face tracking worker (module worker).
 *
 * Runs MediaPipe Face Landmarker (Apache-2.0) off the main thread. The page sends downscaled
 * ImageBitmaps; the worker answers with the 478 normalized landmarks of the first face and the
 * blendshape scores (blinks, smile, brows...) used to animate avatars. When the landmarker finds no face, the
 * page can ask for a face box from the full-range Face Detector ('find-face'), which also sees faces far from
 * the camera; the page then sends a crop around it, where the landmarker finds the face again.
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
let vision = null;
let fileset = null;
let workerConfig = null;
let faceDetector = null;
let faceDetectorPromise = null;

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

// In module workers MediaPipe imports its WASM loader once, but each new task clears self.ModuleFactory: the
// face detector created after the landmarker failed with "ModuleFactory not set". MediaPipe uses self.import
// when defined: restore the factory from the loader's default export (as in VirtualBackgroundWorker.js).
function installWasmLoaderImport() {
    self.import = async (url) => {
        const loader = await import(url);
        if (typeof loader?.default === 'function') self.ModuleFactory = loader.default;
        return loader;
    };
}

async function init(config) {
    workerConfig = config;
    vision = await import(config.visionBundleUrl);
    installWasmLoaderImport();
    // true: load the ES module build of the WASM loader, module workers have no importScripts()
    fileset = await vision.FilesetResolver.forVisionTasks(config.wasmBaseUrl, true);
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

// Loaded on the first request: only needed when someone sits far from the camera
function loadFaceDetector() {
    if (!faceDetectorPromise) {
        faceDetectorPromise = (async () => {
            if (!workerConfig?.faceDetectorModelUrl) throw new Error('No face detector model');
            faceDetector = await vision.FaceDetector.createFromOptions(fileset, {
                baseOptions: { modelAssetPath: workerConfig.faceDetectorModelUrl, delegate: 'CPU' },
                runningMode: 'IMAGE',
                minDetectionConfidence: 0.5,
            });
        })().catch((error) => {
            faceDetectorPromise = null;
            throw error;
        });
    }
    return faceDetectorPromise;
}

// The most confident face box, normalized to the image ({ x, y, width, height }), or null
function bestFaceBox(result, width, height) {
    let best = null;
    for (const detection of result?.detections || []) {
        const box = detection.boundingBox;
        const score = detection.categories?.[0]?.score ?? 0;
        if (!box || !(box.width > 0) || !(box.height > 0) || (best && best.score >= score)) continue;
        best = {
            score,
            x: box.originX / width,
            y: box.originY / height,
            width: box.width / width,
            height: box.height / height,
        };
    }
    if (!best) return null;
    const { score, ...face } = best;
    return face;
}

async function findFace({ id, bitmap }) {
    try {
        await loadFaceDetector();
        const box = bestFaceBox(faceDetector.detect(bitmap), bitmap.width, bitmap.height);
        self.postMessage({ type: 'face-box', id, box });
    } catch (error) {
        self.postMessage({ type: 'error', stage: 'find-face', id, message: String(error?.message || error) });
    } finally {
        bitmap.close();
    }
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
        case 'find-face':
            if (!landmarker) {
                message.bitmap?.close();
                self.postMessage({ type: 'face-box', id: message.id, box: null });
                break;
            }
            await findFace(message);
            break;
        case 'close':
            try {
                landmarker?.close();
                faceDetector?.close();
            } catch (error) {
                // ignore, the worker is going away
            }
            landmarker = null;
            faceDetector = null;
            self.close();
            break;
        default:
            break;
    }
};

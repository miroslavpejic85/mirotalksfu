'use strict';

const videoElement = document.getElementById('video');
const startCameraButton = document.getElementById('startCamera');
const startScreenButton = document.getElementById('startScreen');
const stopButton = document.getElementById('stop');
const apiSecretInput = document.getElementById('apiSecret'); // Replace with your actual API secret
const rtmpInput = document.getElementById('rtmp');
const copyButton = document.getElementById('copy');
const popup = document.getElementById('popup');
const popupMessage = document.getElementById('popupMessage');
const closePopup = document.getElementById('closePopup');

const qs = new URLSearchParams(window.location.search);
const videoId = filterXSS(qs.get('v'));
const videoResolution = filterXSS(qs.get('vr'));
const videoFrameRate = filterXSS(qs.get('vf'));
const audioId = filterXSS(qs.get('a'));
const screenFrameRate = filterXSS(qs.get('sf'));
const theme = filterXSS(qs.get('ts'));
const color = filterXSS(qs.get('tc'));

console.log('RTMP settings', {
    videoId: videoId,
    videoRes: videoResolution,
    videoFps: videoFrameRate,
    audioId: audioId,
    screenFps: screenFrameRate,
});

/* 
Low Latency: 1-2 seconds
Standard Use Case: 5 seconds
High Bandwidth/Stability: 10 seconds
*/
const chunkDuration = 4000; // ms

let mediaRecorder = null;
let rtmpKey = null; // To store the RTMP key

function toggleButtons(disabled = true) {
    startCameraButton.disabled = disabled;
    startScreenButton.disabled = disabled;
    stopButton.disabled = disabled;
}

function showPopup(message, type) {
    popup.classList.remove('success', 'error', 'warning', 'info');
    popup.classList.add(type);
    popupMessage.textContent = message;
    popup.classList.remove('hidden');
    setTimeout(() => {
        hidePopup();
    }, 5000); // Hide after 5 seconds
}

function hidePopup() {
    popup.classList.add('hidden');
}

function showError(message) {
    showPopup(message, 'error');
}

function checkRTMPEnabled() {
    axios
        .get('/rtmpEnabled')
        .then((response) => {
            const { enabled } = response.data;
            if (!enabled) {
                showPopup('The RTMP streaming feature has been disabled by the administrator', 'info');
                toggleButtons(true);
            }
        })
        .catch((error) => {
            console.error('Error fetching RTMP status:', error);
            showError(`Error fetching RTMP status: ${error.message}`);
        });
}

window.onload = checkRTMPEnabled;

async function startCapture(constraints) {
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        attachMediaStream(stream);
        return stream;
    } catch (err) {
        console.error('Error accessing media devices.', err);
        showError('Error accessing media devices. Please check your camera and microphone permissions.');
    }
}

async function startScreenCapture(constraints) {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
        attachMediaStream(stream);
        return stream;
    } catch (err) {
        console.error('Error accessing screen media.', err);
        showError('Error accessing screen sharing. Please try again or check your screen sharing permissions.');
    }
}

function attachMediaStream(stream) {
    videoElement.srcObject = stream;
    videoElement.playsInline = true;
    videoElement.autoplay = true;
    videoElement.muted = true;
    videoElement.volume = 0;
    videoElement.controls = false;
}

async function initRTMP(stream) {
    const apiSecret = apiSecretInput.value;
    try {
        const response = await axios.post(`/initRTMP`, null, {
            headers: {
                authorization: apiSecret,
            },
        });
        const { rtmp } = response.data;
        console.log('initRTMP response:', { res: response, rtmp: rtmp });
        rtmpInput.value = rtmp;
        rtmpKey = new URL(rtmp).pathname.split('/').pop(); // Extract the RTMP key from the URL
        toggleButtons(true);
        stopButton.disabled = false; // Enable stopButton on successful initialization
        return true;
    } catch (error) {
        if (error.response) {
            const { status, data } = error.response;
            showPopup(data, 'info');
            console.log('Init RTMP', {
                status,
                data,
            });
        } else {
            showError('Error initializing RTMP. Please try again.');
            console.error('Error initializing RTMP:', error);
        }
        stopStreaming();
        stopTracks(stream);
        return false;
    }
}

async function stopRTMP() {
    const apiSecret = apiSecretInput.value;

    stopStreaming();

    try {
        await axios.post(`/stopRTMP?key=${rtmpKey}`, null, {
            headers: {
                authorization: apiSecret,
            },
        });
    } catch (error) {
        showError('Error stopping RTMP. Please try again.');
        console.error('Error stopping RTMP:', error);
    }
}

async function streamRTMPChunk(data) {
    const apiSecret = apiSecretInput.value;

    const arrayBuffer = await data.arrayBuffer();
    const chunkSize = 1000000; // 1mb
    const totalChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const chunk = arrayBuffer.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize);
        try {
            await axios.post(`/streamRTMP?key=${rtmpKey}`, chunk, {
                headers: {
                    authorization: apiSecret,
                    'Content-Type': 'video/webm',
                },
            });
        } catch (error) {
            if (mediaRecorder) {
                stopStreaming();
                console.error('Error syncing chunk:', error.message);
                showError(`Error syncing chunk: ${error.message}`);
            }
        }
    }
}

function stopStreaming() {
    if (mediaRecorder) {
        mediaRecorder.stop();
    }
    videoElement.srcObject = null;
    rtmpInput.value = '';
    toggleButtons(false);
    stopButton.disabled = true;
}

function getSupportedMimeTypes() {
    const possibleTypes = ['video/webm;codecs=vp8,opus', 'video/mp4'];
    return possibleTypes.filter((mimeType) => {
        return MediaRecorder.isTypeSupported(mimeType);
    });
}

async function startStreaming(stream) {
    if (!stream) return;

    const initRTMPStream = await initRTMP(stream);

    if (!initRTMPStream) {
        return;
    }

    const supportedMimeTypes = getSupportedMimeTypes();
    console.log('MediaRecorder supported options', supportedMimeTypes);
    mediaRecorder = new MediaRecorder(stream, { mimeType: supportedMimeTypes[0] });

    mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
            await streamRTMPChunk(event.data);
        }
    };

    mediaRecorder.onstop = (event) => {
        console.log('Media recorder stopped');
        stopTracks(stream);
        mediaRecorder = null;
    };

    mediaRecorder.start(chunkDuration); // Record in chunks of the specified duration
}

function stopTracks(stream) {
    stream.getTracks().forEach((track) => {
        track.stop();
    });
}

async function startCameraStreaming() {
    const videoConstraints = videoId ? getRTMPVideoConstraints(videoId, videoResolution, videoFrameRate) : true;
    const audioConstraints = audioId ? { deviceId: audioId } : true;
    const stream = await startCapture({ video: videoConstraints, audio: audioConstraints });
    await startStreaming(stream);
}

async function startScreenStreaming() {
    const screenConstraints = getRTMPScreenConstraints(screenFrameRate);
    const stream = await startScreenCapture(screenConstraints);
    await startStreaming(stream);
}

function getRTMPVideoConstraints(videoId, videoResolution, videoFrameRate) {
    const defaultFrameRate = { ideal: 30 };
    const customFrameRate = videoFrameRate ? parseInt(videoFrameRate, 10) : 30;
    const frameRate = videoFrameRate === 'max' ? defaultFrameRate : customFrameRate;

    const baseConstraints = {
        deviceId: videoId,
        aspectRatio: 1.777, // 16:9
        frameRate: frameRate,
    };

    const resolutionConstraints = {
        default: { width: { ideal: 1280 }, height: { ideal: 720 } },
        qvga: { width: { exact: 320 }, height: { exact: 240 } },
        vga: { width: { exact: 640 }, height: { exact: 480 } },
        hd: { width: { exact: 1280 }, height: { exact: 720 } },
        fhd: { width: { exact: 1920 }, height: { exact: 1080 } },
        '2k': { width: { exact: 2560 }, height: { exact: 1440 } },
        '4k': { width: { exact: 3840 }, height: { exact: 2160 } },
        '6k': { width: { exact: 6144 }, height: { exact: 3456 } },
        '8k': { width: { exact: 7680 }, height: { exact: 4320 } },
    };

    const resolution = resolutionConstraints[videoResolution] || resolutionConstraints['default'];

    return { ...baseConstraints, ...resolution };
}

function getRTMPScreenConstraints(screenFrameRate) {
    const defaultFrameRate = { ideal: 30 };
    const customFrameRate = screenFrameRate ? parseInt(screenFrameRate, 10) : 30;
    const frameRate = screenFrameRate === 'max' ? defaultFrameRate : customFrameRate;
    return {
        audio: true,
        video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: frameRate,
        },
    };
}

function copyRTMP() {
    const rtmpInput = document.getElementById('rtmp');
    if (!rtmpInput.value) {
        return showPopup('No RTMP URL detected', 'info');
    }
    rtmpInput.select();
    document.execCommand('copy');
    showPopup('Copied: ' + rtmpInput.value, 'success');
}

function setCustomTheme() {
    document.documentElement.style.setProperty('--body-bg', `radial-gradient(${color}, ${color})`);
    document.documentElement.style.setProperty('--select-bg', `${color}`);
    document.documentElement.style.setProperty('--btns-bg-color', 'rgba(0, 0, 0, 0.7)');
    document.body.style.background = `radial-gradient(${color}, ${color})`;
}

function setTheme() {
    switch (theme) {
        case 'default':
            document.documentElement.style.setProperty('--body-bg', 'linear-gradient(135deg, #000000, #434343)');
            document.documentElement.style.setProperty('--select-bg', '#333333');
            document.documentElement.style.setProperty('--btns-bg-color', 'rgba(0, 0, 0, 0.7)');
            document.body.style.background = 'linear-gradient(135deg, #000000, #434343)';
            break;
        case 'dark':
            document.documentElement.style.setProperty('--body-bg', 'linear-gradient(135deg, #000000, #1a1a1a)');
            document.documentElement.style.setProperty('--select-bg', '#1a1a1a');
            document.documentElement.style.setProperty('--btns-bg-color', 'rgba(0, 0, 0, 0.85)');
            document.body.style.background = 'linear-gradient(135deg, #000000, #1a1a1a)';
            break;
        case 'grey':
            document.documentElement.style.setProperty('--body-bg', 'linear-gradient(135deg, #1a1a1a, #4f4f4f)');
            document.documentElement.style.setProperty('--select-bg', '#2a2a2a');
            document.documentElement.style.setProperty('--btns-bg-color', 'rgba(0, 0, 0, 0.7)');
            document.body.style.background = 'linear-gradient(135deg, #1a1a1a, #4f4f4f)';
            break;
        case 'green':
            document.documentElement.style.setProperty('--body-bg', 'linear-gradient(135deg, #002a22, #004d40)');
            document.documentElement.style.setProperty('--select-bg', '#002a22');
            document.documentElement.style.setProperty('--settings-bg', 'linear-gradient(135deg, #002a22, #004d40)');
            document.documentElement.style.setProperty('--btns-bg-color', 'rgba(0, 42, 34, 0.7)');
            document.body.style.background = 'linear-gradient(135deg, #002a22, #004d40)';
            break;
        case 'blue':
            document.documentElement.style.setProperty('--body-bg', 'linear-gradient(135deg, #00274d, #004d80)');
            document.documentElement.style.setProperty('--select-bg', '#00274d');
            document.documentElement.style.setProperty('--btns-bg-color', 'rgba(0, 39, 77, 0.7)');
            document.body.style.background = 'linear-gradient(135deg, #00274d, #004d80)';
            break;
        case 'red':
            document.documentElement.style.setProperty('--body-bg', 'linear-gradient(135deg, #2a0d0d, #4d1a1a)');
            document.documentElement.style.setProperty('--select-bg', '#2a0d0d');
            document.documentElement.style.setProperty('--btns-bg-color', 'rgba(42, 13, 13, 0.7)');
            document.body.style.background = 'linear-gradient(135deg, #2a0d0d, #4d1a1a)';
            break;
        case 'purple':
            document.documentElement.style.setProperty('--body-bg', 'linear-gradient(135deg, #2a001d, #4d004a)');
            document.documentElement.style.setProperty('--select-bg', '#2a001d');
            document.documentElement.style.setProperty('--btns-bg-color', 'rgba(42, 0, 29, 0.7)');
            document.body.style.background = 'linear-gradient(135deg, #2a001d, #4d004a)';
            break;
        case 'orange':
            document.documentElement.style.setProperty('--body-bg', 'linear-gradient(135deg, #3d1a00, #ff8c00)');
            document.documentElement.style.setProperty('--select-bg', '#3d1a00');
            document.documentElement.style.setProperty('--wb-bg', 'linear-gradient(135deg, #3d1a00, #ff8c00)');
            document.documentElement.style.setProperty('--btns-bg-color', 'rgba(61, 26, 0, 0.7)');
            document.body.style.background = 'linear-gradient(135deg, #3d1a00, #ff8c00)';
            break;
        case 'pink':
            document.documentElement.style.setProperty('--body-bg', 'linear-gradient(135deg, #4d001d, #ff66b2)');
            document.documentElement.style.setProperty('--select-bg', '#4d001d');
            document.documentElement.style.setProperty('--tab-btn-active', '#ff66b2');
            document.body.style.background = 'linear-gradient(135deg, #4d001d, #ff66b2)';
            break;
        case 'yellow':
            document.documentElement.style.setProperty('--body-bg', 'linear-gradient(135deg, #4d3b00, #ffc107)');
            document.documentElement.style.setProperty('--select-bg', '#4d3b00');
            document.documentElement.style.setProperty('--btns-bg-color', 'rgba(77, 59, 0, 0.7)');
            document.body.style.background = 'linear-gradient(135deg, #4d3b00, #ffc107)';
            break;
        default:
            break;
    }
}

startCameraButton.addEventListener('click', startCameraStreaming);
startScreenButton.addEventListener('click', startScreenStreaming);
stopButton.addEventListener('click', stopRTMP);
copyButton.addEventListener('click', copyRTMP);
closePopup.addEventListener('click', hidePopup);

window.addEventListener('load', color ? setCustomTheme : setTheme);

// Stop RTMP streaming when the browser tab is closed
window.addEventListener('beforeunload', async (event) => {
    if (mediaRecorder) {
        await stopRTMP();
    }
});

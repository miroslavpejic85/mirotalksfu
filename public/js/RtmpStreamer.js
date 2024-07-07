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
const audioId = filterXSS(qs.get('a'));

console.log('Video/Audio id', {
    video: videoId,
    audio: audioId,
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
    const videoConstraints = videoId ? { deviceId: videoId } : true;
    const audioConstraints = audioId ? { deviceId: audioId } : true;
    const stream = await startCapture({ video: videoConstraints, audio: audioConstraints });
    await startStreaming(stream);
}

async function startScreenStreaming() {
    const stream = await startScreenCapture({ video: true, audio: true });
    await startStreaming(stream);
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

startCameraButton.addEventListener('click', startCameraStreaming);
startScreenButton.addEventListener('click', startScreenStreaming);
stopButton.addEventListener('click', stopRTMP);
copyButton.addEventListener('click', copyRTMP);
closePopup.addEventListener('click', hidePopup);

// Stop RTMP streaming when the browser tab is closed
window.addEventListener('beforeunload', async (event) => {
    if (mediaRecorder) {
        await stopRTMP();
    }
});

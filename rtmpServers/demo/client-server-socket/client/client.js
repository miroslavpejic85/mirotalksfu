'use strict';

const videoElement = document.getElementById('video');
const startCameraButton = document.getElementById('startCamera');
const startScreenButton = document.getElementById('startScreen');
const stopButton = document.getElementById('stop');
const apiSecretInput = document.getElementById('apiSecret');
const rtmpInput = document.getElementById('rtmp');
const copyButton = document.getElementById('copy');
const popup = document.getElementById('popup');
const popupMessage = document.getElementById('popupMessage');
const closePopup = document.getElementById('closePopup');

/* 
Low Latency: 1-2 seconds
Standard Use Case: 5 seconds
High Bandwidth/Stability: 10 seconds
*/
const chunkDuration = 4000; // ms

let mediaRecorder = null;
let rtmpKey = null;
let socket = null;

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

function checkBrowserSupport() {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('chrome') && !userAgent.includes('edge') && !userAgent.includes('opr')) {
        console.log('Browser is Chrome-based. Proceed with functionality.');
    } else {
        showError(
            'This application requires a Chrome-based browser (Chrome, Edge Chromium, etc.). Please switch to a supported browser.',
        );
        toggleButtons(true);
    }
}

window.onload = checkBrowserSupport;

async function startCapture(constraints) {
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        videoElement.srcObject = stream;
        return stream;
    } catch (err) {
        console.error('Error accessing media devices.', err);
        showError('Error accessing media devices. Please check your camera and microphone permissions.');
    }
}

async function startScreenCapture(constraints) {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
        videoElement.srcObject = stream;
        return stream;
    } catch (err) {
        console.error('Error accessing screen media.', err);
        showError('Error accessing screen sharing. Please try again or check your screen sharing permissions.');
    }
}

async function initRTMP() {
    const apiSecret = apiSecretInput.value;
    socket.emit('initRTMP', { apiSecret });
}

async function streamRTMP(data) {
    const apiSecret = apiSecretInput.value;

    const arrayBuffer = await data.arrayBuffer();
    const chunkSize = 1000000; // 1mb
    const totalChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const chunk = arrayBuffer.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize);
        socket.emit('streamRTMP', { apiSecret: apiSecret, rtmpStreamKey: rtmpKey, data: chunk });
    }
}

async function stopRTMP() {
    if (mediaRecorder) {
        const apiSecret = apiSecretInput.value;
        mediaRecorder.stop();
        socket.emit('stopRTMP', { apiSecret: apiSecret, rtmpStreamKey: rtmpKey });
    }
    videoElement.srcObject = null;
    rtmpInput.value = '';
    toggleButtons(false);
    stopButton.disabled = true;
}

async function startStreaming(stream) {
    if (!stream) return;

    try {
        socket = io({ transports: ['websocket'] });

        socket.on('connect', () => {
            console.log('Connected to server');
            initRTMP();
        });

        socket.on('initRTMP', (data) => {
            console.log('initRTMP', data);
            const { rtmp, rtmpStreamKey } = data;
            rtmpInput.value = rtmp;
            rtmpKey = rtmpStreamKey;
            toggleButtons(true);
            stopButton.disabled = false;
            startMediaRecorder(stream);
        });

        socket.on('stopRTMP', () => {
            console.log('RTMP stopped successfully!');
        });

        socket.on('error', (error) => {
            console.error('Error:', error);
            showError(error);
            stopRTMP();
        });

        socket.on('disconnect', () => {
            console.log('Disconnected from server');
            stopRTMP();
        });
    } catch (error) {
        showPopup('Error start Streaming: ' + error.message, 'error');
        console.error('Error start Streaming', error);
        stopRTMP();
    }
}

async function startMediaRecorder(stream) {
    if (!stream) return;

    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp8,opus' });

    mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
            await streamRTMP(event.data);
        }
    };

    mediaRecorder.onstop = (event) => {
        console.log('Media recorder stopped');
        stopTracks(stream);
    };

    mediaRecorder.start(chunkDuration); // Record in chunks of the specified duration
}

function stopTracks(stream) {
    stream.getTracks().forEach((track) => {
        track.stop();
    });
}

async function startCameraStreaming() {
    const stream = await startCapture({ video: true, audio: true });
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

window.addEventListener('beforeunload', async () => {
    if (mediaRecorder) {
        await stopRTMP();
    }
});

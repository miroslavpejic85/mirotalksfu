let isWebkitSpeechRecognitionSupported = false;
let recognition;

if ('webkitSpeechRecognition' in window) {
    recognition = new webkitSpeechRecognition();

    recognition.maxAlternatives = 1;
    recognition.continuous = true;

    recognition.onstart = function () {
        console.log('Start speech recognition');
        hide(chatSpeechStartButton);
        show(chatSpeechStopButton);
    };

    recognition.onresult = (e) => {
        let current = e.resultIndex;
        let transcript = e.results[current][0].transcript;
        chatMessage.value = transcript;
    };

    recognition.onerror = function (event) {
        console.warn('Speech recognition error', event.error);
    };

    recognition.onend = function () {
        console.log('Stop speech recognition');
        show(chatSpeechStartButton);
        hide(chatSpeechStopButton);
    };

    isWebkitSpeechRecognitionSupported = true;
    console.info('Browser supports webkitSpeechRecognition');
} else {
    console.warn('This browser not supports webkitSpeechRecognition');
}

function startSpeech(action) {
    if (action) {
        recognition.start();
    } else {
        recognition.stop();
    }
}

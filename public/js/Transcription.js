'use strict';

class Transcription {
    constructor() {
        this.languages = [
            ['Afrikaans', ['af-ZA']],
            ['Bahasa Indonesia', ['id-ID']],
            ['Bahasa Melayu', ['ms-MY']],
            ['Català', ['ca-ES']],
            ['Čeština', ['cs-CZ']],
            ['Deutsch', ['de-DE']],
            [
                'English',
                ['en-AU', 'Australia'],
                ['en-CA', 'Canada'],
                ['en-IN', 'India'],
                ['en-NZ', 'New Zealand'],
                ['en-ZA', 'South Africa'],
                ['en-GB', 'United Kingdom'],
                ['en-US', 'United States'],
                ['en-NG', 'Nigeria'],
                ['en-GH', 'Ghana'],
                ['en-KE', 'Kenya'],
            ],
            [
                'Español',
                ['es-AR', 'Argentina'],
                ['es-BO', 'Bolivia'],
                ['es-CL', 'Chile'],
                ['es-CO', 'Colombia'],
                ['es-CR', 'Costa Rica'],
                ['es-EC', 'Ecuador'],
                ['es-SV', 'El Salvador'],
                ['es-ES', 'España'],
                ['es-US', 'Estados Unidos'],
                ['es-GT', 'Guatemala'],
                ['es-HN', 'Honduras'],
                ['es-MX', 'México'],
                ['es-NI', 'Nicaragua'],
                ['es-PA', 'Panamá'],
                ['es-PY', 'Paraguay'],
                ['es-PE', 'Perú'],
                ['es-PR', 'Puerto Rico'],
                ['es-DO', 'República Dominicana'],
                ['es-UY', 'Uruguay'],
                ['es-VE', 'Venezuela'],
            ],
            ['Euskara', ['eu-ES']],
            ['Français', ['fr-FR']],
            ['Galego', ['gl-ES']],
            ['Hrvatski', ['hr_HR']],
            ['IsiZulu', ['zu-ZA']],
            ['Íslenska', ['is-IS']],
            ['Italiano', ['it-IT', 'Italia'], ['it-CH', 'Svizzera']],
            ['Magyar', ['hu-HU']],
            ['Nederlands', ['nl-NL']],
            ['Norsk bokmål', ['nb-NO']],
            ['Polski', ['pl-PL']],
            ['Português', ['pt-BR', 'Brasil'], ['pt-PT', 'Portugal']],
            ['Română', ['ro-RO']],
            ['Slovenčina', ['sk-SK']],
            ['Suomi', ['fi-FI']],
            ['Svenska', ['sv-SE']],
            ['Türkçe', ['tr-TR']],
            ['български', ['bg-BG']],
            ['Pусский', ['ru-RU']],
            ['Српски', ['sr-RS']],
            ['한국어', ['ko-KR']],
            [
                '中文',
                ['cmn-Hans-CN', '普通话 (中国大陆)'],
                ['cmn-Hans-HK', '普通话 (香港)'],
                ['cmn-Hant-TW', '中文 (台灣)'],
                ['yue-Hant-HK', '粵語 (香港)'],
            ],
            ['日本語', ['ja-JP']],
            ['Lingua latīna', ['la']],
        ];
        this.speechTranscription = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.isTranscriptionSupported = false;
        this.transcriptionRunning = false;
        this.transcription;
        this.transcripts = [];
        this.isBgTransparent = false;
        this.isPinned = false;
        this.isHidden = true;
        this.isPersistentMode = true; // Prevent stopping due to extended periods of silence
        this.isPersistent = false;
        this.showOnMessage = true;
    }

    isSupported() {
        return Boolean(this.speechTranscription);
    }

    init() {
        if (this.isSupported()) {
            this.handleLanguages();

            this.transcription = new this.speechTranscription();
            this.transcription.maxAlternatives = 1;
            this.transcription.continuous = true;
            this.transcription.lang = transcriptionDialect.value;

            this.transcription.onstart = function () {
                console.log('Transcription started');
                hide(transcriptionSpeechStart);
                show(transcriptionSpeechStop);
                setColor(transcriptionSpeechStatus, 'lime');
                !transcription.isPersistentMode
                    ? userLog('info', 'Transcription started', 'top-end')
                    : (transcription.isPersistent = true);
            };

            this.transcription.onresult = (e) => {
                const current = e.resultIndex;
                const transcript = e.results[current][0].transcript;
                const transcriptionData = {
                    type: 'transcript',
                    room_id: room_id,
                    peer_name: peer_name,
                    text_data: transcript,
                    time_stamp: new Date(),
                    broadcast: true,
                };
                if (transcript) {
                    this.sendTranscript(transcriptionData);
                    this.handleTranscript(transcriptionData);
                }
            };

            this.transcription.onaudiostart = () => {
                console.log('Transcription start to capture your voice');
            };

            this.transcription.onaudioend = () => {
                console.log('Transcription stop to capture your voice');
            };

            this.transcription.onerror = function (event) {
                console.error('Transcription error', event.error);
                if (!transcription.isPersistent || !transcription.isPersistentMode)
                    userLog('error', `Transcription error ${event.error}`, 'top-end', 6000);
            };

            this.transcription.onend = function () {
                console.log('Transcription stopped');
                hide(transcriptionSpeechStop);
                show(transcriptionSpeechStart);
                setColor(transcriptionSpeechStatus, 'white');
                // Prevent stopping in the absence of speech...
                if (
                    transcription.isPersistentMode &&
                    transcription.isPersistent &&
                    transcription.transcriptionRunning
                ) {
                    setTimeout(() => {
                        transcription.start();
                    }, 2000);
                } else {
                    transcription.isPersistent = false;
                    userLog('info', 'Transcription stopped', 'top-end');
                }
            };

            this.isTranscriptionSupported = true;
            console.info('This Browser support Transcription');
        } else {
            console.warn(
                'This browser not support Transcription, check out supported browsers: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API#browser_compatibility',
            );
        }
    }

    sendTranscript(transcriptionData) {
        if (rc.thereAreParticipants()) {
            //console.log('TRANSCRIPTION SEND', transcriptionData);
            rc.emitCmd(transcriptionData);
        }
    }

    handleTranscript(transcriptionData) {
        console.log('TRANSCRIPTION TEXT', transcriptionData.text_data);

        transcriptionData.text_data = filterXSS(transcriptionData.text_data);
        transcriptionData.peer_name = filterXSS(transcriptionData.peer_name);

        const { peer_name, text_data } = transcriptionData;
        const time_stamp = rc.getTimeNow();
        const avatar_image = rc.isValidEmail(peer_name) ? rc.genGravatar(peer_name) : rc.genAvatarSvg(peer_name, 32);

        if (this.isHidden) {
            if (this.showOnMessage) {
                this.toggle();
            } else {
                this.handleTranscriptionPopup(transcriptionData);
            }
        }

        const msgHTML = `
        <div class="msg-transcription left-msg-transcription">
            <img class="msg-transcription-img" src="${avatar_image}" />
            <div class="msg-transcription-bubble">
                <div class="msg-transcription-info">
                    <div class="msg-transcription-info-name">${peer_name} : ${time_stamp}</div>
                </div>
                <div class="msg-transcription-text">${text_data}</div>
            </div>
        </div>
        `;
        transcriptionChat.insertAdjacentHTML('beforeend', msgHTML);
        transcriptionChat.scrollTop += 500;

        this.transcripts.push({
            time: time_stamp,
            name: peer_name,
            caption: text_data,
        });
        rc.sound('transcript');
    }

    handleTranscriptionPopup(transcriptionData, duration = 5000) {
        const transcriptionDisplay = document.createElement('div');
        transcriptionDisplay.className = 'animate__animated animate__fadeInUp';
        transcriptionDisplay.style.padding = '10px';
        transcriptionDisplay.style.fontSize = '1rem';
        transcriptionDisplay.style.color = '#FFF';
        transcriptionDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        transcriptionDisplay.style.borderRadius = '10px';
        transcriptionDisplay.innerText = `${transcriptionData.peer_name}: ${transcriptionData.text_data}`;
        transcriptionPopup.appendChild(transcriptionDisplay);
        setTimeout(() => {
            transcriptionDisplay.remove();
        }, duration);
    }

    toggle() {
        if (this.isHidden) {
            this.center();
            transcriptionRoom.style.display = 'block';
            rc.sound('open');
        } else {
            transcriptionRoom.style.display = 'none';
        }
        this.isHidden = !this.isHidden;

        if (this.isPinned) this.unpinned();

        if (!rc.isMobileDevice && !this.isHidden && rc.canBePinned()) {
            this.togglePinUnpin();
        }

        resizeTranscriptionRoom();
    }

    toggleBg() {
        this.isBgTransparent = !this.isBgTransparent;
        this.isBgTransparent
            ? document.documentElement.style.setProperty('--trx-bg', 'rgba(0, 0, 0, 0.100)')
            : setTheme();
    }

    maximize() {
        hide(transcriptionMaxBtn);
        show(transcriptionMinBtn);
        this.center();
        document.documentElement.style.setProperty('--transcription-width', '100%');
        document.documentElement.style.setProperty('--transcription-height', '100%');
    }

    minimize() {
        hide(transcriptionMinBtn);
        show(transcriptionMaxBtn);
        if (this.isPinned) {
            this.pinned();
        } else {
            this.center();
            document.documentElement.style.setProperty('--transcription-width', '420px');
            document.documentElement.style.setProperty('--transcription-height', '680px');
        }
    }

    center() {
        transcriptionRoom.style.position = 'fixed';
        transcriptionRoom.style.transform = 'translate(-50%, -50%)';
        transcriptionRoom.style.top = '50%';
        transcriptionRoom.style.left = '50%';
    }

    togglePinUnpin() {
        if (rc.isChatPinned) {
            return userLog('info', 'Please unpin the chat that appears to be currently pinned', 'top-end');
        }
        if (rc.isEditorPinned) {
            return userLog('info', 'Please unpin the editor that appears to be currently pinned', 'top-end');
        }
        this.isPinned ? this.unpinned() : this.pinned();
        rc.sound('click');
    }

    isPin() {
        return this.isPinned;
    }

    pinned() {
        if (!rc.isVideoPinned) {
            rc.videoMediaContainer.style.top = 0;
            rc.videoMediaContainer.style.width = '75%';
            rc.videoMediaContainer.style.height = '100%';
        }
        this.pin();
        this.isPinned = true;
        setColor(transcriptionTogglePinBtn, 'lime');
        resizeVideoMedia();
        transcriptionRoom.style.resize = 'none';
        if (!rc.isMobileDevice) rc.makeUnDraggable(transcriptionRoom, transcriptionHeader);
    }

    pin() {
        transcriptionRoom.style.position = 'absolute';
        transcriptionRoom.style.top = 0;
        transcriptionRoom.style.right = 0;
        transcriptionRoom.style.left = null;
        transcriptionRoom.style.transform = null;
        document.documentElement.style.setProperty('--transcription-width', '25%');
        document.documentElement.style.setProperty('--transcription-height', '100%');
        rc.resizeVideoMenuBar();
    }

    unpinned() {
        if (!rc.isVideoPinned) {
            rc.videoMediaContainer.style.top = 0;
            rc.videoMediaContainer.style.right = null;
            rc.videoMediaContainer.style.width = '100%';
            rc.videoMediaContainer.style.height = '100%';
        }
        document.documentElement.style.setProperty('--transcription-width', '420px');
        document.documentElement.style.setProperty('--transcription-height', '680px');
        hide(transcriptionMinBtn);
        show(transcriptionMaxBtn);
        this.center();
        this.isPinned = false;
        setColor(transcriptionTogglePinBtn, 'white');
        rc.resizeVideoMenuBar();
        resizeVideoMedia();
        resizeTranscriptionRoom();
        transcriptionRoom.style.resize = 'both';
        if (!rc.isMobileDevice) rc.makeDraggable(transcriptionRoom, transcriptionHeader);
    }

    save() {
        if (this.transcripts.length != 0) {
            const a = document.createElement('a');
            a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.transcripts, null, 1));
            a.download = getDataTimeString() + room_id + '-TRANSCRIPTIONS.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            rc.sound('download');
        } else {
            userLog('info', "There isn't transcriptions to save", 'top-end');
        }
    }

    delete() {
        if (this.transcripts.length != 0) {
            Swal.fire({
                background: swalBackground,
                position: 'center',
                title: 'Clean up all transcripts?',
                imageUrl: image.delete,
                showDenyButton: true,
                confirmButtonText: `Yes`,
                denyButtonText: `No`,
                showClass: { popup: 'animate__animated animate__fadeInDown' },
                hideClass: { popup: 'animate__animated animate__fadeOutUp' },
            }).then((result) => {
                if (result.isConfirmed) {
                    let captions = transcriptionChat.firstChild;
                    while (captions) {
                        transcriptionChat.removeChild(captions);
                        captions = transcriptionChat.firstChild;
                    }
                    this.transcripts = [];
                    rc.sound('delete');
                }
            });
        } else {
            userLog('info', "There isn't transcriptions to delete", 'top-end');
        }
    }

    updateCountry() {
        for (let i = transcriptionDialect.options.length - 1; i >= 0; i--) {
            transcriptionDialect.remove(i);
        }
        let list = this.languages[transcriptionLanguage.selectedIndex];
        for (let i = 1; i < list.length; i++) {
            transcriptionDialect.options.add(new Option(list[i][1], list[i][0]));
        }
        transcriptionDialect.style.visibility = list[1].length == 1 ? 'hidden' : 'visible';
    }

    handleLanguages() {
        for (let i = 0; i < this.languages.length; i++) {
            transcriptionLanguage.options[i] = new Option(this.languages[i][0], i);
        }

        transcriptionLanguage.selectedIndex = 6;
        this.updateCountry();

        transcriptionDialect.selectedIndex = 6;
        transcriptionLanguage.onchange = () => {
            this.updateCountry();
        };
    }

    handleTranscriptionAll(cmd) {
        const { peer_name, transcriptionLanguageIndex, transcriptionDialectIndex } = cmd.data;

        if (!this.speechTranscription) {
            hide(transcriptionFooter);
            rc.msgPopup(
                'info',
                `${peer_name} wants to start transcriptions for this session, but your browser does not support it. Please use a Chromium-based browser like Google Chrome, Microsoft Edge, or Brave.`,
            );
            return;
        }

        if (this.transcriptionRunning || !BUTTONS.main.transcriptionButton) return;

        Swal.fire({
            allowOutsideClick: false,
            allowEscapeKey: false,
            showDenyButton: true,
            background: swalBackground,
            position: 'center',
            imageUrl: image.transcription,
            title: 'Start Transcription',
            text: `${peer_name} wants to start the transcriptions for this session. Would you like to enable them?`,
            confirmButtonText: `Yes`,
            denyButtonText: `No`,
            showClass: { popup: 'animate__animated animate__fadeInDown' },
            hideClass: { popup: 'animate__animated animate__fadeOutUp' },
        }).then((result) => {
            if (result.isConfirmed) {
                if (this.isHidden) {
                    this.toggle();
                }
                if (!this.transcriptionRunning) {
                    transcriptionLanguage.selectedIndex = transcriptionLanguageIndex;
                    this.updateCountry();
                    transcriptionDialect.selectedIndex = transcriptionDialectIndex;
                    transcription.start();
                }
            }
        });
    }

    startAll() {
        if (!this.transcriptionRunning) {
            transcription.start();
        }
        rc.emitCmd({
            type: 'transcriptionAll',
            broadcast: true,
            data: {
                peer_id: rc.peer_id,
                peer_name: rc.peer_name,
                transcriptionLanguageIndex: transcriptionLanguage.selectedIndex,
                transcriptionDialectIndex: transcriptionDialect.selectedIndex,
            },
        });
    }

    start() {
        try {
            this.transcriptionRunning = true;
            this.transcription.lang = transcriptionDialect.value;
            this.selectDisabled(true);
            this.transcription.start();
        } catch (error) {
            this.transcriptionRunning = false;
            userLog('error', `Transcription start error ${error.message}`, 'top-end', 6000);
            console.error('Transcription start error', error);
        }
    }

    stop() {
        this.transcriptionRunning = false;
        this.isPersistent = false;
        this.selectDisabled(false);
        this.transcription.stop();
    }

    selectDisabled(disabled = false) {
        transcriptionLanguage.disabled = disabled;
        transcriptionDialect.disabled = disabled;
    }
}

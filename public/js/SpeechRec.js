'use strict';

let recognition;
let isVoiceCommandsEnabled = true;
let currentLanguage = 'en';
let currentLangCode = 'en-US';

const browserLanguage = navigator.language || navigator.userLanguage;

const isVoiceCommandSupported =
    browserLanguage.includes('en-') ||
    browserLanguage.includes('bn-') ||
    browserLanguage.includes('es-') ||
    browserLanguage.includes('fr-') ||
    browserLanguage.includes('it-') ||
    browserLanguage.includes('de-') ||
    browserLanguage.includes('ja-') ||
    browserLanguage.includes('pt-') ||
    browserLanguage.includes('zh-') ||
    browserLanguage.includes('ar-');

const speechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

/**
 * Enable real-time voice recognition in the chat, allowing you to execute commands using your voice.
 * const supportedLanguages = ['en', 'bn', 'es', 'fr', 'it', 'de', 'ja', 'pt', 'zh', 'ar'];
 */
const languageHandlers = {
    en: {
        langCode: 'en-US',
        commands: {
            shareRoom: 'room',
            hideMe: 'hide me',
            showMe: 'show me',
            newRoom: 'new room',
            leaveRoom: 'exit the room',
            audioOn: 'start the audio',
            audioOff: 'stop the audio',
            videoOn: 'start the video',
            videoOff: 'stop the video',
            screenOn: 'start the screen',
            screenOff: 'stop the screen',
            chatOn: 'open the chat',
            chatSend: 'send',
            chatOff: 'close the chat',
            pollOn: 'open the poll',
            pollOff: 'close the poll',
            editorOn: 'open the editor',
            editorOff: 'close the editor',
            toggleTr: 'toggle transcription',
            whiteboardOn: 'open the whiteboard',
            whiteboardOff: 'close the whiteboard',
            snapshotRoom: 'Snapshot room',
            recordingOn: 'start the recording',
            recordingPause: 'pause the recording',
            recordingResume: 'resume the recording',
            recordingOff: 'stop the recording',
            settingsOn: 'open the settings',
            settingsOff: 'close the settings',
            participantsOn: 'show the participants',
            participantsOff: 'hide the participants',
            participantsVideoOff: 'stop the participants video',
            participantsAudioOff: 'stop the participants audio',
            participantsKickOut: 'kick out the participants',
            fileShareOn: 'open a file',
            fileShareOff: 'close a file',
            videoShareOn: 'share the video',
            videoShareOff: 'close the video',
            swapCamera: 'swap the camera',
            raiseHand: 'raise the hand',
            lowerHand: 'lower the hand',
            roomLock: 'lock the room',
            roomUnlock: 'unlock the room',
            about: 'show the about',
            email: 'open email',
            google: 'open google',
            googleTr: 'open google translate',
            youtube: 'open youtube',
            facebook: 'open facebook',
            linkedin: 'open linkedin',
            twitter: 'open twitter',
            tiktok: 'open tiktok',
            github: 'open github',
            survey: 'open survey',
            recognizeBangla: 'recognize bangla',
            recognizeItalian: 'recognize italian',
            recognizeSpanish: 'recognize spanish',
            recognizeFrench: 'recognize french',
            recognizeGerman: 'recognize german',
            recognizeJapanese: 'recognize japanese',
            recognizePortuguese: 'recognize portuguese',
            recognizeChinese: 'recognize chinese',
            recognizeArabic: 'recognize arabic',
            stopRecognition: 'stop the voice recognition',
        },
    },
    bn: {
        langCode: 'bn-BD',
        commands: {
            shareRoom: 'রুম শেয়ার করো',
            hideMe: 'আমাকে লুকাও',
            showMe: 'আমাকে দেখাও',
            newRoom: 'নতুন রুম',
            leaveRoom: 'রুম থেকে বের হও',
            audioOn: 'অডিও চালু করো',
            audioOff: 'অডিও বন্ধ করো',
            videoOn: 'ভিডিও চালু করো',
            videoOff: 'ভিডিও বন্ধ করো',
            screenOn: 'স্ক্রিন চালু করো',
            screenOff: 'স্ক্রিন বন্ধ করো',
            chatOn: 'চ্যাট খুলো',
            chatSend: 'পাঠাও',
            chatOff: 'চ্যাট বন্ধ করো',
            pollOn: 'পোল খুলো',
            pollOff: 'পোল বন্ধ করো',
            editorOn: 'এডিটর খুলো',
            editorOff: 'এডিটর বন্ধ করো',
            toggleTr: 'ট্রান্সক্রিপশন চালু/বন্ধ করো',
            whiteboardOn: 'হোয়াইটবোর্ড খুলো',
            whiteboardOff: 'হোয়াইটবোর্ড বন্ধ করো',
            snapshotRoom: 'রুমের ছবি তুলো',
            recordingOn: 'রেকর্ডিং শুরু করো',
            recordingPause: 'রেকর্ডিং বিরতি দাও',
            recordingResume: 'রেকর্ডিং আবার শুরু করো',
            recordingOff: 'রেকর্ডিং বন্ধ করো',
            settingsOn: 'সেটিংস খুলো',
            settingsOff: 'সেটিংস বন্ধ করো',
            participantsOn: 'অংশগ্রহণকারীদের দেখাও',
            participantsOff: 'অংশগ্রহণকারীদের লুকাও',
            participantsVideoOff: 'অংশগ্রহণকারীদের ভিডিও বন্ধ করো',
            participantsAudioOff: 'অংশগ্রহণকারীদের অডিও বন্ধ করো',
            participantsKickOut: 'অংশগ্রহণকারীদের বের করে দাও',
            fileShareOn: 'ফাইল খুলো',
            fileShareOff: 'ফাইল বন্ধ করো',
            videoShareOn: 'ভিডিও শেয়ার করো',
            videoShareOff: 'ভিডিও বন্ধ করো',
            swapCamera: 'ক্যামেরা পরিবর্তন করো',
            raiseHand: 'হাত তুলো',
            lowerHand: 'হাত নামাও',
            roomLock: 'রুম লক করো',
            roomUnlock: 'রুম আনলক করো',
            about: 'সম্পর্কিত দেখাও',
            email: 'ইমেইল খুলো',
            google: 'গুগল খুলো',
            googleTr: 'গুগল অনুবাদ খুলো',
            youtube: 'ইউটিউব খুলো',
            facebook: 'ফেসবুক খুলো',
            linkedin: 'লিঙ্কডইন খুলো',
            twitter: 'টুইটার খুলো',
            tiktok: 'টিকটক খুলো',
            github: 'গিটহাব খুলো',
            survey: 'সার্ভে খুলো',
            recognizeEnglish: 'ইংরেজিতে করো',
            recognizeItalian: 'ইতালীয় চেনা',
            recognizeSpanish: 'স্পেনীয় চেনা',
            recognizeFrench: 'ফরাসি চেনা',
            recognizeGerman: 'জার্মান চেনা',
            recognizeJapanese: 'জাপানি চেনা',
            recognizePortuguese: 'পর্তুগিজ চেনা',
            recognizeChinese: 'চীনা চেনা',
            recognizeArabic: 'আরবি চেনা',
            stopRecognition: 'ভয়েস রিকগনিশন বন্ধ করো',
        },
    },
    es: {
        langCode: 'es-ES',
        commands: {
            shareRoom: 'compartir sala',
            hideMe: 'esconderme',
            showMe: 'muéstrame',
            newRoom: 'nueva sala',
            leaveRoom: 'salir de la sala',
            audioOn: 'activar audio',
            audioOff: 'desactivar audio',
            videoOn: 'activar video',
            videoOff: 'desactivar video',
            screenOn: 'activar pantalla',
            screenOff: 'desactivar pantalla',
            chatOn: 'abrir chat',
            chatSend: 'enviar',
            chatOff: 'cerrar chat',
            pollOn: 'abrir encuesta',
            pollOff: 'cerrar encuesta',
            editorOn: 'abrir editor',
            editorOff: 'cerrar editor',
            toggleTr: 'alternar transcripción',
            whiteboardOn: 'abrir pizarra',
            whiteboardOff: 'cerrar pizarra',
            snapshotRoom: 'capturar sala',
            recordingOn: 'comenzar grabación',
            recordingPause: 'pausar grabación',
            recordingResume: 'reanudar grabación',
            recordingOff: 'detener grabación',
            settingsOn: 'abrir configuraciones',
            settingsOff: 'cerrar configuraciones',
            participantsOn: 'mostrar participantes',
            participantsOff: 'ocultar participantes',
            participantsVideoOff: 'desactivar video de participantes',
            participantsAudioOff: 'desactivar audio de participantes',
            participantsKickOut: 'expulsar participantes',
            fileShareOn: 'abrir archivo',
            fileShareOff: 'cerrar archivo',
            videoShareOn: 'compartir video',
            videoShareOff: 'dejar de compartir video',
            swapCamera: 'cambiar cámara',
            raiseHand: 'levantar la mano',
            lowerHand: 'bajar la mano',
            roomLock: 'bloquear la sala',
            roomUnlock: 'desbloquear la sala',
            about: 'mostrar información',
            email: 'abrir correo',
            google: 'abrir google',
            googleTr: 'abrir google translate',
            youtube: 'abrir youtube',
            facebook: 'abrir facebook',
            linkedin: 'abrir linkedin',
            twitter: 'abrir twitter',
            tiktok: 'abrir tiktok',
            github: 'abrir github',
            survey: 'abrir encuesta',
            recognizeEnglish: 'reconocer inglés',
            recognizeBangla: 'reconocer bengalí',
            recognizeItalian: 'reconocer italiano',
            recognizeSpanish: 'reconocer español',
            recognizeFrench: 'reconocer francés',
            recognizeGerman: 'reconocer alemán',
            recognizeJapanese: 'reconocer japonés',
            recognizePortuguese: 'reconocer portugués',
            recognizeChinese: 'reconocer chino',
            recognizeArabic: 'reconocer árabe',
            stopRecognition: 'detener el reconocimiento de voz',
        },
    },
    fr: {
        langCode: 'fr-FR',
        commands: {
            shareRoom: 'partager la salle',
            hideMe: 'cachez-moi',
            showMe: 'montrez-moi',
            newRoom: 'nouvelle salle',
            leaveRoom: 'quitter la salle',
            audioOn: "activer l'audio",
            audioOff: "désactiver l'audio",
            videoOn: 'activer la vidéo',
            videoOff: 'désactiver la vidéo',
            screenOn: "activer l'écran",
            screenOff: "désactiver l'écran",
            chatOn: 'ouvrir le chat',
            chatSend: 'envoyer',
            chatOff: 'fermer le chat',
            pollOn: 'ouvrir le sondage',
            pollOff: 'fermer le sondage',
            editorOn: "ouvrir l'éditeur",
            editorOff: "fermer l'éditeur",
            toggleTr: 'basculer la transcription',
            whiteboardOn: 'ouvrir le tableau blanc',
            whiteboardOff: 'fermer le tableau blanc',
            snapshotRoom: 'prendre une capture de la salle',
            recordingOn: "commencer l'enregistrement",
            recordingPause: "mettre en pause l'enregistrement",
            recordingResume: "reprendre l'enregistrement",
            recordingOff: "arrêter l'enregistrement",
            settingsOn: 'ouvrir les paramètres',
            settingsOff: 'fermer les paramètres',
            participantsOn: 'afficher les participants',
            participantsOff: 'masquer les participants',
            participantsVideoOff: 'désactiver la vidéo des participants',
            participantsAudioOff: "désactiver l'audio des participants",
            participantsKickOut: 'expulser les participants',
            fileShareOn: 'ouvrir le fichier',
            fileShareOff: 'fermer le fichier',
            videoShareOn: 'partager la vidéo',
            videoShareOff: 'arrêter le partage de la vidéo',
            swapCamera: 'changer de caméra',
            raiseHand: 'lever la main',
            lowerHand: 'baisser la main',
            roomLock: 'verrouiller la salle',
            roomUnlock: 'déverrouiller la salle',
            about: 'montrer à propos',
            email: 'ouvrir email',
            google: 'ouvrir google',
            googleTr: 'ouvrir google translate',
            youtube: 'ouvrir youtube',
            facebook: 'ouvrir facebook',
            linkedin: 'ouvrir linkedin',
            twitter: 'ouvrir twitter',
            tiktok: 'ouvrir tiktok',
            github: 'ouvrir github',
            survey: 'ouvrir enquête',
            recognizeEnglish: 'reconnaître anglais',
            recognizeBangla: 'reconnaître bengali',
            recognizeItalian: 'reconnaître italien',
            recognizeSpanish: 'reconnaître espagnol',
            recognizeFrench: 'reconnaître français',
            recognizeGerman: 'reconnaître allemand',
            recognizeJapanese: 'reconnaître japonais',
            recognizePortuguese: 'reconnaître portugais',
            recognizeChinese: 'reconnaître chinois',
            recognizeArabic: 'reconnaître arabe',
            stopRecognition: 'arrêter la reconnaissance vocale',
        },
    },
    it: {
        langCode: 'it-IT',
        commands: {
            shareRoom: 'condividi sala',
            hideMe: 'nascondimi',
            showMe: 'fammi vedere',
            newRoom: 'nuova sala',
            leaveRoom: 'esci dalla sala',
            audioOn: 'attiva audio',
            audioOff: 'disattiva audio',
            videoOn: 'attiva video',
            videoOff: 'disattiva video',
            screenOn: 'attiva schermo',
            screenOff: 'disattiva schermo',
            chatOn: 'apri chat',
            chatSend: 'invia',
            chatOff: 'chiudi chat',
            pollOn: 'apri sondaggio',
            pollOff: 'chiudi sondaggio',
            editorOn: 'apri editor',
            editorOff: 'chiudi editor',
            toggleTr: 'attiva/disattiva trascrizione',
            whiteboardOn: 'apri lavagna',
            whiteboardOff: 'chiudi lavagna',
            snapshotRoom: 'scatta foto della sala',
            recordingOn: 'avvia registrazione',
            recordingPause: 'metti in pausa registrazione',
            recordingResume: 'riprendi registrazione',
            recordingOff: 'ferma registrazione',
            settingsOn: 'apri impostazioni',
            settingsOff: 'chiudi impostazioni',
            participantsOn: 'mostra partecipanti',
            participantsOff: 'nascondi partecipanti',
            participantsVideoOff: 'disattiva video partecipanti',
            participantsAudioOff: 'disattiva audio partecipanti',
            participantsKickOut: 'espelli partecipanti',
            fileShareOn: 'apri file',
            fileShareOff: 'chiudi file',
            videoShareOn: 'condividi video',
            videoShareOff: 'interrompi condivisione video',
            swapCamera: 'cambia fotocamera',
            raiseHand: 'alza mano',
            lowerHand: 'abbassa mano',
            roomLock: 'blocca sala',
            roomUnlock: 'sblocca sala',
            about: 'mostra informazioni',
            email: 'apri email',
            google: 'apri google',
            googleTr: 'apri google translate',
            youtube: 'apri youtube',
            facebook: 'apri facebook',
            linkedin: 'apri linkedin',
            twitter: 'apri twitter',
            tiktok: 'apri tiktok',
            github: 'apri github',
            survey: 'apri sondaggio',
            recognizeEnglish: 'riconoscere inglese',
            recognizeBangla: 'riconoscere bengalese',
            recognizeItalian: 'riconoscere italiano',
            recognizeSpanish: 'riconoscere spagnolo',
            recognizeFrench: 'riconoscere francese',
            recognizeGerman: 'riconoscere tedesco',
            recognizeJapanese: 'riconoscere giapponese',
            recognizePortuguese: 'riconoscere portoghese',
            recognizeChinese: 'riconoscere cinese',
            recognizeArabic: 'riconoscere arabo',
            stopRecognition: 'ferma riconoscimento vocale',
        },
    },
    de: {
        langCode: 'de-DE',
        commands: {
            shareRoom: 'Raum teilen',
            hideMe: 'verstecke mich',
            showMe: 'zeige mich',
            newRoom: 'neuer Raum',
            leaveRoom: 'Raum verlassen',
            audioOn: 'Audio aktivieren',
            audioOff: 'Audio deaktivieren',
            videoOn: 'Video aktivieren',
            videoOff: 'Video deaktivieren',
            screenOn: 'Bildschirm aktivieren',
            screenOff: 'Bildschirm deaktivieren',
            chatOn: 'Chat öffnen',
            chatSend: 'senden',
            chatOff: 'Chat schließen',
            pollOn: 'Umfrage öffnen',
            pollOff: 'Umfrage schließen',
            editorOn: 'Editor öffnen',
            editorOff: 'Editor schließen',
            toggleTr: 'Transkription umschalten',
            whiteboardOn: 'Whiteboard öffnen',
            whiteboardOff: 'Whiteboard schließen',
            snapshotRoom: 'Raum schnappen',
            recordingOn: 'Aufnahme starten',
            recordingPause: 'Aufnahme pausieren',
            recordingResume: 'Aufnahme fortsetzen',
            recordingOff: 'Aufnahme stoppen',
            settingsOn: 'Einstellungen öffnen',
            settingsOff: 'Einstellungen schließen',
            participantsOn: 'Teilnehmer anzeigen',
            participantsOff: 'Teilnehmer verstecken',
            participantsVideoOff: 'Teilnehmer Video deaktivieren',
            participantsAudioOff: 'Teilnehmer Audio deaktivieren',
            participantsKickOut: 'Teilnehmer rauswerfen',
            fileShareOn: 'Datei öffnen',
            fileShareOff: 'Datei schließen',
            videoShareOn: 'Video teilen',
            videoShareOff: 'Video teilen stoppen',
            swapCamera: 'Kamera wechseln',
            raiseHand: 'Hand heben',
            lowerHand: 'Hand senken',
            roomLock: 'Raum sperren',
            roomUnlock: 'Raum entsperren',
            about: 'Info anzeigen',
            email: 'E-Mail öffnen',
            google: 'Google öffnen',
            googleTr: 'Google Übersetzer öffnen',
            youtube: 'YouTube öffnen',
            facebook: 'Facebook öffnen',
            linkedin: 'LinkedIn öffnen',
            twitter: 'Twitter öffnen',
            tiktok: 'TikTok öffnen',
            github: 'GitHub öffnen',
            survey: 'Umfrage öffnen',
            recognizeEnglish: 'Englisch erkennen',
            recognizeBangla: 'Bangla erkennen',
            recognizeItalian: 'Italienisch erkennen',
            recognizeSpanish: 'Spanisch erkennen',
            recognizeFrench: 'Französisch erkennen',
            recognizeGerman: 'Deutsch erkennen',
            recognizeJapanese: 'Japanisch erkennen',
            recognizePortuguese: 'Portugiesisch erkennen',
            recognizeChinese: 'Chinesisch erkennen',
            recognizeArabic: 'Arabisch erkennen',
            stopRecognition: 'Spracherkennung stoppen',
        },
    },
    pt: {
        langCode: 'pt-BR',
        commands: {
            shareRoom: 'compartilhar sala',
            hideMe: 'me esconda',
            showMe: 'me mostre',
            newRoom: 'nova sala',
            leaveRoom: 'sair da sala',
            audioOn: 'ativar áudio',
            audioOff: 'desativar áudio',
            videoOn: 'ativar vídeo',
            videoOff: 'desativar vídeo',
            screenOn: 'ativar tela',
            screenOff: 'desativar tela',
            chatOn: 'abrir chat',
            chatSend: 'enviar',
            chatOff: 'fechar chat',
            pollOn: 'abrir enquete',
            pollOff: 'fechar enquete',
            editorOn: 'abrir editor',
            editorOff: 'fechar editor',
            toggleTr: 'alternar transcrição',
            whiteboardOn: 'abrir quadro branco',
            whiteboardOff: 'fechar quadro branco',
            snapshotRoom: 'tirar foto da sala',
            recordingOn: 'iniciar gravação',
            recordingPause: 'pausar gravação',
            recordingResume: 'retomar gravação',
            recordingOff: 'parar gravação',
            settingsOn: 'abrir configurações',
            settingsOff: 'fechar configurações',
            participantsOn: 'mostrar participantes',
            participantsOff: 'ocultar participantes',
            participantsVideoOff: 'desativar vídeo dos participantes',
            participantsAudioOff: 'desativar áudio dos participantes',
            participantsKickOut: 'expulsar participantes',
            fileShareOn: 'abrir arquivo',
            fileShareOff: 'fechar arquivo',
            videoShareOn: 'compartilhar vídeo',
            videoShareOff: 'parar de compartilhar vídeo',
            swapCamera: 'trocar câmera',
            raiseHand: 'levantar mão',
            lowerHand: 'abaixar mão',
            roomLock: 'trancar sala',
            roomUnlock: 'destrancar sala',
            about: 'mostrar sobre',
            email: 'abrir e-mail',
            google: 'abrir google',
            googleTr: 'abrir google translate',
            youtube: 'abrir youtube',
            facebook: 'abrir facebook',
            linkedin: 'abrir linkedin',
            twitter: 'abrir twitter',
            tiktok: 'abrir tiktok',
            github: 'abrir github',
            survey: 'abrir pesquisa',
            recognizeEnglish: 'reconhecer inglês',
            recognizeBangla: 'reconhecer bengali',
            recognizeItalian: 'reconhecer italiano',
            recognizeSpanish: 'reconhecer espanhol',
            recognizeFrench: 'reconhecer francês',
            recognizeGerman: 'reconhecer alemão',
            recognizeJapanese: 'reconhecer japonês',
            recognizePortuguese: 'reconhecer português',
            recognizeChinese: 'reconhecer chinês',
            recognizeArabic: 'reconhecer árabe',
            stopRecognition: 'parar reconhecimento de voz',
        },
    },
    ja: {
        langCode: 'ja-JP',
        commands: {
            shareRoom: 'ルームを共有',
            hideMe: '私を隠す',
            showMe: '私を見せる',
            newRoom: '新しいルーム',
            leaveRoom: 'ルームを退出',
            audioOn: 'オーディオを開始',
            audioOff: 'オーディオを停止',
            videoOn: 'ビデオを開始',
            videoOff: 'ビデオを停止',
            screenOn: '画面共有を開始',
            screenOff: '画面共有を停止',
            chatOn: 'チャットを開く',
            chatSend: '送信',
            chatOff: 'チャットを閉じる',
            pollOn: '投票を開く',
            pollOff: '投票を閉じる',
            editorOn: 'エディターを開く',
            editorOff: 'エディターを閉じる',
            toggleTr: '文字起こしを切り替え',
            whiteboardOn: 'ホワイトボードを開く',
            whiteboardOff: 'ホワイトボードを閉じる',
            snapshotRoom: 'ルームのスナップショット',
            recordingOn: '録画を開始',
            recordingPause: '録画を一時停止',
            recordingResume: '録画を再開',
            recordingOff: '録画を停止',
            settingsOn: '設定を開く',
            settingsOff: '設定を閉じる',
            participantsOn: '参加者を表示',
            participantsOff: '参加者を非表示',
            participantsVideoOff: '参加者のビデオを停止',
            participantsAudioOff: '参加者のオーディオを停止',
            participantsKickOut: '参加者を退出させる',
            fileShareOn: 'ファイルを開く',
            fileShareOff: 'ファイルを閉じる',
            videoShareOn: 'ビデオを共有',
            videoShareOff: 'ビデオ共有を停止',
            swapCamera: 'カメラを切り替え',
            raiseHand: '手を上げる',
            lowerHand: '手を下げる',
            roomLock: 'ルームをロック',
            roomUnlock: 'ルームをアンロック',
            about: '情報を表示',
            email: 'メールを開く',
            google: 'Googleを開く',
            googleTr: 'Google翻訳を開く',
            youtube: 'YouTubeを開く',
            facebook: 'Facebookを開く',
            linkedin: 'LinkedInを開く',
            twitter: 'Twitterを開く',
            tiktok: 'TikTokを開く',
            github: 'GitHubを開く',
            survey: 'アンケートを開く',
            recognizeEnglish: '英語に切り替え',
            recognizeBangla: 'ベンガル語に切り替え',
            recognizeItalian: 'イタリア語に切り替え',
            recognizeSpanish: 'スペイン語に切り替え',
            recognizeFrench: 'フランス語に切り替え',
            recognizeGerman: 'ドイツ語に切り替え',
            recognizeJapanese: '日本語に切り替え',
            recognizePortuguese: 'ポルトガル語に切り替え',
            recognizeChinese: '中国語に切り替え',
            recognizeArabic: 'アラビア語に切り替え',
            stopRecognition: '音声認識を停止',
        },
    },
    zh: {
        langCode: 'zh-CN',
        commands: {
            shareRoom: '分享房间',
            hideMe: '隐藏我',
            showMe: '展示我',
            newRoom: '新房间',
            leaveRoom: '离开房间',
            audioOn: '开启音频',
            audioOff: '关闭音频',
            videoOn: '开启视频',
            videoOff: '关闭视频',
            screenOn: '开启屏幕共享',
            screenOff: '关闭屏幕共享',
            chatOn: '打开聊天',
            chatSend: '发送',
            chatOff: '关闭聊天',
            pollOn: '开启投票',
            pollOff: '关闭投票',
            editorOn: '开启编辑器',
            editorOff: '关闭编辑器',
            toggleTr: '切换字幕',
            whiteboardOn: '开启白板',
            whiteboardOff: '关闭白板',
            snapshotRoom: '截取房间截图',
            recordingOn: '开始录制',
            recordingPause: '暂停录制',
            recordingResume: '恢复录制',
            recordingOff: '停止录制',
            settingsOn: '开启设置',
            settingsOff: '关闭设置',
            participantsOn: '显示参与者',
            participantsOff: '隐藏参与者',
            participantsVideoOff: '关闭参与者视频',
            participantsAudioOff: '关闭参与者音频',
            participantsKickOut: '踢出参与者',
            fileShareOn: '开启文件共享',
            fileShareOff: '关闭文件共享',
            videoShareOn: '分享视频',
            videoShareOff: '停止分享视频',
            swapCamera: '切换摄像头',
            raiseHand: '举手',
            lowerHand: '放下手',
            roomLock: '锁定房间',
            roomUnlock: '解锁房间',
            about: '显示关于信息',
            email: '打开电子邮件',
            google: '打开谷歌',
            googleTr: '打开谷歌翻译',
            youtube: '打开YouTube',
            facebook: '打开Facebook',
            linkedin: '打开LinkedIn',
            twitter: '打开Twitter',
            tiktok: '打开TikTok',
            github: '打开GitHub',
            survey: '打开调查',
            recognizeEnglish: '识别英语',
            recognizeBangla: '识别孟加拉语',
            recognizeItalian: '识别意大利语',
            recognizeSpanish: '识别西班牙语',
            recognizeFrench: '识别法语',
            recognizeGerman: '识别德语',
            recognizeJapanese: '识别日语',
            recognizePortuguese: '识别葡萄牙语',
            recognizeChinese: '识别中文',
            recognizeArabic: '识别阿拉伯语',
            stopRecognition: '停止语音识别',
        },
    },
    ar: {
        langCode: 'ar-SA',
        commands: {
            shareRoom: 'مشاركة الغرفة',
            hideMe: 'اخفني',
            showMe: 'أرني',
            newRoom: 'غرفة جديدة',
            leaveRoom: 'مغادرة الغرفة',
            audioOn: 'تشغيل الصوت',
            audioOff: 'إيقاف الصوت',
            videoOn: 'تشغيل الفيديو',
            videoOff: 'إيقاف الفيديو',
            screenOn: 'تشغيل الشاشة',
            screenOff: 'إيقاف الشاشة',
            chatOn: 'فتح الدردشة',
            chatSend: 'إرسال',
            chatOff: 'إغلاق الدردشة',
            pollOn: 'فتح الاستطلاع',
            pollOff: 'إغلاق الاستطلاع',
            editorOn: 'فتح المحرر',
            editorOff: 'إغلاق المحرر',
            toggleTr: 'التبديل بين الترجمة',
            whiteboardOn: 'فتح السبورة',
            whiteboardOff: 'إغلاق السبورة',
            snapshotRoom: 'التقاط صورة للغرفة',
            recordingOn: 'بدء التسجيل',
            recordingPause: 'إيقاف التسجيل مؤقتاً',
            recordingResume: 'استئناف التسجيل',
            recordingOff: 'إيقاف التسجيل',
            settingsOn: 'فتح الإعدادات',
            settingsOff: 'إغلاق الإعدادات',
            participantsOn: 'عرض المشاركين',
            participantsOff: 'إخفاء المشاركين',
            participantsVideoOff: 'إيقاف فيديو المشاركين',
            participantsAudioOff: 'إيقاف صوت المشاركين',
            participantsKickOut: 'طرد المشاركين',
            fileShareOn: 'فتح الملف',
            fileShareOff: 'إغلاق الملف',
            videoShareOn: 'مشاركة الفيديو',
            videoShareOff: 'إيقاف مشاركة الفيديو',
            swapCamera: 'تبديل الكاميرا',
            raiseHand: 'رفع اليد',
            lowerHand: 'إنزال اليد',
            roomLock: 'قفل الغرفة',
            roomUnlock: 'فتح قفل الغرفة',
            about: 'عرض المعلومات',
            email: 'فتح البريد الإلكتروني',
            google: 'فتح جوجل',
            googleTr: 'فتح ترجمة جوجل',
            youtube: 'فتح يوتيوب',
            facebook: 'فتح فيسبوك',
            linkedin: 'فتح لينكد إن',
            twitter: 'فتح تويتر',
            tiktok: 'فتح تيك توك',
            github: 'فتح جيت هاب',
            survey: 'فتح الاستطلاع',
            recognizeEnglish: 'التعرف على الإنجليزية',
            recognizeBangla: 'التعرف على البنغالية',
            recognizeItalian: 'التعرف على الإيطالية',
            recognizeSpanish: 'التعرف على الإسبانية',
            recognizeFrench: 'التعرف على الفرنسية',
            recognizeGerman: 'التعرف على الألمانية',
            recognizeJapanese: 'التعرف على اليابانية',
            recognizePortuguese: 'التعرف على البرتغالية',
            recognizeChinese: 'التعرف على الصينية',
            recognizeArabic: 'التعرف على العربية',
            stopRecognition: 'إيقاف التعرف الصوتي',
        },
    },
};

const browser = {
    newroom: '/newroom',
    email: 'mailto:?subject=&body=',
    google: 'https://www.google.com',
    googleTr: 'https://translate.google.com/',
    youtube: 'https://www.youtube.com',
    facebook: 'https://www.facebook.com',
    linkedin: 'https://www.linkedin.com',
    twitter: 'https://www.twitter.com',
    tiktok: 'https://www.tiktok.com',
    github: 'https://github.com/miroslavpejic85',
};

if (speechRecognition) {
    recognition = new speechRecognition();

    recognition.maxAlternatives = 1;
    recognition.continuous = true;
    setRecognitionLanguage(recognition, currentLangCode);

    console.log('Speech recognition', recognition);

    recognition.onstart = function () {
        console.log('Speech recognition started');
        hide(chatSpeechStartButton);
        show(chatSpeechStopButton);
        setColor(chatSpeechStopButton, 'lime');
        userLog('info', 'Speech recognition started', 'top-end');
    };

    recognition.onresult = (e) => {
        let current = e.resultIndex;
        let transcript = e.results[current][0].transcript;
        if (transcript) {
            if (transcript.trim().toLowerCase() != languageHandlers[currentLanguage].commands.chatSend) {
                chatMessage.value = transcript;
            }
            if (isVoiceCommandsEnabled && isVoiceCommandSupported) {
                execVoiceCommands(transcript);
            }
        }
    };

    recognition.onerror = function (event) {
        console.error('Speech recognition error', event.error);
        userLog('error', `Speech recognition error ${event.error}`, 'top-end', 6000);
    };

    recognition.onend = function () {
        console.log('Speech recognition stopped');
        show(chatSpeechStartButton);
        hide(chatSpeechStopButton);
        setColor(chatSpeechStopButton, 'white');
        userLog('info', 'Speech recognition stopped', 'top-end');
    };

    console.info('Browser supports webkitSpeechRecognition');
} else {
    console.warn('This browser does not support webkitSpeechRecognition');
    isVoiceCommandsEnabled = false;
}

function setRecognitionLanguage(recognition, languageCode) {
    if (!recognition) {
        console.error('Recognition object is not defined.');
        return;
    }
    recognition.lang = languageCode;
    console.log(`Voice recognition language set to: ${languageCode}`);
}

function startSpeech() {
    try {
        recognition.lang = languageHandlers[currentLanguage]?.langCode || 'en-US';
        recognition.start();
    } catch (error) {
        console.error('Error starting speech recognition:', error);
        userLog('error', 'Failed to start voice recognition', 'top-end');
    }
}

function stopSpeech() {
    try {
        recognition.stop();
    } catch (error) {
        console.error('Error stopping speech recognition:', error);
    }
}

function switchRecognitionLanguage(lang) {
    currentLanguage = lang;
    setRecognitionLanguage(recognition, languageHandlers[currentLanguage].langCode);
    recognition.stop();
    setTimeout(() => recognition.start(), 300);
    userLog('info', `Switched to ${lang} recognition`, 'top-end');
}

function printCommand(command) {
    console.log('Detected', { command: command });
    userLog('info', `Voice command: ${command}`, 'top-end', 2000);
}

function execVoiceCommands(transcript) {
    switch (transcript.trim().toLowerCase()) {
        case languageHandlers[currentLanguage].commands.shareRoom:
            printCommand(languageHandlers[currentLanguage].commands.shareRoom);
            shareButton.click();
            break;
        case languageHandlers[currentLanguage].commands.hideMe:
            printCommand(languageHandlers[currentLanguage].commands.hideMe);
            hideMeButton.click();
            break;
        case languageHandlers[currentLanguage].commands.showMe:
            printCommand(languageHandlers[currentLanguage].commands.showMe);
            hideMeButton.click();
            break;
        case languageHandlers[currentLanguage].commands.newRoom:
            printCommand(languageHandlers[currentLanguage].commands.newRoom);
            openURL(browser.newroom);
            break;
        case languageHandlers[currentLanguage].commands.leaveRoom:
            printCommand(languageHandlers[currentLanguage].commands.leaveRoom);
            exitButton.click();
            break;
        case languageHandlers[currentLanguage].commands.audioOn:
            printCommand(languageHandlers[currentLanguage].commands.audioOn);
            startAudioButton.click();
            break;
        case languageHandlers[currentLanguage].commands.audioOff:
            printCommand(languageHandlers[currentLanguage].commands.audioOff);
            stopAudioButton.click();
            break;
        case languageHandlers[currentLanguage].commands.videoOn:
            printCommand(languageHandlers[currentLanguage].commands.videoOn);
            startVideoButton.click();
            break;
        case languageHandlers[currentLanguage].commands.videoOff:
            printCommand(languageHandlers[currentLanguage].commands.videoOff);
            stopVideoButton.click();
            break;
        case languageHandlers[currentLanguage].commands.screenOn:
            printCommand(languageHandlers[currentLanguage].commands.screenOn);
            startScreenButton.click();
            break;
        case languageHandlers[currentLanguage].commands.screenOff:
            printCommand(languageHandlers[currentLanguage].commands.screenOff);
            stopScreenButton.click();
            break;
        case languageHandlers[currentLanguage].commands.chatOn:
            printCommand(languageHandlers[currentLanguage].commands.chatOn);
            chatButton.click();
            break;
        case languageHandlers[currentLanguage].commands.pollOn:
            printCommand(languageHandlers[currentLanguage].commands.pollOn);
            pollButton.click();
            break;
        case languageHandlers[currentLanguage].commands.pollOff:
            printCommand(languageHandlers[currentLanguage].commands.pollOff);
            pollCloseBtn.click();
            break;
        case languageHandlers[currentLanguage].commands.editorOn:
            printCommand(languageHandlers[currentLanguage].commands.editorOn);
            editorButton.click();
            break;
        case languageHandlers[currentLanguage].commands.editorOff:
            printCommand(languageHandlers[currentLanguage].commands.editorOff);
            editorCloseBtn.click();
            break;
        case languageHandlers[currentLanguage].commands.chatSend:
            printCommand(languageHandlers[currentLanguage].commands.chatSend);
            chatSendButton.click();
            break;
        case languageHandlers[currentLanguage].commands.chatOff:
            printCommand(languageHandlers[currentLanguage].commands.chatOff);
            chatCloseButton.click();
            break;
        case languageHandlers[currentLanguage].commands.toggleTr:
            transcriptionButton.click();
            break;
        case languageHandlers[currentLanguage].commands.whiteboardOn:
            printCommand(languageHandlers[currentLanguage].commands.whiteboardOn);
            whiteboardButton.click();
            break;
        case languageHandlers[currentLanguage].commands.whiteboardOff:
            printCommand(languageHandlers[currentLanguage].commands.whiteboardOff);
            whiteboardCloseBtn.click();
            break;
        case languageHandlers[currentLanguage].commands.snapshotRoom:
            printCommand(languageHandlers[currentLanguage].commands.snapshotRoom);
            snapshotRoomButton.click();
            break;
        case languageHandlers[currentLanguage].commands.recordingOn:
            printCommand(languageHandlers[currentLanguage].commands.recordingOn);
            startRecButton.click();
            break;
        case languageHandlers[currentLanguage].commands.recordingPause:
            printCommand(languageHandlers[currentLanguage].commands.recordingPause);
            pauseRecButton.click();
            break;
        case languageHandlers[currentLanguage].commands.recordingResume:
            printCommand(languageHandlers[currentLanguage].commands.recordingResume);
            recordingResume.click();
            break;
        case languageHandlers[currentLanguage].commands.recordingOff:
            printCommand(languageHandlers[currentLanguage].commands.recordingOff);
            stopRecButton.click();
            break;
        case languageHandlers[currentLanguage].commands.settingsOn:
            printCommand(languageHandlers[currentLanguage].commands.settingsOn);
            settingsButton.click();
            break;
        case languageHandlers[currentLanguage].commands.settingsOff:
            printCommand(languageHandlers[currentLanguage].commands.settingsOff);
            mySettingsCloseBtn.click();
            break;
        case languageHandlers[currentLanguage].commands.participantsOn:
            printCommand(languageHandlers[currentLanguage].commands.participantsOn);
            chatButton.click();
            break;
        case languageHandlers[currentLanguage].commands.participantsOff:
            printCommand(languageHandlers[currentLanguage].commands.participantsOff);
            chatCloseButton.click();
            break;
        case languageHandlers[currentLanguage].commands.participantsVideoOff:
            printCommand(languageHandlers[currentLanguage].commands.participantsVideoOff);
            rc.peerAction('me', socket.id, 'hide', true, true);
            break;
        case languageHandlers[currentLanguage].commands.participantsAudioOff:
            printCommand(languageHandlers[currentLanguage].commands.participantsAudioOff);
            rc.peerAction('me', socket.id, 'mute', true, true);
            break;
        case languageHandlers[currentLanguage].commands.participantsKickOut:
            printCommand(languageHandlers[currentLanguage].commands.participantsKickOut);
            rc.peerAction('me', socket.id, 'eject', true, true);
            break;
        case languageHandlers[currentLanguage].commands.fileShareOn:
            printCommand(languageHandlers[currentLanguage].commands.fileShareOn);
            fileShareButton.click();
            break;
        case languageHandlers[currentLanguage].commands.fileShareOff:
            printCommand(languageHandlers[currentLanguage].commands.fileShareOff);
            sendAbortBtn.click();
            break;
        case languageHandlers[currentLanguage].commands.videoShareOn:
            printCommand(languageHandlers[currentLanguage].commands.videoShareOn);
            videoShareButton.click();
            break;
        case languageHandlers[currentLanguage].commands.videoShareOff:
            printCommand(languageHandlers[currentLanguage].commands.videoShareOff);
            videoCloseBtn.click();
            break;
        case languageHandlers[currentLanguage].commands.swapCamera:
            printCommand(languageHandlers[currentLanguage].commands.swapCamera);
            swapCameraButton.click();
            break;
        case languageHandlers[currentLanguage].commands.raiseHand:
            printCommand(languageHandlers[currentLanguage].commands.raiseHand);
            raiseHandButton.click();
            break;
        case languageHandlers[currentLanguage].commands.lowerHand:
            printCommand(languageHandlers[currentLanguage].commands.lowerHand);
            lowerHandButton.click();
            break;
        case languageHandlers[currentLanguage].commands.roomLock:
            printCommand(languageHandlers[currentLanguage].commands.roomLock);
            lockRoomButton.click();
            break;
        case languageHandlers[currentLanguage].commands.roomUnlock:
            printCommand(languageHandlers[currentLanguage].commands.roomUnlock);
            unlockRoomButton.click();
            break;
        case languageHandlers[currentLanguage].commands.about:
            printCommand(languageHandlers[currentLanguage].commands.about);
            aboutButton.click();
            break;
        case languageHandlers[currentLanguage].commands.email:
            printCommand(languageHandlers[currentLanguage].commands.email);
            openURL(browser.email, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.google:
            printCommand(languageHandlers[currentLanguage].commands.google);
            openURL(browser.google, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.googleTr:
            printCommand(languageHandlers[currentLanguage].commands.googleTr);
            openURL(browser.googleTr, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.youtube:
            printCommand(languageHandlers[currentLanguage].commands.youtube);
            openURL(browser.youtube, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.facebook:
            printCommand(languageHandlers[currentLanguage].commands.facebook);
            openURL(browser.facebook, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.linkedin:
            printCommand(languageHandlers[currentLanguage].commands.linkedin);
            openURL(browser.linkedin, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.twitter:
            printCommand(languageHandlers[currentLanguage].commands.twitter);
            openURL(browser.twitter, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.tiktok:
            printCommand(languageHandlers[currentLanguage].commands.tiktok);
            openURL(browser.tiktok, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.github:
            printCommand(languageHandlers[currentLanguage].commands.github);
            openURL(browser.github, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.survey:
            printCommand(languageHandlers[currentLanguage].commands.survey);
            survey.enabled && openURL(survey.url, true);
            sound('open');
            break;
        case languageHandlers[currentLanguage].commands.recognizeBangla:
            printCommand(languageHandlers[currentLanguage].commands.recognizeBangla);
            switchRecognitionLanguage('bn');
            break;
        case languageHandlers[currentLanguage].commands.recognizeEnglish:
            printCommand(languageHandlers[currentLanguage].commands.recognizeEnglish);
            switchRecognitionLanguage('en');
            break;
        case languageHandlers[currentLanguage].commands.recognizeItalian:
            printCommand(languageHandlers[currentLanguage].commands.recognizeItalian);
            switchRecognitionLanguage('it');
            break;
        case languageHandlers[currentLanguage].commands.recognizeSpanish:
            printCommand(languageHandlers[currentLanguage].commands.recognizeSpanish);
            switchRecognitionLanguage('es');
            break;
        case languageHandlers[currentLanguage].commands.recognizeFrench:
            printCommand(languageHandlers[currentLanguage].commands.recognizeFrench);
            switchRecognitionLanguage('fr');
            break;
        case languageHandlers[currentLanguage].commands.recognizeGerman:
            printCommand(languageHandlers[currentLanguage].commands.recognizeGerman);
            switchRecognitionLanguage('de');
            break;
        case languageHandlers[currentLanguage].commands.recognizeJapanese:
            printCommand(languageHandlers[currentLanguage].commands.recognizeJapanese);
            switchRecognitionLanguage('ja');
            break;
        case languageHandlers[currentLanguage].commands.recognizePortuguese:
            printCommand(languageHandlers[currentLanguage].commands.recognizePortuguese);
            switchRecognitionLanguage('pt');
            break;
        case languageHandlers[currentLanguage].commands.recognizeChinese:
            printCommand(languageHandlers[currentLanguage].commands.recognizeChinese);
            switchRecognitionLanguage('zh');
            break;
        case languageHandlers[currentLanguage].commands.recognizeArabic:
            printCommand(languageHandlers[currentLanguage].commands.recognizeArabic);
            switchRecognitionLanguage('ar');
            break;
        case languageHandlers[currentLanguage].commands.stopRecognition:
            printCommand(languageHandlers[currentLanguage].commands.stopRecognition);
            chatSpeechStopButton.click();
            break;
        default:
            console.log('Unrecognized command:', transcript);
            break;
    }
}

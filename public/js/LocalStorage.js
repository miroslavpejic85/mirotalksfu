'use-strict';

class LocalStorage {
    constructor() {
        this.MEDIA_TYPE = {
            audio: 'audio',
            video: 'video',
            audioVideo: 'audioVideo',
            speaker: 'speaker',
        };

        this.INIT_CONFIG = {
            audio: true,
            video: true,
            audioVideo: true,
        };

        this.SFU_SETTINGS = {
            video_obj_fit: 2,
            video_controls: 0,
            theme: 0,
            buttons_bar: 0,
            pin_grid: 0,
        };

        this.DEVICES_COUNT = {
            audio: 0,
            speaker: 0,
            video: 0,
        };

        this.LOCAL_STORAGE_DEVICES = {
            audio: {
                count: 0,
                index: 0,
                select: null,
            },
            speaker: {
                count: 0,
                index: 0,
                select: null,
            },
            video: {
                count: 0,
                index: 0,
                select: null,
            },
        };
    }

    // ####################################################
    // SET LOCAL STORAGE
    // ####################################################

    setItemLocalStorage(key, value) {
        localStorage.setItem(key, value);
    }

    setObjectLocalStorage(name, object) {
        localStorage.setItem(name, JSON.stringify(object));
    }

    setSettings(settings) {
        this.SFU_SETTINGS = settings;
        this.setObjectLocalStorage('SFU_SETTINGS', this.SFU_SETTINGS);
    }

    setInitConfig(type, status) {
        switch (type) {
            case this.MEDIA_TYPE.audio:
                this.INIT_CONFIG.audio = status;
                break;
            case this.MEDIA_TYPE.video:
                this.INIT_CONFIG.video = status;
                break;
            case this.MEDIA_TYPE.audioVideo:
                this.INIT_CONFIG.audioVideo = status;
                break;
        }
        this.setObjectLocalStorage('INIT_CONFIG', this.INIT_CONFIG);
    }

    setLocalStorageDevices(type, index, select) {
        switch (type) {
            case this.MEDIA_TYPE.audio:
                this.LOCAL_STORAGE_DEVICES.audio.count = this.DEVICES_COUNT.audio;
                this.LOCAL_STORAGE_DEVICES.audio.index = index;
                this.LOCAL_STORAGE_DEVICES.audio.select = select;
                break;
            case this.MEDIA_TYPE.video:
                this.LOCAL_STORAGE_DEVICES.video.count = this.DEVICES_COUNT.video;
                this.LOCAL_STORAGE_DEVICES.video.index = index;
                this.LOCAL_STORAGE_DEVICES.video.select = select;
                break;
            case this.MEDIA_TYPE.speaker:
                this.LOCAL_STORAGE_DEVICES.speaker.count = this.DEVICES_COUNT.speaker;
                this.LOCAL_STORAGE_DEVICES.speaker.index = index;
                this.LOCAL_STORAGE_DEVICES.speaker.select = select;
                break;
            default:
                break;
        }
        this.setObjectLocalStorage('LOCAL_STORAGE_DEVICES', this.LOCAL_STORAGE_DEVICES);
    }

    // ####################################################
    // GET LOCAL STORAGE
    // ####################################################

    getSettings() {
        return this.getObjectLocalStorage('SFU_SETTINGS');
    }

    getInitConfig() {
        return this.getObjectLocalStorage('INIT_CONFIG');
    }

    getLocalStorageDevices() {
        return this.getObjectLocalStorage('LOCAL_STORAGE_DEVICES');
    }

    getItemLocalStorage(key) {
        localStorage.getItem(key);
    }

    getObjectLocalStorage(name) {
        return JSON.parse(localStorage.getItem(name));
    }
}

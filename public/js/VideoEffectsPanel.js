'use strict';

/**
 * MiroTalk Video Effects - Visual effects panel.
 *
 * One component for "how I look on camera", mounted in Settings and in the pre-join lobby:
 * tabs Background / Effects / Avatars / 3D Avatars / Filters, removable chips for what is on with a
 * "Turn off all" action, an optional live self-preview, and clear states (camera off, loading,
 * unavailable, slow device). Every mounted view follows the same state.
 *
 * Integration points are adapters, so the panel knows nothing about RoomClient:
 * - background: the existing virtual background feature (apply, upload, custom images)
 * - camera: { isOn(), turnOn() } for the camera-off hint
 * - preview: { getStream(), isMirrored() } for the live self-preview
 * - snapshotSource(): a <video> used to build the filter previews from the user's own camera
 */
class VideoEffectsPanel {
    static STORAGE_KEY = 'videoEffectsSettings';

    // Avatars and accessories added by the user (a .glb in the 3D Avatars tab, a picture in the Avatars
    // and Effects tabs); only the ones from a link survive a reload
    static CUSTOM_AVATARS_KEY = 'videoEffectsCustomAvatars';
    static CUSTOM_AVATAR_PREFIXES = { avatar3d: 'avatar3d-custom-', avatar: 'avatar-custom-', face: 'effect-custom-' };
    // Size slider range (a multiplier of the default size) per tab
    static CUSTOM_SCALE_RANGES = { avatar3d: [0.6, 1.6], avatar: [0.6, 1.6], face: [0.4, 2.5] };
    // Where a picture accessory goes on the face (units of the eye distance, see the built-in effects)
    static PLACEMENTS = {
        head: { anchor: 'forehead', offset: [0, 0.14, 0], width: 2.3, pivot: [0.5, 0.78] },
        eyes: { anchor: 'eyes', offset: [0, 0.02, -0.08], width: 1.8, pivot: [0.5, 0.5] },
        nose: { anchor: 'noseTip', offset: [0, 0, 0], width: 0.7, pivot: [0.5, 0.5] },
        mouth: { anchor: 'mouth', offset: [0, 0, 0], width: 1.2, pivot: [0.5, 0.5] },
    };
    static MAX_AVATAR_BYTES = 50 * 1024 * 1024;
    static MAX_PICTURE_BYTES = 10 * 1024 * 1024;
    static MAX_CUSTOM_AVATARS = 6;
    static PICTURE_EXTENSIONS = /\.(png|jpe?g|webp|gif|svg)$/i;
    // A picture avatar is this wide, in eye distances (a face is about 2.2), with the eyes at 42% of its height
    static PICTURE_WIDTH = 3;
    static PICTURE_EYES_Y = 0.42;

    static TABS = ['background', 'face', 'avatar', 'avatar3d', 'filters'];

    // Tabs listing engine effects, by effect category
    static EFFECT_TABS = ['face', 'avatar', 'avatar3d'];

    static ADVANCED_SLIDERS = [
        { key: 'brightness', icon: 'fas fa-sun', min: 0.5, max: 1.5, step: 0.01 },
        { key: 'contrast', icon: 'fas fa-circle-half-stroke', min: 0.5, max: 1.5, step: 0.01 },
        { key: 'saturation', icon: 'fas fa-droplet', min: 0, max: 2, step: 0.01 },
        { key: 'temperature', icon: 'fas fa-temperature-half', min: -1, max: 1, step: 0.01 },
    ];

    constructor(
        engine,
        {
            onChange = async () => {},
            onStateChange = () => {},
            background = null,
            camera = null,
            preview = null,
            snapshotSource = null,
        } = {}
    ) {
        this.engine = engine;
        this.onChange = onChange;
        this.onStateChange = onStateChange;
        this.background = background;
        this.camera = camera;
        this.preview = preview;
        this.snapshotSource = snapshotSource;
        this.views = [];
        this.barViews = [];
        this.activeTab = null;
        this.loadingEffect = null;
        this.backgroundBusy = false;
        this.urlError = '';
        this.avatarErrors = { face: '', avatar: '', avatar3d: '' };
        this.placement = 'head';
        this.avatarBusy = false;
        this.customAvatars = new Map();
        this.restoreCustomAvatars();
        this.snapshot = null;
        this.saveTimer = null;
        this.tickTimer = null;
        this.unsubscribe = [
            engine.on('state', () => this.sync()),
            engine.on('error', ({ stage }) => this.handleEngineError(stage)),
        ];
    }

    static t(text) {
        return window.i18n && typeof window.i18n.t === 'function' ? window.i18n.t(text) : text;
    }

    static element(tag, className, attributes = {}) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value));
        return el;
    }

    static icon(className) {
        return VideoEffectsPanel.element('i', className, { 'aria-hidden': 'true' });
    }

    static sliderLabel(key) {
        const t = VideoEffectsPanel.t;
        switch (key) {
            case 'brightness':
                return t('Brightness');
            case 'contrast':
                return t('Contrast');
            case 'saturation':
                return t('Saturation');
            case 'temperature':
                return t('Warmth');
            default:
                return key;
        }
    }

    static tabLabel(tab) {
        const t = VideoEffectsPanel.t;
        switch (tab) {
            case 'background':
                return t('Background');
            case 'face':
                return t('Effects');
            case 'avatar':
                return t('Avatars');
            case 'avatar3d':
                return t('3D Avatars');
            default:
                return t('Filters');
        }
    }

    static tabIcon(tab) {
        return {
            background: 'fas fa-image',
            face: 'fas fa-face-smile',
            avatar: 'fas fa-masks-theater',
            avatar3d: 'fas fa-user-astronaut',
            filters: 'fas fa-palette',
        }[tab];
    }

    // ####################################################
    // STATE
    // ####################################################

    hasBackground() {
        return !!this.background && this.background.isAvailable();
    }

    availableTabs() {
        return VideoEffectsPanel.TABS.filter((tab) => tab !== 'background' || this.hasBackground());
    }

    backgroundKey(selection = this.background?.getSelection() || {}) {
        if (selection.blurLevel) return selection.blurLevel >= 20 ? 'blur-20' : 'blur-10';
        if (selection.imageUrl) return `image:${selection.imageUrl}`;
        if (selection.transparent) return 'transparent';
        return null;
    }

    effectMeta(id) {
        return this.engine.getEffects().find((effect) => effect.id === id) || null;
    }

    static effectTab(effect) {
        return VideoEffectsPanel.EFFECT_TABS.includes(effect?.category) ? effect.category : 'face';
    }

    // Everything currently changing the camera, each with its own remove action
    getActiveItems() {
        const t = VideoEffectsPanel.t;
        const state = this.engine.getState();
        const items = [];
        if (this.hasBackground()) {
            const selection = this.background.getSelection();
            const key = this.backgroundKey(selection);
            if (key) {
                const labels = {
                    'blur-10': t('Blur'),
                    'blur-20': t('Strong blur'),
                    transparent: t('Transparent'),
                };
                items.push({
                    id: 'background',
                    tab: 'background',
                    label: labels[key] || t('Background image'),
                    icon: key.startsWith('blur')
                        ? 'fas fa-droplet'
                        : key === 'transparent'
                          ? 'fas fa-border-none'
                          : null,
                    thumb: selection.imageUrl || null,
                    remove: () => this.selectBackground(null),
                });
            }
        }
        if (state.effect) {
            const meta = this.effectMeta(state.effect);
            items.push({
                id: 'effect',
                tab: VideoEffectsPanel.effectTab(meta),
                label: meta?.label ? t(meta.label) : state.effect,
                thumb: meta?.thumbnail || null,
                icon: meta?.thumbnail ? null : 'fas fa-user-astronaut',
                remove: () => this.selectEffect(state.effect),
            });
        }
        if (state.filterPreset !== 'none') {
            const preset = state.filterPreset ? MiroTalkVFX.getFilterPreset(state.filterPreset) : null;
            items.push({
                id: 'filter',
                tab: 'filters',
                label: preset ? t(preset.label) : t('Custom'),
                icon: 'fas fa-palette',
                remove: () => this.resetFilters(),
            });
        }
        if (state.adjustments.touchUp > 0) {
            items.push({
                id: 'touchUp',
                tab: 'filters',
                label: t('Touch up'),
                icon: 'fas fa-wand-magic-sparkles',
                remove: () => this.setAdjustment('touchUp', 0),
            });
        }
        if (state.adjustments.lowLight > 0) {
            items.push({
                id: 'lowLight',
                tab: 'filters',
                label: t('Low light'),
                icon: 'fas fa-lightbulb',
                remove: () => this.setAdjustment('lowLight', 0),
            });
        }
        return items;
    }

    isAnythingActive() {
        return this.getActiveItems().length > 0;
    }

    faceUnavailableReason(state = this.engine.getState()) {
        if (state.faceTracking === 'error') return VideoEffectsPanel.t('Face tracking isn’t supported on this device.');
        return null;
    }

    // ####################################################
    // SETTINGS
    // ####################################################

    async restoreSettings() {
        let saved = null;
        try {
            saved = JSON.parse(localStorage.getItem(VideoEffectsPanel.STORAGE_KEY) || 'null');
        } catch (error) {
            console.warn('Unable to read the saved video effects', error);
        }
        if (!saved || typeof saved !== 'object') return;
        try {
            const preset = saved.filterPreset && MiroTalkVFX.getFilterPreset(saved.filterPreset);
            if (preset) {
                this.engine.setFilterPreset(preset.id);
            } else if (saved.filters) {
                this.engine.setFilters(saved.filters);
            }
            if (saved.adjustments) this.engine.setAdjustments(saved.adjustments);
            if (saved.effect && this.engine.getEffects().some((effect) => effect.id === saved.effect)) {
                await this.engine.setEffect(saved.effect);
            }
        } catch (error) {
            console.warn('Unable to restore the saved video effects', error);
        }
    }

    saveSettings() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            const state = this.engine.getState();
            const settings = {
                effect: state.effect,
                filterPreset: state.filterPreset,
                filters: state.filters,
                adjustments: state.adjustments,
            };
            try {
                localStorage.setItem(VideoEffectsPanel.STORAGE_KEY, JSON.stringify(settings));
            } catch (error) {
                console.warn('Unable to save the video effects', error);
            }
        }, 250);
    }

    async commit() {
        this.saveSettings();
        await this.onChange();
        this.sync();
    }

    // ####################################################
    // ACTIONS
    // ####################################################

    // Choosing the active effect again removes it (one effect at a time)
    async selectEffect(id) {
        const current = this.engine.getState().effect;
        const next = !id || id === current ? null : id;
        this.loadingEffect = next;
        this.sync();
        try {
            await this.engine.setEffect(next);
            await this.commit();
        } catch (error) {
            console.error('Unable to apply the video effect', error);
            if (typeof userLog === 'function') {
                userLog('warning', 'This effect could not be loaded. Please try again.', 'top-end', 6000);
            }
        } finally {
            if (this.loadingEffect === next) this.loadingEffect = null;
            this.sync();
        }
    }

    static avatarLabel(source, fallback) {
        let name = String(source || '');
        try {
            name = decodeURIComponent(new URL(name).pathname.split('/').pop());
        } catch (error) {
            // A file name
        }
        name = name
            .replace(/\.(glb|gltf|png|jpe?g|webp|gif|svg)$/i, '')
            .replace(/[_-]+/g, ' ')
            .trim();
        return name.slice(0, 24) || fallback;
    }

    registerCustomAvatar({ id, label, url, scale, remote, order, category = 'avatar3d', placement = 'head' }) {
        if (category === 'avatar3d') {
            MiroTalkVFX.registerAvatar3D({ id, label, order, model: { asset: url, scale, fit: true } });
        } else if (category === 'face') {
            // A picture (hat, glasses, nose, mask...) placed on the face where the user chose
            const place = VideoEffectsPanel.PLACEMENTS[placement];
            MiroTalkVFX.registerEffect({
                id,
                label,
                order,
                category: 'face',
                thumbnail: url,
                layers: [{ ...place, asset: url, width: place.width * scale }],
            });
        } else {
            // A picture (photo, drawing, sticker) placed on the face; it does not blink or talk
            MiroTalkVFX.registerEffect({
                id,
                label,
                order,
                category: 'avatar',
                thumbnail: url,
                layers: [
                    {
                        asset: url,
                        anchor: 'eyes',
                        width: VideoEffectsPanel.PICTURE_WIDTH * scale,
                        pivot: [0.5, VideoEffectsPanel.PICTURE_EYES_Y],
                    },
                ],
            });
        }
        this.customAvatars.set(id, { label, url, scale, remote, order, category, placement });
    }

    customAvatarCount(category) {
        return [...this.customAvatars.values()].filter((avatar) => avatar.category === category).length;
    }

    forgetCustomAvatar(id) {
        const avatar = this.customAvatars.get(id);
        MiroTalkVFX.unregisterEffect(id);
        if (avatar && !avatar.remote) URL.revokeObjectURL(avatar.url);
        this.customAvatars.delete(id);
        this.saveCustomAvatars();
    }

    restoreCustomAvatars() {
        let saved = null;
        try {
            saved = JSON.parse(localStorage.getItem(VideoEffectsPanel.CUSTOM_AVATARS_KEY) || 'null');
        } catch (error) {
            console.warn('Unable to read the saved custom avatars', error);
        }
        if (!Array.isArray(saved)) return;
        const MAX_SAVED =
            VideoEffectsPanel.MAX_CUSTOM_AVATARS * Object.keys(VideoEffectsPanel.CUSTOM_AVATAR_PREFIXES).length;
        saved.slice(0, MAX_SAVED).forEach((item) => {
            const category = Object.keys(VideoEffectsPanel.CUSTOM_AVATAR_PREFIXES).find(
                (key) =>
                    typeof item?.id === 'string' && item.id.startsWith(VideoEffectsPanel.CUSTOM_AVATAR_PREFIXES[key])
            );
            const valid =
                category &&
                this.customAvatarCount(category) < VideoEffectsPanel.MAX_CUSTOM_AVATARS &&
                typeof item.url === 'string' &&
                /^https?:\/\//i.test(item.url);
            if (!valid) return;
            const [min, max] = VideoEffectsPanel.CUSTOM_SCALE_RANGES[category];
            try {
                this.registerCustomAvatar({
                    id: item.id,
                    label: String(item.label || '').slice(0, 24) || 'Avatar',
                    url: item.url,
                    scale: Math.min(max, Math.max(min, Number(item.scale) || 1)),
                    remote: true,
                    order: 1000 + this.customAvatarCount(category),
                    category,
                    placement: item.placement in VideoEffectsPanel.PLACEMENTS ? item.placement : 'head',
                });
            } catch (error) {
                console.warn('Unable to restore a custom avatar', error);
            }
        });
    }

    saveCustomAvatars() {
        const saved = [...this.customAvatars]
            .filter(([, avatar]) => avatar.remote)
            .map(([id, { label, url, scale, category, placement }]) =>
                category === 'face' ? { id, label, url, scale, placement } : { id, label, url, scale }
            );
        try {
            localStorage.setItem(VideoEffectsPanel.CUSTOM_AVATARS_KEY, JSON.stringify(saved));
        } catch (error) {
            console.warn('Unable to save the custom avatars', error);
        }
    }

    // A .glb link or file (rigged head or body) for the 3D Avatars tab, or a picture for the Avatars tab:
    // loaded once to check it, then kept in its tab
    async addCustomAvatar(category, url, label, remote) {
        const t = VideoEffectsPanel.t;
        if (this.avatarBusy) return false;
        if (this.customAvatarCount(category) >= VideoEffectsPanel.MAX_CUSTOM_AVATARS) {
            this.avatarErrors[category] = t('Remove a custom avatar before adding another one.');
            this.sync();
            return false;
        }
        const id = `${VideoEffectsPanel.CUSTOM_AVATAR_PREFIXES[category]}${Date.now().toString(36)}`;
        this.avatarErrors[category] = '';
        this.avatarBusy = true;
        this.loadingEffect = id;
        this.registerCustomAvatar({
            id,
            label,
            url,
            scale: 1,
            remote,
            order: 1000 + this.customAvatarCount(category),
            category,
            placement: this.placement,
        });
        this.sync();
        try {
            await this.engine.setEffect(id);
            this.saveCustomAvatars();
            await this.commit();
            return true;
        } catch (error) {
            console.warn('Unable to load the custom avatar', error);
            this.forgetCustomAvatar(id);
            if (category !== 'avatar3d') {
                this.avatarErrors[category] = remote
                    ? t('This image can’t be loaded (the website may block it). Download it and use Upload.')
                    : t('This file can’t be loaded as an image.');
            } else if (error?.code === 'ASSET_INVALID') {
                this.avatarErrors[category] = t('This model has no face rig. It needs eye nodes or blink blendshapes.');
            } else {
                this.avatarErrors[category] = remote
                    ? t('This model can’t be loaded (the website may block it). Download it and use Upload.')
                    : t('This file can’t be loaded as a 3D avatar.');
            }
            return false;
        } finally {
            this.avatarBusy = false;
            if (this.loadingEffect === id) this.loadingEffect = null;
            this.sync();
        }
    }

    async addCustomAvatarFromUrl(category, url) {
        const value = (url || '').trim();
        let valid = /^https?:\/\//i.test(value);
        try {
            if (valid) new URL(value);
        } catch (error) {
            valid = false;
        }
        if (!valid) {
            const t = VideoEffectsPanel.t;
            this.avatarErrors[category] =
                category === 'avatar3d' ? t('Paste a link to a .glb avatar.') : t('Paste a link to an image.');
            this.sync();
            return false;
        }
        return this.addCustomAvatar(
            category,
            value,
            VideoEffectsPanel.avatarLabel(value, VideoEffectsPanel.t('Avatar')),
            true
        );
    }

    async uploadCustomAvatar(category, files) {
        const t = VideoEffectsPanel.t;
        const file = Array.from(files || [])[0];
        if (!file) return false;
        const isPicture = category !== 'avatar3d';
        const validType = isPicture
            ? /^image\/(png|jpe?g|webp|gif|svg\+xml)$/i.test(file.type) ||
              VideoEffectsPanel.PICTURE_EXTENSIONS.test(file.name)
            : /\.glb$/i.test(file.name);
        const maxBytes = isPicture ? VideoEffectsPanel.MAX_PICTURE_BYTES : VideoEffectsPanel.MAX_AVATAR_BYTES;
        if (!validType) {
            this.avatarErrors[category] = isPicture
                ? t('Choose an image file (PNG, JPG, WebP, GIF or SVG).')
                : t('Choose a .glb file.');
        } else if (file.size > maxBytes) {
            this.avatarErrors[category] = isPicture
                ? t('This image is too large (10 MB max).')
                : t('This file is too large (50 MB max).');
        } else {
            return this.addCustomAvatar(
                category,
                URL.createObjectURL(file),
                VideoEffectsPanel.avatarLabel(file.name, t('Avatar')),
                false
            );
        }
        this.sync();
        return false;
    }

    async removeCustomAvatar(id) {
        if (this.engine.getState().effect === id) await this.selectEffect(id);
        this.forgetCustomAvatar(id);
        this.sync();
    }

    // Fit differs between models: the size is the one thing the user can correct
    async setCustomAvatarSize(value) {
        const id = this.engine.getState().effect;
        const avatar = this.customAvatars.get(id);
        if (!avatar) return;
        this.registerCustomAvatar({ id, ...avatar, scale: Number(value) });
        this.saveCustomAvatars();
        this.sync();
        try {
            await this.engine.setEffect(id);
        } catch (error) {
            console.warn('Unable to resize the custom avatar', error);
        }
    }

    // Where the next picture accessory goes; the one that is on moves right away
    async setPlacement(placement) {
        if (!(placement in VideoEffectsPanel.PLACEMENTS)) return;
        this.placement = placement;
        const id = this.engine.getState().effect;
        const accessory = this.customAvatars.get(id);
        if (accessory?.category === 'face') {
            this.registerCustomAvatar({ id, ...accessory, placement });
            this.saveCustomAvatars();
            try {
                await this.engine.setEffect(id);
            } catch (error) {
                console.warn('Unable to move the custom effect', error);
            }
        }
        this.sync();
    }

    async selectPreset(id) {
        const current = this.engine.getState().filterPreset;
        this.engine.setFilterPreset(id === current ? 'none' : id);
        await this.commit();
    }

    async setFilter(key, value) {
        this.engine.setFilters({ [key]: Number(value) });
        await this.commit();
    }

    async setAdjustment(key, value) {
        this.engine.setAdjustments({ [key]: Number(value) });
        await this.commit();
    }

    async resetFilters() {
        this.engine.resetFilters();
        await this.commit();
    }

    // Choosing the active background again removes it
    async selectBackground(key) {
        if (!this.background || this.backgroundBusy) return;
        const next = key && key === this.backgroundKey() ? null : key;
        this.backgroundBusy = true;
        this.sync();
        try {
            if (!next) await this.background.apply(null, null, null);
            else if (next === 'blur-10') await this.background.apply(10, null, null);
            else if (next === 'blur-20') await this.background.apply(20, null, null);
            else if (next === 'transparent') await this.background.apply(null, null, true);
            else await this.background.apply(null, next.slice('image:'.length), null);
        } catch (error) {
            console.error('Unable to change the camera background', error);
            if (typeof userLog === 'function') {
                userLog('warning', 'The background could not be changed. Please try again.', 'top-end', 6000);
            }
        } finally {
            this.backgroundBusy = false;
            this.sync();
        }
    }

    async uploadBackground(files) {
        if (!this.background?.upload) return;
        const images = await this.background.upload(Array.from(files || []));
        const last = images?.[images.length - 1];
        this.sync();
        if (last && this.backgroundKey() !== `image:${last}`) await this.selectBackground(`image:${last}`);
    }

    async addBackgroundFromUrl(url) {
        const t = VideoEffectsPanel.t;
        const value = (url || '').trim();
        this.urlError = '';
        if (!/^https?:\/\//i.test(value) || !this.background?.isValidImageUrl?.(value)) {
            this.urlError = t('Paste a link to an image (jpg, png, gif, webp...).');
            this.sync();
            return false;
        }
        try {
            const response = await fetch(value);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            if (!blob.type.startsWith('image/')) throw new Error('Not an image');
            const file = new File([blob], 'background', { type: blob.type });
            await this.uploadBackground([file]);
            return true;
        } catch (error) {
            console.warn('Unable to add the background from URL', error);
            this.urlError = t('This image can’t be loaded (the website may block it). Download it and use Upload.');
            this.sync();
            return false;
        }
    }

    async removeCustomBackground(imageUrl) {
        if (!this.background?.removeCustom) return;
        if (this.backgroundKey() === `image:${imageUrl}`) await this.selectBackground(null);
        await this.background.removeCustom(imageUrl);
        this.sync();
    }

    async turnOffAll() {
        const hadBackground = this.hasBackground() && !!this.backgroundKey();
        await this.engine.clearAll();
        if (hadBackground) await this.selectBackground(null);
        await this.commit();
    }

    openTab(tab) {
        if (!this.availableTabs().includes(tab)) return;
        this.activeTab = tab;
        this.sync();
        if (tab === 'filters') this.refreshSnapshot();
    }

    handleEngineError(stage) {
        if (stage === 'face-tracking' && typeof userLog === 'function') {
            userLog(
                'warning',
                'Face tracking is not available on this device. Filters and backgrounds still work.',
                'top-end',
                6000
            );
        }
        this.sync();
    }

    // ####################################################
    // FILTER PREVIEWS FROM THE USER'S CAMERA
    // ####################################################

    // Raw camera (before filters) when the engine runs, otherwise what the app shows
    snapshotVideo() {
        const raw = this.engine.running ? this.engine.source?.video : null;
        if (raw?.videoWidth) return raw;
        const fallback = this.snapshotSource?.();
        return fallback?.videoWidth ? fallback : null;
    }

    refreshSnapshot() {
        const video = this.snapshotVideo();
        if (!video) return;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 160;
            canvas.height = 120;
            const ctx = canvas.getContext('2d');
            const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
            const w = video.videoWidth * scale;
            const h = video.videoHeight * scale;
            ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
            this.snapshot = canvas.toDataURL('image/jpeg', 0.8);
            this.views.forEach((view) => this.updateSwatches(view));
        } catch (error) {
            console.warn('Unable to build the filter previews', error);
        }
    }

    updateSwatches(view) {
        view.presetCards.forEach((card, id) => {
            const swatch = card.querySelector('.vfx-swatch');
            if (!swatch || id === 'none') return;
            swatch.classList.toggle('vfx-swatch-photo', !!this.snapshot);
            swatch.style.backgroundImage = this.snapshot ? `url("${this.snapshot}")` : '';
        });
    }

    // ####################################################
    // KEYBOARD: one tab stop per grid, arrows move inside it
    // ####################################################

    static setupRoving(container, selector) {
        container.addEventListener('keydown', (event) => {
            const items = [...container.querySelectorAll(selector)].filter((item) => !item.disabled);
            const index = items.indexOf(document.activeElement);
            if (index === -1) return;
            const top = items[0].offsetTop;
            const columns = Math.max(1, items.filter((item) => item.offsetTop === top).length);
            let next = index;
            switch (event.key) {
                case 'ArrowRight':
                    next = Math.min(items.length - 1, index + 1);
                    break;
                case 'ArrowLeft':
                    next = Math.max(0, index - 1);
                    break;
                case 'ArrowDown':
                    next = Math.min(items.length - 1, index + columns);
                    break;
                case 'ArrowUp':
                    next = Math.max(0, index - columns);
                    break;
                case 'Home':
                    next = 0;
                    break;
                case 'End':
                    next = items.length - 1;
                    break;
                default:
                    return;
            }
            event.preventDefault();
            items.forEach((item, i) => item.setAttribute('tabindex', i === next ? '0' : '-1'));
            items[next].focus();
        });
    }

    static updateRoving(container, selector) {
        const items = [...container.querySelectorAll(selector)].filter((item) => !item.disabled);
        if (!items.length) return;
        if (items.includes(document.activeElement)) return;
        const current = items.find((item) => item.getAttribute('aria-pressed') === 'true') || items[0];
        items.forEach((item) => item.setAttribute('tabindex', item === current ? '0' : '-1'));
    }

    // ####################################################
    // UI BUILDING BLOCKS
    // ####################################################

    createCard({ label, image = null, icon = null, badge = null, swatch = null, onClick, toggle = true }) {
        const card = VideoEffectsPanel.element('button', 'vfx-card', { type: 'button' });
        if (toggle) card.setAttribute('aria-pressed', 'false');
        card.setAttribute('aria-label', label);
        card.title = label;
        const thumb = VideoEffectsPanel.element('span', 'vfx-thumb', { 'aria-hidden': 'true' });
        if (image) {
            const img = VideoEffectsPanel.element('img', null, { alt: '', loading: 'lazy', decoding: 'async' });
            img.src = image;
            img.draggable = false;
            thumb.appendChild(img);
        } else if (swatch) {
            thumb.appendChild(swatch);
        } else if (icon) {
            thumb.appendChild(VideoEffectsPanel.icon(icon));
        }
        if (badge) {
            const badgeEl = VideoEffectsPanel.element('span', 'vfx-badge');
            badgeEl.textContent = badge;
            thumb.appendChild(badgeEl);
        }
        const text = VideoEffectsPanel.element('span', 'vfx-label');
        text.textContent = label;
        card.append(thumb, text);
        card.addEventListener('click', onClick);
        return card;
    }

    createPresetSwatch(preset) {
        const swatch = VideoEffectsPanel.element('span', 'vfx-swatch');
        swatch.style.filter = MiroTalkVFX.cssFilter(preset.filters);
        const temperature = preset.filters.temperature || 0;
        if (temperature) {
            const tint = VideoEffectsPanel.element('span', 'vfx-swatch-tint');
            tint.style.background = temperature > 0 ? 'rgba(255, 150, 40, 0.45)' : 'rgba(40, 130, 255, 0.45)';
            swatch.appendChild(tint);
        }
        return swatch;
    }

    createSlider({ key, label, icon, min, max, step, onInput }) {
        const row = VideoEffectsPanel.element('label', 'vfx-slider');
        const name = VideoEffectsPanel.element('span', 'vfx-slider-name');
        name.append(VideoEffectsPanel.icon(icon));
        const nameText = VideoEffectsPanel.element('span');
        nameText.textContent = label;
        name.appendChild(nameText);
        const input = VideoEffectsPanel.element('input', 'vfx-range', { type: 'range', min, max, step });
        const value = VideoEffectsPanel.element('span', 'vfx-slider-value');
        input.addEventListener('input', () => onInput(input.value));
        row.append(name, input, value);
        return { key, row, input, value };
    }

    createHint(text) {
        const hint = VideoEffectsPanel.element('p', 'vfx-hint');
        hint.textContent = text;
        return hint;
    }

    // Chips for everything that is on + "Turn off all"
    renderActiveBar(bar, { onOpen = null } = {}) {
        const t = VideoEffectsPanel.t;
        const items = this.getActiveItems();
        const signature = items.map((item) => `${item.id}:${item.label}:${item.thumb || ''}`).join('|');
        if (bar.__vfxSignature === signature) return;
        bar.__vfxSignature = signature;
        bar.replaceChildren();
        bar.classList.toggle('vfx-active-empty', !items.length);
        if (!items.length) {
            const empty = VideoEffectsPanel.element('span', 'vfx-active-none');
            empty.textContent = t('No effects on');
            bar.appendChild(empty);
            return;
        }
        items.forEach((item) => {
            const chip = VideoEffectsPanel.element('span', 'vfx-chip');
            const open = VideoEffectsPanel.element('button', 'vfx-chip-open', { type: 'button' });
            if (item.thumb) {
                const img = VideoEffectsPanel.element('img', null, { alt: '' });
                img.src = item.thumb;
                open.appendChild(img);
            } else if (item.icon) {
                open.appendChild(VideoEffectsPanel.icon(item.icon));
            }
            const label = VideoEffectsPanel.element('span');
            label.textContent = item.label;
            open.appendChild(label);
            open.addEventListener('click', () => (onOpen ? onOpen(item.tab) : this.openTab(item.tab)));
            const remove = VideoEffectsPanel.element('button', 'vfx-chip-remove', { type: 'button' });
            remove.setAttribute('aria-label', `${t('Remove')} ${item.label}`);
            remove.title = t('Remove');
            remove.appendChild(VideoEffectsPanel.icon('fas fa-xmark'));
            remove.addEventListener('click', () => item.remove());
            chip.append(open, remove);
            bar.appendChild(chip);
        });
        if (items.length > 1) {
            const all = VideoEffectsPanel.element('button', 'vfx-turn-off-all', { type: 'button' });
            all.append(VideoEffectsPanel.icon('fas fa-power-off'), document.createTextNode(` ${t('Turn off all')}`));
            all.addEventListener('click', () => this.turnOffAll());
            bar.appendChild(all);
        }
    }

    // Standalone chips (e.g. under the pre-join preview)
    mountActiveBar(container, { onOpen = null } = {}) {
        if (!container) return;
        this.barViews = this.barViews.filter((view) => view.container !== container);
        container.replaceChildren();
        const bar = VideoEffectsPanel.element('div', 'vfx-active vfx-active-floating', { role: 'group' });
        bar.setAttribute('aria-label', VideoEffectsPanel.t('Active effects'));
        container.appendChild(bar);
        this.barViews.push({ container, bar, onOpen });
        this.sync();
    }

    // ####################################################
    // MOUNT
    // ####################################################

    mount(container, { compact = false, preview = false, title = null, onClose = null } = {}) {
        if (!container) return null;
        const t = VideoEffectsPanel.t;
        this.views = this.views.filter((view) => view.container !== container);
        container.replaceChildren();

        const root = VideoEffectsPanel.element('div', compact ? 'vfx-panel vfx-compact' : 'vfx-panel');
        const view = {
            container,
            root,
            compact,
            tabs: new Map(),
            tabPanels: new Map(),
            effectCards: new Map(),
            effectGrids: new Map(),
            effectSignatures: new Map(),
            effectIds: new Map(),
            customAvatarControls: new Map(),
            presetCards: new Map(),
            sliders: new Map(),
        };

        if (title || onClose) {
            const header = VideoEffectsPanel.element('div', 'vfx-header');
            const heading = VideoEffectsPanel.element('span', 'vfx-title');
            heading.append(VideoEffectsPanel.icon('fas fa-wand-magic-sparkles'), document.createTextNode(` ${title}`));
            header.appendChild(heading);
            if (onClose) {
                const close = VideoEffectsPanel.element('button', 'vfx-close', { type: 'button' });
                close.setAttribute('aria-label', t('Close'));
                close.title = t('Close');
                close.appendChild(VideoEffectsPanel.icon('fas fa-xmark'));
                close.addEventListener('click', onClose);
                header.appendChild(close);
            }
            root.appendChild(header);
        }

        if (preview && this.preview) root.appendChild(this.buildPreview(view));

        view.activeBar = VideoEffectsPanel.element('div', 'vfx-active', { role: 'group' });
        view.activeBar.setAttribute('aria-label', t('Active effects'));
        root.appendChild(view.activeBar);

        view.status = VideoEffectsPanel.element('div', 'vfx-status hidden', { role: 'status', 'aria-live': 'polite' });
        root.appendChild(view.status);

        root.appendChild(this.buildTabs(view));
        this.availableTabs().forEach((tab) => root.appendChild(this.buildTabPanel(view, tab)));

        const privacy = VideoEffectsPanel.element('p', 'vfx-note');
        privacy.textContent = t('Effects are processed on your device. No video leaves your browser for processing.');
        root.appendChild(privacy);

        container.appendChild(root);
        this.views.push(view);
        this.startTicking();
        this.sync();
        return view;
    }

    buildPreview(view) {
        const t = VideoEffectsPanel.t;
        const box = VideoEffectsPanel.element('div', 'vfx-preview');
        const video = VideoEffectsPanel.element('video', null, { 'aria-label': t('Your camera preview') });
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        const off = VideoEffectsPanel.element('div', 'vfx-preview-off hidden');
        const offText = VideoEffectsPanel.element('span');
        offText.textContent = t('Turn on your camera to preview effects');
        off.append(VideoEffectsPanel.icon('fas fa-video-slash'), offText);
        if (this.camera?.turnOn) {
            const on = VideoEffectsPanel.element('button', 'vfx-link-btn', { type: 'button' });
            on.append(VideoEffectsPanel.icon('fas fa-video'), document.createTextNode(` ${t('Turn on camera')}`));
            on.addEventListener('click', () => this.camera.turnOn());
            off.appendChild(on);
        }
        box.append(video, off);
        view.preview = { box, video, off };
        return box;
    }

    buildTabs(view) {
        const list = VideoEffectsPanel.element('div', 'vfx-tabs', { role: 'tablist' });
        list.setAttribute('aria-label', VideoEffectsPanel.t('Visual effects'));
        this.availableTabs().forEach((tab) => {
            const button = VideoEffectsPanel.element('button', 'vfx-tab', {
                type: 'button',
                role: 'tab',
                'aria-selected': 'false',
                tabindex: '-1',
            });
            button.dataset.tab = tab;
            // Labels are hidden on phones (icons only): keep the accessible name
            button.setAttribute('aria-label', VideoEffectsPanel.tabLabel(tab));
            const dot = VideoEffectsPanel.element('span', 'vfx-tab-dot', { 'aria-hidden': 'true' });
            const label = VideoEffectsPanel.element('span');
            label.textContent = VideoEffectsPanel.tabLabel(tab);
            button.append(VideoEffectsPanel.icon(VideoEffectsPanel.tabIcon(tab)), label, dot);
            button.addEventListener('click', () => this.openTab(tab));
            list.appendChild(button);
            view.tabs.set(tab, button);
        });
        list.addEventListener('keydown', (event) => {
            const tabs = [...view.tabs.keys()];
            const index = tabs.indexOf(this.activeTab);
            const moves = { ArrowRight: 1, ArrowLeft: -1 };
            let next = index;
            if (event.key in moves) next = (index + moves[event.key] + tabs.length) % tabs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = tabs.length - 1;
            else return;
            event.preventDefault();
            this.openTab(tabs[next]);
            view.tabs.get(tabs[next]).focus();
        });
        return list;
    }

    buildTabPanel(view, tab) {
        const panel = VideoEffectsPanel.element('div', 'vfx-tabpanel', { role: 'tabpanel' });
        const id = `vfx-${tab}-${Math.random().toString(36).slice(2, 8)}`;
        panel.id = id;
        view.tabs.get(tab).setAttribute('aria-controls', id);
        if (tab === 'background') this.buildBackgroundTab(view, panel);
        else if (tab === 'filters') this.buildFiltersTab(view, panel);
        else this.buildEffectsTab(view, panel, tab);
        view.tabPanels.set(tab, panel);
        return panel;
    }

    buildEffectsTab(view, panel, category) {
        const t = VideoEffectsPanel.t;
        view[`${category}Unavailable`] = VideoEffectsPanel.element('p', 'vfx-unavailable hidden');
        panel.appendChild(view[`${category}Unavailable`]);
        const grid = VideoEffectsPanel.element('div', 'vfx-grid', { role: 'group' });
        grid.setAttribute('aria-label', VideoEffectsPanel.tabLabel(category));
        view.effectGrids.set(category, grid);
        this.renderEffectGrid(view, category);
        VideoEffectsPanel.setupRoving(grid, '.vfx-card');
        panel.appendChild(grid);
        if (category in VideoEffectsPanel.CUSTOM_AVATAR_PREFIXES) this.buildCustomAvatarControls(view, panel, category);
        panel.appendChild(this.createHint(t('One effect at a time. Choose it again to remove it.')));
    }

    // Cards of one effect tab; rebuilt when the list changes (custom avatars added or removed)
    renderEffectGrid(view, category) {
        const t = VideoEffectsPanel.t;
        const grid = view.effectGrids.get(category);
        if (!grid) return;
        const effects = this.engine.getEffects().filter((effect) => effect.category === category);
        const signature = effects.map((effect) => `${effect.id}:${effect.label}:${effect.thumbnail || ''}`).join('|');
        if (view.effectSignatures.get(category) === signature) return;
        view.effectSignatures.set(category, signature);
        (view.effectIds.get(category) || []).forEach((id) => view.effectCards.delete(id));
        view.effectIds.set(
            category,
            effects.map((effect) => effect.id)
        );
        grid.replaceChildren();
        effects.forEach((effect) => {
            const card = this.createCard({
                label: t(effect.label),
                image: effect.thumbnail,
                icon: effect.thumbnail ? null : 'fas fa-user-astronaut',
                // Every card of the 3D Avatars tab is 3D
                badge: effect.is3D && category !== 'avatar3d' ? '3D' : null,
                onClick: () => this.selectEffect(effect.id),
            });
            view.effectCards.set(effect.id, card);
            if (!this.customAvatars.has(effect.id)) {
                grid.appendChild(card);
                return;
            }
            const wrap = VideoEffectsPanel.element('div', 'vfx-card-wrap');
            const remove = VideoEffectsPanel.element('button', 'vfx-card-remove', { type: 'button' });
            remove.setAttribute('aria-label', t('Delete avatar'));
            remove.title = t('Delete avatar');
            remove.appendChild(VideoEffectsPanel.icon('fas fa-trash-can'));
            remove.addEventListener('click', () => this.removeCustomAvatar(effect.id));
            wrap.append(card, remove);
            grid.appendChild(wrap);
        });
    }

    // Own avatar from a link or a file, with a size slider for the one that is on: a .glb in the
    // 3D Avatars tab, a picture (placed on the face, no blinking) in the Avatars tab
    buildCustomAvatarControls(view, panel, category) {
        const t = VideoEffectsPanel.t;
        const isPicture = category !== 'avatar3d';
        const fileInput = VideoEffectsPanel.element('input', 'hidden', {
            type: 'file',
            accept: isPicture ? 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml' : '.glb,model/gltf-binary',
        });
        fileInput.addEventListener('change', async () => {
            const files = Array.from(fileInput.files || []);
            fileInput.value = '';
            await this.uploadCustomAvatar(category, files);
        });

        const row = VideoEffectsPanel.element('form', 'vfx-url-row');
        const input = VideoEffectsPanel.element('input', 'vfx-url-input', {
            type: 'url',
            inputmode: 'url',
            autocomplete: 'off',
        });
        const placeholder = isPicture ? t('Paste an image link') : t('Paste a .glb avatar link');
        input.placeholder = placeholder;
        input.setAttribute('aria-label', placeholder);
        const add = VideoEffectsPanel.element('button', 'vfx-link-btn', { type: 'submit' });
        add.append(VideoEffectsPanel.icon('fas fa-link'), document.createTextNode(` ${t('Add')}`));
        const upload = VideoEffectsPanel.element('button', 'vfx-link-btn', { type: 'button' });
        const uploadLabel = isPicture ? t('Upload an image') : t('Upload a .glb file');
        upload.title = uploadLabel;
        upload.setAttribute('aria-label', uploadLabel);
        upload.appendChild(VideoEffectsPanel.icon('fas fa-upload'));
        upload.addEventListener('click', () => fileInput.click());
        row.append(input, add, upload);
        row.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (await this.addCustomAvatarFromUrl(category, input.value)) input.value = '';
        });

        const error = VideoEffectsPanel.element('p', 'vfx-error hidden', { role: 'alert' });
        const size = this.createSlider({
            key: 'avatarSize',
            label: category === 'face' ? t('Size') : t('Avatar size'),
            icon: 'fas fa-maximize',
            min: VideoEffectsPanel.CUSTOM_SCALE_RANGES[category][0],
            max: VideoEffectsPanel.CUSTOM_SCALE_RANGES[category][1],
            step: 0.01,
            onInput: (value) => this.setCustomAvatarSize(value),
        });
        size.row.classList.add('hidden');

        let placementButtons = null;
        let placementRow = null;
        if (category === 'face') {
            placementRow = VideoEffectsPanel.element('div', 'vfx-placement', { role: 'group' });
            placementRow.setAttribute('aria-label', t('Place it on'));
            const labels = { head: t('Head'), eyes: t('Eyes'), nose: t('Nose'), mouth: t('Mouth') };
            placementButtons = new Map();
            Object.keys(VideoEffectsPanel.PLACEMENTS).forEach((key) => {
                const button = VideoEffectsPanel.element('button', 'vfx-link-btn', { type: 'button' });
                button.textContent = labels[key];
                button.addEventListener('click', () => this.setPlacement(key));
                placementButtons.set(key, button);
                placementRow.appendChild(button);
            });
        }

        view.customAvatarControls.set(category, { form: { input, add, upload }, error, size, placementButtons });
        const hint = {
            face: t(
                'Tip: add your own picture (PNG with a transparent background works best), then choose where it goes.'
            ),
            avatar: t(
                'Tip: add your own picture, for example a cartoon or a photo (PNG with a transparent background works best).'
            ),
            avatar3d: t('Tip: add your own 3D avatar (.glb), for example one from Ready Player Me.'),
        }[category];
        panel.append(...[placementRow, row, fileInput, error, size.row, this.createHint(hint)].filter(Boolean));
    }

    buildFiltersTab(view, panel) {
        const t = VideoEffectsPanel.t;
        const grid = VideoEffectsPanel.element('div', 'vfx-grid vfx-grid-presets', { role: 'group' });
        grid.setAttribute('aria-label', t('Filters'));
        this.engine.getFilterPresets().forEach((preset) => {
            if (preset.id === 'none') return;
            const card = this.createCard({
                label: t(preset.label),
                swatch: this.createPresetSwatch(preset),
                onClick: () => this.selectPreset(preset.id),
            });
            view.presetCards.set(preset.id, card);
            grid.appendChild(card);
        });
        // Shown while manual adjustments are in use
        const custom = this.createCard({
            label: t('Custom'),
            icon: 'fas fa-sliders',
            onClick: () => view.advanced.setAttribute('open', ''),
        });
        custom.classList.add('vfx-card-custom', 'hidden');
        view.customCard = custom;
        grid.appendChild(custom);
        VideoEffectsPanel.setupRoving(grid, '.vfx-card');
        panel.appendChild(grid);

        const friendly = VideoEffectsPanel.element('div', 'vfx-sliders');
        const touchUp = this.createSlider({
            key: 'touchUp',
            label: t('Touch up appearance'),
            icon: 'fas fa-wand-magic-sparkles',
            min: 0,
            max: 1,
            step: 0.01,
            onInput: (value) => this.setAdjustment('touchUp', value),
        });
        const lowLight = this.createSlider({
            key: 'lowLight',
            label: t('Adjust for low light'),
            icon: 'fas fa-lightbulb',
            min: 0,
            max: 1,
            step: 0.01,
            onInput: (value) => this.setAdjustment('lowLight', value),
        });
        view.sliders.set('touchUp', touchUp);
        view.sliders.set('lowLight', lowLight);
        view.touchUpNote = VideoEffectsPanel.element('p', 'vfx-hint hidden');
        view.touchUpNote.textContent = t('Touch up needs WebGL, which is not available on this device.');
        friendly.append(touchUp.row, view.touchUpNote, lowLight.row);
        panel.appendChild(friendly);

        const advanced = VideoEffectsPanel.element('details', 'vfx-advanced');
        const summary = VideoEffectsPanel.element('summary');
        summary.textContent = t('Advanced adjustments');
        advanced.appendChild(summary);
        const list = VideoEffectsPanel.element('div', 'vfx-sliders');
        VideoEffectsPanel.ADVANCED_SLIDERS.forEach((slider) => {
            const control = this.createSlider({
                ...slider,
                label: VideoEffectsPanel.sliderLabel(slider.key),
                onInput: (value) => this.setFilter(slider.key, value),
            });
            control.advanced = true;
            view.sliders.set(slider.key, control);
            list.appendChild(control.row);
        });
        const reset = VideoEffectsPanel.element('button', 'vfx-link-btn', { type: 'button' });
        reset.append(VideoEffectsPanel.icon('fas fa-rotate-left'), document.createTextNode(` ${t('Reset filters')}`));
        reset.addEventListener('click', () => this.resetFilters());
        list.appendChild(reset);
        advanced.appendChild(list);
        view.advanced = advanced;
        panel.appendChild(advanced);
    }

    buildBackgroundTab(view, panel) {
        const t = VideoEffectsPanel.t;
        const grid = VideoEffectsPanel.element('div', 'vfx-grid vfx-grid-backgrounds', { role: 'group' });
        grid.setAttribute('aria-label', t('Background'));
        VideoEffectsPanel.setupRoving(grid, '.vfx-card');
        grid.addEventListener('dragover', (event) => {
            event.preventDefault();
            grid.classList.add('drag-over');
        });
        grid.addEventListener('dragleave', () => grid.classList.remove('drag-over'));
        grid.addEventListener('drop', (event) => {
            event.preventDefault();
            grid.classList.remove('drag-over');
            this.uploadBackground(event.dataTransfer?.files);
        });
        view.backgroundGrid = grid;

        const fileInput = VideoEffectsPanel.element('input', 'hidden', { type: 'file', accept: 'image/*' });
        fileInput.multiple = true;
        fileInput.addEventListener('change', async () => {
            const files = Array.from(fileInput.files || []);
            fileInput.value = '';
            await this.uploadBackground(files);
        });
        view.backgroundFileInput = fileInput;

        const urlRow = VideoEffectsPanel.element('form', 'vfx-url-row');
        const urlInput = VideoEffectsPanel.element('input', 'vfx-url-input', {
            type: 'url',
            inputmode: 'url',
            autocomplete: 'off',
        });
        urlInput.placeholder = t('Paste an image link');
        urlInput.setAttribute('aria-label', t('Paste an image link'));
        const urlButton = VideoEffectsPanel.element('button', 'vfx-link-btn', { type: 'submit' });
        urlButton.append(VideoEffectsPanel.icon('fas fa-link'), document.createTextNode(` ${t('Add')}`));
        urlRow.append(urlInput, urlButton);
        urlRow.addEventListener('submit', async (event) => {
            event.preventDefault();
            urlButton.disabled = true;
            if (await this.addBackgroundFromUrl(urlInput.value)) urlInput.value = '';
            urlButton.disabled = false;
        });
        view.urlError = VideoEffectsPanel.element('p', 'vfx-error hidden', { role: 'alert' });

        panel.append(
            grid,
            fileInput,
            urlRow,
            view.urlError,
            this.createHint(t('Tip: drop images here to upload them.'))
        );
    }

    renderBackgroundGrid(view) {
        const grid = view.backgroundGrid;
        if (!grid || !this.background) return;
        const t = VideoEffectsPanel.t;
        const presets = this.background.getPresetImages();
        const custom = this.background.getCustomImages();
        const selectedImage = this.background.getSelection().imageUrl;
        const images = [...new Set([...presets, ...custom])];
        if (selectedImage && !images.includes(selectedImage)) images.unshift(selectedImage);
        const signature = `${images.join('|')}#${custom.join('|')}`;
        if (view.backgroundSignature !== signature) {
            view.backgroundSignature = signature;
            grid.replaceChildren();
            view.backgroundCards = [];
            const add = (key, options, removable = false) => {
                const card = this.createCard(options);
                card.dataset.key = key;
                view.backgroundCards.push(card);
                if (!removable) {
                    grid.appendChild(card);
                    return;
                }
                const wrap = VideoEffectsPanel.element('div', 'vfx-card-wrap');
                const remove = VideoEffectsPanel.element('button', 'vfx-card-remove', { type: 'button' });
                remove.setAttribute('aria-label', t('Delete image'));
                remove.title = t('Delete image');
                remove.appendChild(VideoEffectsPanel.icon('fas fa-trash-can'));
                remove.addEventListener('click', () => this.removeCustomBackground(key.slice('image:'.length)));
                wrap.append(card, remove);
                grid.appendChild(wrap);
            };
            add('blur-10', {
                label: t('Blur'),
                icon: 'fas fa-droplet',
                onClick: () => this.selectBackground('blur-10'),
            });
            add('blur-20', {
                label: t('Strong blur'),
                icon: 'fas fa-water',
                onClick: () => this.selectBackground('blur-20'),
            });
            if (this.background.supportsTransparent?.()) {
                add('transparent', {
                    label: t('Transparent'),
                    icon: 'fas fa-border-none',
                    onClick: () => this.selectBackground('transparent'),
                });
            }
            if (this.background.upload) {
                add('upload', {
                    label: t('Upload'),
                    icon: 'fas fa-upload',
                    toggle: false,
                    onClick: () => view.backgroundFileInput.click(),
                });
            }
            images.forEach((url) => {
                add(
                    `image:${url}`,
                    { label: t('Background image'), image: url, onClick: () => this.selectBackground(`image:${url}`) },
                    custom.includes(url)
                );
            });
        }
        const selectedKey = this.backgroundKey();
        view.backgroundCards.forEach((card) => {
            if (card.hasAttribute('aria-pressed')) {
                const selected = card.dataset.key === selectedKey;
                card.classList.toggle('active', selected);
                card.setAttribute('aria-pressed', String(selected));
            }
            card.disabled = this.backgroundBusy;
        });
        VideoEffectsPanel.updateRoving(grid, '.vfx-card');
        view.urlError.textContent = this.urlError;
        view.urlError.classList.toggle('hidden', !this.urlError);
    }

    renderCustomAvatarControls(view, state) {
        view.customAvatarControls.forEach(({ form, error, size, placementButtons }, category) => {
            const { input, add, upload } = form;
            if (placementButtons) {
                const accessory = this.customAvatars.get(state.effect);
                const current = accessory?.category === category ? accessory.placement : this.placement;
                placementButtons.forEach((button, key) => {
                    button.classList.toggle('active', key === current);
                    button.setAttribute('aria-pressed', String(key === current));
                    button.disabled = this.avatarBusy;
                });
            }
            add.disabled = upload.disabled = input.disabled = this.avatarBusy;
            error.textContent = this.avatarErrors[category];
            error.classList.toggle('hidden', !this.avatarErrors[category]);
            const active = this.customAvatars.get(state.effect);
            const shown = active?.category === category;
            size.row.classList.toggle('hidden', !shown);
            if (!shown) return;
            const { input: slider, value } = size;
            if (document.activeElement !== slider) slider.value = String(active.scale);
            value.textContent = `${Math.round(active.scale * 100)}%`;
        });
    }

    // ####################################################
    // LIVE PREVIEW AND PERIODIC REFRESH
    // ####################################################

    startTicking() {
        if (this.tickTimer) return;
        this.tickTimer = setInterval(() => this.tick(), 1000);
    }

    tick() {
        this.views = this.views.filter((view) => view.root.isConnected);
        this.barViews = this.barViews.filter((view) => view.bar.isConnected);
        if (!this.views.length && !this.barViews.length) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
            return;
        }
        // Background images uploaded elsewhere (e.g. the video menu) show up without reopening
        this.sync();
    }

    updatePreview(view) {
        const preview = view.preview;
        if (!preview) return;
        const visible = view.root.offsetParent !== null;
        const stream = visible ? this.preview.getStream() : null;
        const track = stream?.getVideoTracks?.()[0];
        const live = !!track && track.readyState === 'live';
        preview.off.classList.toggle('hidden', live || !visible);
        preview.video.classList.toggle('hidden', !live);
        if (!live) {
            if (preview.video.srcObject) preview.video.srcObject = null;
            return;
        }
        if (preview.video.srcObject !== stream) {
            preview.video.srcObject = stream;
            preview.video.play().catch(() => {});
        }
        preview.video.classList.toggle('mirror', !!this.preview.isMirrored?.());
    }

    // ####################################################
    // STATUS
    // ####################################################

    statusMessage(state, view) {
        const t = VideoEffectsPanel.t;
        const faceSelected = !!state.effect;
        if (this.camera && !this.camera.isOn() && !view.preview) {
            return {
                level: 'info',
                text: t('Your camera is off. Effects will be applied when you turn it on.'),
                action: this.camera.turnOn ? { label: t('Turn on camera'), run: () => this.camera.turnOn() } : null,
            };
        }
        if (faceSelected && state.faceTracking === 'loading') {
            return { level: 'loading', text: t('Preparing effects...') };
        }
        if (state.running && state.slow) {
            return {
                level: 'warning',
                text: t('Effects are running slowly on this device. Turning some of them off will help.'),
            };
        }
        if (faceSelected && state.running && state.faceTracking === 'ready' && !state.faceDetected) {
            return { level: 'info', text: t('Looking for your face...') };
        }
        return null;
    }

    renderStatus(view, message) {
        const status = view.status;
        status.classList.toggle('hidden', !message);
        status.dataset.level = message?.level || '';
        const signature = message ? `${message.level}:${message.text}` : '';
        if (status.__vfxSignature === signature) return;
        status.__vfxSignature = signature;
        status.replaceChildren();
        if (!message) return;
        const icons = {
            loading: 'fas fa-circle-notch fa-spin',
            warning: 'fas fa-gauge-high',
            error: 'fas fa-triangle-exclamation',
            info: 'fas fa-circle-info',
        };
        status.append(VideoEffectsPanel.icon(icons[message.level] || icons.info));
        const text = VideoEffectsPanel.element('span');
        text.textContent = message.text;
        status.appendChild(text);
        if (message.action) {
            const action = VideoEffectsPanel.element('button', 'vfx-link-btn', { type: 'button' });
            action.textContent = message.action.label;
            action.addEventListener('click', message.action.run);
            status.appendChild(action);
        }
    }

    // ####################################################
    // SYNC: every view follows the engine and background state
    // ####################################################

    defaultTab(state) {
        const tabs = this.availableTabs();
        const effect = state.effect ? this.effectMeta(state.effect) : null;
        if (effect) return VideoEffectsPanel.effectTab(effect);
        if (this.hasBackground() && this.backgroundKey()) return 'background';
        return tabs[0];
    }

    sync() {
        const state = this.engine.getState();
        const tabs = this.availableTabs();
        if (!tabs.includes(this.activeTab)) this.activeTab = this.defaultTab(state);
        const selectedEffect = this.loadingEffect || state.effect;
        const effectMeta = selectedEffect ? this.effectMeta(selectedEffect) : null;
        const faceUnavailable = this.faceUnavailableReason(state);
        const backgroundOn = this.hasBackground() && !!this.backgroundKey();
        const filtersOn =
            state.filterPreset !== 'none' || state.adjustments.touchUp > 0 || state.adjustments.lowLight > 0;
        const tabOn = { background: backgroundOn, filters: filtersOn };
        if (effectMeta) tabOn[VideoEffectsPanel.effectTab(effectMeta)] = true;

        this.views = this.views.filter((view) => view.root.isConnected);
        this.views.forEach((view) => {
            view.tabs.forEach((button, tab) => {
                const selected = tab === this.activeTab;
                button.classList.toggle('active', selected);
                button.setAttribute('aria-selected', String(selected));
                button.setAttribute('tabindex', selected ? '0' : '-1');
                button.classList.toggle('vfx-tab-on', !!tabOn[tab]);
            });
            view.tabPanels.forEach((panel, tab) => panel.classList.toggle('hidden', tab !== this.activeTab));

            VideoEffectsPanel.EFFECT_TABS.forEach((category) => this.renderEffectGrid(view, category));
            view.effectCards.forEach((card, id) => {
                const selected = id === selectedEffect;
                card.classList.toggle('active', selected);
                card.classList.toggle('loading', id === this.loadingEffect);
                card.setAttribute('aria-pressed', String(selected));
                card.disabled = !!faceUnavailable;
            });
            VideoEffectsPanel.EFFECT_TABS.forEach((category) => {
                const note = view[`${category}Unavailable`];
                if (!note) return;
                note.textContent = faceUnavailable || '';
                note.classList.toggle('hidden', !faceUnavailable);
                const grid = view.tabPanels.get(category)?.querySelector('.vfx-grid');
                if (grid) VideoEffectsPanel.updateRoving(grid, '.vfx-card');
            });

            this.renderCustomAvatarControls(view, state);

            view.presetCards.forEach((card, id) => {
                const selected = id === state.filterPreset;
                card.classList.toggle('active', selected);
                card.setAttribute('aria-pressed', String(selected));
            });
            if (view.customCard) {
                const custom = state.filterPreset === null;
                view.customCard.classList.toggle('hidden', !custom);
                view.customCard.classList.toggle('active', custom);
                view.customCard.setAttribute('aria-pressed', String(custom));
                const grid = view.tabPanels.get('filters')?.querySelector('.vfx-grid');
                if (grid) VideoEffectsPanel.updateRoving(grid, '.vfx-card');
            }
            view.sliders.forEach(({ key, input, value, row, advanced }) => {
                const current = advanced ? state.filters[key] : state.adjustments[key];
                if (document.activeElement !== input) input.value = String(current);
                value.textContent =
                    key === 'temperature'
                        ? `${current > 0 ? '+' : ''}${Math.round(current * 100)}`
                        : `${Math.round(current * 100)}%`;
                const unavailable = key === 'touchUp' && !!state.renderer && !state.capabilities.smoothing;
                input.disabled = unavailable;
                row.classList.toggle('disabled', unavailable);
            });
            if (view.touchUpNote) {
                view.touchUpNote.classList.toggle('hidden', !(state.renderer && !state.capabilities.smoothing));
            }

            this.renderBackgroundGrid(view);
            this.renderActiveBar(view.activeBar);
            this.renderStatus(view, this.statusMessage(state, view));
            this.updatePreview(view);
        });

        this.barViews = this.barViews.filter((view) => view.bar.isConnected);
        this.barViews.forEach((view) => {
            this.renderActiveBar(view.bar, view);
            view.container.classList.toggle('hidden', !this.isAnythingActive());
        });
        this.onStateChange(this.isAnythingActive());
    }

    destroy() {
        clearTimeout(this.saveTimer);
        clearInterval(this.tickTimer);
        this.tickTimer = null;
        this.unsubscribe.forEach((unsubscribe) => unsubscribe());
        this.views.forEach((view) => view.root.remove());
        this.barViews.forEach((view) => view.bar.remove());
        this.views = [];
        this.barViews = [];
    }
}

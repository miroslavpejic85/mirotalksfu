'use strict';

/**
 * MiroTalk Video Effects - Visual effects panel.
 *
 * One component for "how I look on camera", mounted in Settings and in the pre-join lobby:
 * tabs Background / Effects / Avatars / Filters, removable chips for what is on with a
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

    static TABS = ['background', 'face', 'avatar', 'filters'];

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
            default:
                return t('Filters');
        }
    }

    static tabIcon(tab) {
        return {
            background: 'fas fa-image',
            face: 'fas fa-face-smile',
            avatar: 'fas fa-masks-theater',
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
                tab: meta?.category === 'avatar' ? 'avatar' : 'face',
                label: meta?.label ? t(meta.label) : state.effect,
                thumb: meta?.thumbnail || null,
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
        this.engine
            .getEffects()
            .filter((effect) => effect.category === category)
            .forEach((effect) => {
                const card = this.createCard({
                    label: t(effect.label),
                    image: effect.thumbnail,
                    badge: effect.is3D ? '3D' : null,
                    onClick: () => this.selectEffect(effect.id),
                });
                view.effectCards.set(effect.id, card);
                grid.appendChild(card);
            });
        VideoEffectsPanel.setupRoving(grid, '.vfx-card');
        panel.append(grid, this.createHint(t('One effect at a time. Choose it again to remove it.')));
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
        if (effect) return effect.category === 'avatar' ? 'avatar' : 'face';
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
        const tabOn = {
            background: backgroundOn,
            face: effectMeta?.category === 'face',
            avatar: effectMeta?.category === 'avatar',
            filters: filtersOn,
        };

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

            view.effectCards.forEach((card, id) => {
                const selected = id === selectedEffect;
                card.classList.toggle('active', selected);
                card.classList.toggle('loading', id === this.loadingEffect);
                card.setAttribute('aria-pressed', String(selected));
                card.disabled = !!faceUnavailable;
            });
            ['face', 'avatar'].forEach((category) => {
                const note = view[`${category}Unavailable`];
                if (!note) return;
                note.textContent = faceUnavailable || '';
                note.classList.toggle('hidden', !faceUnavailable);
                const grid = view.tabPanels.get(category)?.querySelector('.vfx-grid');
                if (grid) VideoEffectsPanel.updateRoving(grid, '.vfx-card');
            });

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

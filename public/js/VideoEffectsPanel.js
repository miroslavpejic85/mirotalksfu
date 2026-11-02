'use strict';

/**
 * MiroTalk Video Effects - Effects panel.
 *
 * Builds the Effects UI (face effects, filters) on top of the MiroTalkVideoEffects engine. The
 * panel can be mounted in several places (Settings > Effects, pre-join lobby); every mounted view
 * follows the engine state. The selection is saved in localStorage.
 *
 * Backgrounds stay in their own Settings tab (VirtualBackground.js); `openBackgroundSettings`
 * only adds a shortcut to it.
 */
class VideoEffectsPanel {
    static STORAGE_KEY = 'videoEffectsSettings';

    static SLIDERS = [
        { key: 'brightness', icon: 'fas fa-sun', min: 0.5, max: 1.5, step: 0.01 },
        { key: 'contrast', icon: 'fas fa-circle-half-stroke', min: 0.5, max: 1.5, step: 0.01 },
        { key: 'saturation', icon: 'fas fa-droplet', min: 0, max: 2, step: 0.01 },
        { key: 'temperature', icon: 'fas fa-temperature-half', min: -1, max: 1, step: 0.01 },
        { key: 'smoothing', icon: 'fas fa-wand-magic-sparkles', min: 0, max: 1, step: 0.01 },
    ];

    constructor(engine, { onChange = async () => {}, openBackgroundSettings = null } = {}) {
        this.engine = engine;
        this.onChange = onChange;
        this.openBackgroundSettings = openBackgroundSettings;
        this.views = [];
        this.loadingEffect = null;
        this.saveTimer = null;
        this.unsubscribe = [
            engine.on('state', () => this.sync()),
            engine.on('error', ({ stage }) => this.handleEngineError(stage)),
        ];
    }

    static t(text) {
        return window.i18n && typeof window.i18n.t === 'function' ? window.i18n.t(text) : text;
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
            case 'smoothing':
                return t('Skin smoothing');
            default:
                return key;
        }
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
            const settings = { effect: state.effect, filterPreset: state.filterPreset, filters: state.filters };
            try {
                localStorage.setItem(VideoEffectsPanel.STORAGE_KEY, JSON.stringify(settings));
            } catch (error) {
                console.warn('Unable to save the video effects', error);
            }
        }, 250);
    }

    // ####################################################
    // ACTIONS
    // ####################################################

    async selectEffect(id) {
        this.loadingEffect = id;
        this.sync();
        try {
            await this.engine.setEffect(id === 'none' ? null : id);
            this.saveSettings();
            await this.onChange();
        } catch (error) {
            console.error('Unable to apply the video effect', error);
            if (typeof userLog === 'function') {
                userLog('warning', 'This effect could not be loaded. Please try again.', 'top-end', 6000);
            }
        } finally {
            if (this.loadingEffect === id) this.loadingEffect = null;
            this.sync();
        }
    }

    async selectPreset(id) {
        this.engine.setFilterPreset(id);
        this.saveSettings();
        await this.onChange();
    }

    async setFilter(key, value) {
        this.engine.setFilters({ [key]: Number(value) });
        this.saveSettings();
        await this.onChange();
    }

    async resetFilters() {
        this.engine.resetFilters();
        this.saveSettings();
        await this.onChange();
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
    // UI
    // ####################################################

    static element(tag, className, attributes = {}) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value));
        return el;
    }

    createSection(iconClass, title) {
        const section = VideoEffectsPanel.element('div', 'vfx-section');
        const header = VideoEffectsPanel.element('div', 'vfx-section-header');
        const icon = VideoEffectsPanel.element('i', iconClass, { 'aria-hidden': 'true' });
        const label = VideoEffectsPanel.element('span');
        label.textContent = title;
        header.append(icon, label);
        section.appendChild(header);
        return section;
    }

    createCard({ label, image = null, icon = null, badge = null, swatch = null, onClick }) {
        const card = VideoEffectsPanel.element('button', 'vfx-card', { type: 'button', role: 'radio' });
        card.setAttribute('aria-checked', 'false');
        card.setAttribute('aria-label', label);
        const thumb = VideoEffectsPanel.element('span', 'vfx-thumb', { 'aria-hidden': 'true' });
        if (image) {
            const img = VideoEffectsPanel.element('img', null, { alt: '', loading: 'lazy', decoding: 'async' });
            img.src = image;
            img.draggable = false;
            thumb.appendChild(img);
        } else if (swatch) {
            thumb.appendChild(swatch);
        } else if (icon) {
            thumb.appendChild(VideoEffectsPanel.element('i', icon));
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

    mount(container, { backgroundLink = false, sliders = true, compact = false } = {}) {
        if (!container) return null;
        const t = VideoEffectsPanel.t;
        this.views = this.views.filter((view) => view.container !== container);
        container.replaceChildren();

        const root = VideoEffectsPanel.element('div', compact ? 'vfx-panel vfx-compact' : 'vfx-panel');
        const status = VideoEffectsPanel.element('div', 'vfx-status hidden', { role: 'status', 'aria-live': 'polite' });
        root.appendChild(status);

        const view = { container, root, status, effectCards: [], presetCards: new Map(), sliders: new Map() };

        // Face accessories and head avatars: one selection, shown in two sections
        const sections = [
            { category: 'face', icon: 'fas fa-face-smile', title: t('Face effects') },
            { category: 'avatar', icon: 'fas fa-masks-theater', title: t('Avatars') },
        ];
        const effects = this.engine.getEffects();
        sections.forEach(({ category, icon, title }) => {
            const items = effects.filter((effect) => effect.category === category);
            if (!items.length) return;
            const section = this.createSection(icon, title);
            const grid = VideoEffectsPanel.element('div', 'vfx-grid', { role: 'radiogroup' });
            grid.setAttribute('aria-label', title);
            const noneCard = this.createCard({
                label: t('None'),
                icon: 'fas fa-ban',
                onClick: () => this.selectEffect('none'),
            });
            view.effectCards.push({ id: 'none', card: noneCard });
            grid.appendChild(noneCard);
            items.forEach((effect) => {
                const card = this.createCard({
                    label: effect.label,
                    image: effect.thumbnail,
                    badge: effect.is3D ? '3D' : null,
                    onClick: () => this.selectEffect(effect.id),
                });
                view.effectCards.push({ id: effect.id, card });
                grid.appendChild(card);
            });
            section.appendChild(grid);
            root.appendChild(section);
        });

        // Filters
        const filterSection = this.createSection('fas fa-palette', t('Filters'));
        const presetGrid = VideoEffectsPanel.element('div', 'vfx-grid vfx-grid-presets', { role: 'radiogroup' });
        presetGrid.setAttribute('aria-label', t('Filters'));
        this.engine.getFilterPresets().forEach((preset) => {
            const card = this.createCard({
                label: preset.label,
                swatch: preset.id === 'none' ? null : this.createPresetSwatch(preset),
                icon: preset.id === 'none' ? 'fas fa-ban' : null,
                onClick: () => this.selectPreset(preset.id),
            });
            view.presetCards.set(preset.id, card);
            presetGrid.appendChild(card);
        });
        filterSection.appendChild(presetGrid);

        if (sliders) {
            const sliderList = VideoEffectsPanel.element('div', 'vfx-sliders');
            VideoEffectsPanel.SLIDERS.forEach((slider) => {
                const row = VideoEffectsPanel.element('label', 'vfx-slider');
                const name = VideoEffectsPanel.element('span', 'vfx-slider-name');
                name.append(VideoEffectsPanel.element('i', slider.icon, { 'aria-hidden': 'true' }));
                const nameText = VideoEffectsPanel.element('span');
                nameText.textContent = VideoEffectsPanel.sliderLabel(slider.key);
                name.appendChild(nameText);
                const input = VideoEffectsPanel.element('input', 'vfx-range', {
                    type: 'range',
                    min: slider.min,
                    max: slider.max,
                    step: slider.step,
                });
                const value = VideoEffectsPanel.element('span', 'vfx-slider-value');
                input.addEventListener('input', () => this.setFilter(slider.key, input.value));
                row.append(name, input, value);
                sliderList.appendChild(row);
                view.sliders.set(slider.key, { row, input, value, slider });
            });
            const reset = VideoEffectsPanel.element('button', 'vfx-link-btn', { type: 'button' });
            reset.append(VideoEffectsPanel.element('i', 'fas fa-rotate-left', { 'aria-hidden': 'true' }));
            reset.append(document.createTextNode(' Reset filters'));
            reset.addEventListener('click', () => this.resetFilters());
            sliderList.appendChild(reset);
            filterSection.appendChild(sliderList);
        }
        root.appendChild(filterSection);

        // Backgrounds have their own Settings tab: shortcut only, no duplicate picker
        if (backgroundLink && this.openBackgroundSettings) {
            const more = VideoEffectsPanel.element('button', 'vfx-link-btn', { type: 'button' });
            more.append(VideoEffectsPanel.element('i', 'fas fa-image', { 'aria-hidden': 'true' }));
            more.append(document.createTextNode(' Background options'));
            more.addEventListener('click', () => this.openBackgroundSettings());
            root.appendChild(more);
        }

        const privacy = VideoEffectsPanel.element('p', 'vfx-note');
        privacy.textContent = 'Effects are processed on your device. No video leaves your browser for processing.';
        root.appendChild(privacy);

        container.appendChild(root);
        this.views.push(view);
        this.sync();
        return view;
    }

    statusMessage(state) {
        if (!state.capabilities.webgl && state.renderer) {
            return { level: 'info', text: 'WebGL is not available: skin smoothing is disabled.' };
        }
        if (!state.effect) return null;
        if (state.faceTracking === 'loading') return { level: 'loading', text: 'Loading face tracking...' };
        if (state.faceTracking === 'error') {
            return { level: 'error', text: 'Face tracking is not available on this device.' };
        }
        if (state.running && state.faceTracking === 'ready' && !state.faceDetected) {
            return { level: 'info', text: 'Looking for your face...' };
        }
        return null;
    }

    sync() {
        if (!this.views.length) return;
        const state = this.engine.getState();
        const selectedEffect = this.loadingEffect || state.effect || 'none';
        const message = this.statusMessage(state);
        this.views = this.views.filter((view) => view.root.isConnected);
        this.views.forEach((view) => {
            view.effectCards.forEach(({ id, card }) => {
                const selected = id === selectedEffect;
                card.classList.toggle('active', selected);
                card.classList.toggle('loading', id === this.loadingEffect);
                card.setAttribute('aria-checked', String(selected));
            });
            view.presetCards.forEach((card, id) => {
                const selected = id === state.filterPreset;
                card.classList.toggle('active', selected);
                card.setAttribute('aria-checked', String(selected));
            });
            view.sliders.forEach(({ row, input, value, slider }) => {
                const current = state.filters[slider.key];
                if (document.activeElement !== input) input.value = String(current);
                value.textContent =
                    slider.key === 'temperature'
                        ? `${current > 0 ? '+' : ''}${Math.round(current * 100)}`
                        : `${Math.round(current * 100)}%`;
                // Unknown until the renderer exists: only disable once it is known to lack WebGL
                const unavailable = slider.key === 'smoothing' && !!state.renderer && !state.capabilities.smoothing;
                input.disabled = unavailable;
                row.classList.toggle('disabled', unavailable);
            });
            view.status.classList.toggle('hidden', !message);
            view.status.dataset.level = message?.level || '';
            if (view.status.__vfxText !== message?.text) {
                view.status.__vfxText = message?.text;
                view.status.replaceChildren();
                if (message) {
                    if (message.level === 'loading') {
                        view.status.append(VideoEffectsPanel.element('i', 'fas fa-circle-notch fa-spin'));
                    }
                    view.status.append(document.createTextNode(` ${VideoEffectsPanel.t(message.text)}`));
                }
            }
        });
    }

    destroy() {
        clearTimeout(this.saveTimer);
        this.unsubscribe.forEach((unsubscribe) => unsubscribe());
        this.views.forEach((view) => view.root.remove());
        this.views = [];
    }
}

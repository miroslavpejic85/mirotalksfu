'use strict';

/**
 * MiroTalk Video Effects - effects registry and accessory placement.
 *
 * Effects are plain descriptors registered with MiroTalkVFX.registerEffect() (see effects/*.js).
 * A face effect is a list of image layers, each attached to a face anchor and sized in units of
 * the eye distance, so accessories follow position, scale and the full 3D head rotation. An
 * optional `model` entry adds a GLB/GLTF accessory rendered by the 3D model renderer.
 */
(function (root) {
    const VFX = (root.MiroTalkVFX = root.MiroTalkVFX || {});
    const { vec3, clamp } = VFX;

    // Named anchors: averages of MediaPipe face mesh landmarks
    const ANCHORS = Object.freeze({
        eyes: [33, 133, 263, 362],
        rightEye: [33, 133],
        leftEye: [263, 362],
        rightIris: [468],
        leftIris: [473],
        noseBridge: [168],
        noseTip: [1],
        noseBottom: [2],
        upperLip: [0],
        mustache: [2, 0],
        mouth: [13, 14],
        chin: [152],
        forehead: [10],
    });

    const FILTER_LIMITS = Object.freeze({
        brightness: [0.5, 1.5],
        contrast: [0.5, 1.5],
        saturation: [0, 2],
        grayscale: [0, 1],
        sepia: [0, 1],
        temperature: [-1, 1],
        smoothing: [0, 1],
    });

    const effects = new Map();
    const filterPresets = new Map();

    /**
     * Expression-driven animation. Each property takes one spec or a list of specs:
     * - opacity, scaleY: specs are multiplied (e.g. hidden while talking OR smiling)
     * - offsetY: specs are added, in eye distances (or canvas pixels for registerAvatar parts)
     * A spec maps smoothstep(from, to, expression) to [min, max], optionally inverted.
     */
    const DRIVE_PROPERTIES = Object.freeze({ opacity: 'product', scaleY: 'product', offsetY: 'sum' });

    function normalizeDriveSpec(spec, property, effectId) {
        if (!spec || !VFX.EXPRESSIONS.includes(spec.expression)) {
            throw new TypeError(`Effect "${effectId}": unknown expression "${spec?.expression}"`);
        }
        const from = spec.from ?? 0;
        const to = spec.to ?? 1;
        if (!(to > from)) throw new TypeError(`Effect "${effectId}": drive "to" must be greater than "from"`);
        const isOffset = property === 'offsetY';
        return {
            expression: spec.expression,
            from,
            to,
            invert: !!spec.invert,
            min: spec.min ?? 0,
            max: spec.max ?? (isOffset ? 0 : 1),
        };
    }

    function validateDrive(drive, effectId) {
        if (!drive) return null;
        const normalized = {};
        for (const property of Object.keys(drive)) {
            if (!DRIVE_PROPERTIES[property]) {
                throw new TypeError(`Effect "${effectId}": unknown drive property "${property}"`);
            }
            const specs = Array.isArray(drive[property]) ? drive[property] : [drive[property]];
            if (!specs.length) continue;
            normalized[property] = specs.map((spec) => normalizeDriveSpec(spec, property, effectId));
        }
        return Object.keys(normalized).length ? normalized : null;
    }

    function driveValue(spec, expressions) {
        let t = VFX.smoothstep(spec.from, spec.to, expressions?.[spec.expression] ?? 0);
        if (spec.invert) t = 1 - t;
        return spec.min + (spec.max - spec.min) * t;
    }

    function driveProperty(specs, property, expressions) {
        if (DRIVE_PROPERTIES[property] === 'sum') {
            return specs.reduce((total, spec) => total + driveValue(spec, expressions), 0);
        }
        return specs.reduce((total, spec) => total * driveValue(spec, expressions), 1);
    }

    function validateLayer(layer, effectId) {
        if (!layer || typeof layer.asset !== 'string' || !layer.asset) {
            throw new TypeError(`Effect "${effectId}": every layer needs an asset path`);
        }
        const anchor = layer.anchor || 'eyes';
        const indices = Array.isArray(anchor) ? anchor : ANCHORS[anchor];
        if (!indices || !indices.length || indices.some((i) => !Number.isInteger(i) || i < 0 || i > 477)) {
            throw new TypeError(`Effect "${effectId}": unknown anchor "${anchor}"`);
        }
        if (!(layer.width > 0)) throw new TypeError(`Effect "${effectId}": layer width must be > 0`);
        return {
            anchor: indices,
            offset: layer.offset || [0, 0, 0],
            pivot: layer.pivot || [0.5, 0.5],
            roll: layer.roll || 0,
            tilt: layer.tilt || 0,
            flipX: !!layer.flipX,
            opacity: layer.opacity ?? 1,
            width: layer.width,
            asset: layer.asset,
            drive: validateDrive(layer.drive, effectId),
        };
    }

    function registerEffect(definition) {
        if (!definition || typeof definition.id !== 'string' || !definition.id) {
            throw new TypeError('An effect needs a string id');
        }
        const layers = (definition.layers || []).map((layer) => validateLayer(layer, definition.id));
        if (!layers.length && !definition.model) {
            throw new TypeError(`Effect "${definition.id}" needs image layers or a 3D model`);
        }
        let model = null;
        if (definition.model) {
            if (typeof definition.model.asset !== 'string') {
                throw new TypeError(`Effect "${definition.id}": model.asset is required`);
            }
            const clipY = definition.model.clipY;
            if (clipY !== undefined && clipY !== null && !Number.isFinite(clipY)) {
                throw new TypeError(`Effect "${definition.id}": model.clipY must be a number`);
            }
            model = {
                anchor: validateLayer(
                    { asset: definition.model.asset, anchor: definition.model.anchor, width: 1 },
                    definition.id
                ).anchor,
                offset: definition.model.offset || [0, 0, 0],
                scale: definition.model.scale || 1,
                occluder: definition.model.occluder !== false,
                // Avatar: morph targets follow the blendshapes, realistic lighting, optional neck rig
                avatar: !!definition.model.avatar,
                clipY: Number.isFinite(clipY) ? clipY : null,
                asset: definition.model.asset,
            };
        }
        const effect = Object.freeze({
            id: definition.id,
            label: definition.label || definition.id,
            category: definition.category || 'face',
            order: definition.order ?? 100,
            thumbnail: definition.thumbnail || layers[0]?.asset || null,
            layers,
            model,
        });
        effects.set(effect.id, effect);
        return effect;
    }

    /**
     * Animated 2D head avatar drawn on one canvas (e.g. 600x640) and split into parts (head, eyes,
     * mouth). `eyes` is the canvas point placed between the user's eyes, `width` the canvas width in
     * eye distances. Each part declares its `box` [x, y, w, h] on that canvas and an optional `drive`.
     */
    function registerAvatar(definition) {
        const [canvasWidth] = definition.size || [];
        const [eyesX, eyesY] = definition.eyes || [];
        if (!(canvasWidth > 0) || !Number.isFinite(eyesX) || !Number.isFinite(eyesY) || !(definition.width > 0)) {
            throw new TypeError(`Avatar "${definition.id}" needs size, eyes and width`);
        }
        const unit = definition.width / canvasWidth;
        return registerEffect({
            id: definition.id,
            label: definition.label,
            order: definition.order,
            category: 'avatar',
            thumbnail: definition.thumbnail,
            layers: (definition.parts || []).map((part) => {
                const [x, y, w, h] = part.box || [];
                if (![x, y, w, h].every(Number.isFinite) || !(w > 0) || !(h > 0)) {
                    throw new TypeError(`Avatar "${definition.id}": every part needs a box [x, y, w, h]`);
                }
                let drive = part.drive;
                if (drive?.offsetY) {
                    const toUnits = (spec) => ({ ...spec, min: (spec.min ?? 0) * unit, max: (spec.max ?? 0) * unit });
                    const specs = Array.isArray(drive.offsetY) ? drive.offsetY : [drive.offsetY];
                    drive = { ...drive, offsetY: specs.map(toUnits) };
                }
                return {
                    asset: part.asset,
                    anchor: 'eyes',
                    width: w * unit,
                    // Mirrored parts grow leftwards: anchor their (image) left edge on the box right edge
                    offset: [((part.flipX ? x + w : x) - eyesX) * unit, (y - eyesY) * unit, 0],
                    pivot: [0, 0],
                    flipX: part.flipX,
                    drive,
                };
            }),
        });
    }

    /**
     * Realistic 3D avatar (GLB) following the engine model convention (see model-renderer.js) with
     * morph targets named like the MediaPipe blendshapes (eyeBlinkLeft, jawOpen, ...). Optional:
     * an "avatarHead" bone (busts turn the head at the neck), `clipY` (straight cut of a bust, in
     * model units), `scale` and `offset`. The model covers the face, so it has no head occluder.
     */
    function registerAvatar3D(definition) {
        if (!definition?.model || typeof definition.model.asset !== 'string') {
            throw new TypeError(`3D avatar "${definition?.id}" needs model.asset`);
        }
        return registerEffect({
            id: definition.id,
            label: definition.label,
            order: definition.order,
            category: 'avatar3d',
            thumbnail: definition.thumbnail,
            model: {
                asset: definition.model.asset,
                anchor: 'eyes',
                offset: definition.model.offset,
                scale: definition.model.scale,
                clipY: definition.model.clipY,
                occluder: false,
                avatar: true,
            },
        });
    }

    function registerFilterPreset(preset) {
        if (!preset || typeof preset.id !== 'string' || !preset.id) {
            throw new TypeError('A filter preset needs a string id');
        }
        const entry = Object.freeze({
            id: preset.id,
            label: preset.label || preset.id,
            order: preset.order ?? 100,
            filters: Object.freeze(normalizeFilters(preset.filters)),
        });
        filterPresets.set(entry.id, entry);
        return entry;
    }

    function normalizeFilters(filters = {}) {
        const normalized = { ...VFX.DEFAULT_FILTERS };
        Object.keys(FILTER_LIMITS).forEach((key) => {
            const value = Number(filters[key]);
            if (Number.isFinite(value)) normalized[key] = clamp(value, FILTER_LIMITS[key][0], FILTER_LIMITS[key][1]);
        });
        return normalized;
    }

    function isDefaultFilters(filters) {
        return Object.keys(VFX.DEFAULT_FILTERS).every(
            (key) => Math.abs((filters?.[key] ?? VFX.DEFAULT_FILTERS[key]) - VFX.DEFAULT_FILTERS[key]) < 1e-3
        );
    }

    function nextPowerOfTwo(value) {
        return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
    }

    /**
     * Load and validate a PNG/WebP/SVG asset, then rasterize it to a power-of-two canvas: crisp
     * SVG at any scale, mipmaps on WebGL1 and the same input for both renderers.
     */
    async function loadImageAsset(url, maxSize = 1024) {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.decoding = 'async';
        image.src = url;
        try {
            await image.decode();
        } catch (error) {
            throw new VFX.VideoEffectsError('ASSET_LOAD_FAILED', `Unable to load effect asset ${url}`, error);
        }
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        if (!width || !height) {
            throw new VFX.VideoEffectsError('ASSET_INVALID', `Effect asset has no size: ${url}`);
        }
        // Up to 2x the natural size (crisp SVG on HiDPI output) without wasting GPU memory on small parts
        const scale = Math.min(maxSize / Math.max(width, height), 2);
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(maxSize, nextPowerOfTwo(width * scale));
        canvas.height = Math.min(maxSize, nextPowerOfTwo(height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        return { image: canvas, aspect: height / width, url };
    }

    /**
     * Corners (TL, TR, BR, BL) of an accessory layer in output pixels. The layer is a planar quad
     * in face space, projected orthographically, which keeps it a parallelogram.
     */
    function computeLayerCorners(face, layer, aspect) {
        const { pose, points } = face;
        const s = pose.scale;
        const { x, y, z } = pose.axes;
        let ax = x;
        let ay = y;
        if (layer.roll) {
            const angle = (layer.roll * Math.PI) / 180;
            ax = vec3.rotate(ax, z, angle);
            ay = vec3.rotate(ay, z, angle);
        }
        if (layer.tilt) ay = vec3.rotate(ay, ax, (layer.tilt * Math.PI) / 180);
        if (layer.flipX) ax = vec3.scale(ax, -1);

        const anchor = VFX.averagePoint(points, layer.anchor);
        const [ox, oy, oz] = layer.offset;
        const center = vec3.add(
            anchor,
            vec3.add(vec3.scale(x, ox * s), vec3.add(vec3.scale(y, oy * s), vec3.scale(z, (oz || 0) * s)))
        );
        const w = layer.width * s;
        const h = w * aspect;
        const tl = vec3.sub(center, vec3.add(vec3.scale(ax, layer.pivot[0] * w), vec3.scale(ay, layer.pivot[1] * h)));
        const tr = vec3.add(tl, vec3.scale(ax, w));
        const bl = vec3.add(tl, vec3.scale(ay, h));
        const br = vec3.add(tr, vec3.scale(ay, h));
        return [tl[0], tl[1], tr[0], tr[1], br[0], br[1], bl[0], bl[1]];
    }

    class EffectsManager {
        constructor({ assetBaseUrl = VFX.baseUrl, maxTextureSize = 1024 } = {}) {
            this.assetBaseUrl = assetBaseUrl;
            this.maxTextureSize = maxTextureSize;
            this.cache = new Map();
            this.active = null;
        }

        assetUrl(path) {
            return VFX.resolveUrl(path, this.assetBaseUrl);
        }

        list() {
            return [...effects.values()]
                .sort((a, b) => a.order - b.order)
                .map((effect) => ({
                    id: effect.id,
                    label: effect.label,
                    category: effect.category,
                    thumbnail: effect.thumbnail ? this.assetUrl(effect.thumbnail) : null,
                    is3D: !!effect.model,
                }));
        }

        getEffect(id) {
            return effects.get(id) || null;
        }

        loadAsset(path) {
            const url = this.assetUrl(path);
            if (!this.cache.has(url)) {
                const promise = loadImageAsset(url, this.maxTextureSize).catch((error) => {
                    // Do not cache failures: the asset may become reachable again
                    this.cache.delete(url);
                    throw error;
                });
                this.cache.set(url, promise);
            }
            return this.cache.get(url);
        }

        // Load every asset of an effect; rejects (and keeps the previous effect) if one is invalid
        async prepare(id) {
            const effect = effects.get(id);
            if (!effect) throw new VFX.VideoEffectsError('UNKNOWN_EFFECT', `Unknown effect "${id}"`);
            const assets = await Promise.all(effect.layers.map((layer) => this.loadAsset(layer.asset)));
            return {
                effect,
                layers: effect.layers.map((layer, index) => ({ layer, asset: assets[index] })),
                modelUrl: effect.model ? this.assetUrl(effect.model.asset) : null,
            };
        }

        setActive(runtime) {
            this.active = runtime;
        }

        activeImages() {
            return new Set((this.active?.layers || []).map(({ asset }) => asset.image));
        }

        computeLayers(face) {
            if (!this.active || !face) return [];
            const layers = [];
            for (const { layer, asset } of this.active.layers) {
                let opacity = face.opacity * layer.opacity;
                let scaleY = 1;
                let placed = layer;
                const drive = layer.drive;
                if (drive) {
                    if (drive.opacity) opacity *= driveProperty(drive.opacity, 'opacity', face.expressions);
                    if (drive.scaleY) scaleY = driveProperty(drive.scaleY, 'scaleY', face.expressions);
                    if (drive.offsetY) {
                        const dy = driveProperty(drive.offsetY, 'offsetY', face.expressions);
                        placed = { ...layer, offset: [layer.offset[0], layer.offset[1] + dy, layer.offset[2] || 0] };
                    }
                }
                if (opacity <= 0.001 || scaleY <= 0.001) continue;
                layers.push({
                    image: asset.image,
                    corners: computeLayerCorners(face, placed, asset.aspect * scaleY),
                    opacity,
                });
            }
            return layers;
        }

        clear() {
            this.active = null;
            this.cache.clear();
        }
    }

    VFX.ANCHORS = ANCHORS;
    VFX.FILTER_LIMITS = FILTER_LIMITS;
    VFX.registerEffect = registerEffect;
    VFX.registerFilterPreset = registerFilterPreset;
    VFX.registerAvatar = registerAvatar;
    VFX.registerAvatar3D = registerAvatar3D;
    VFX.driveValue = driveValue;
    VFX.driveProperty = driveProperty;
    VFX.getFilterPresets = () => [...filterPresets.values()].sort((a, b) => a.order - b.order);
    VFX.getFilterPreset = (id) => filterPresets.get(id) || null;
    VFX.normalizeFilters = normalizeFilters;
    VFX.isDefaultFilters = isDefaultFilters;
    VFX.computeLayerCorners = computeLayerCorners;
    VFX.loadImageAsset = loadImageAsset;
    VFX.EffectsManager = EffectsManager;
})(typeof globalThis !== 'undefined' ? globalThis : self);

'use strict';

/**
 * MiroTalk Video Effects - beauty and colour filters.
 *
 * Offsets and widths are in units of the eye distance (outer eye corners), along the face axes:
 * x towards the subject's left eye, y towards the chin, z into the head. `pivot` is the point of
 * the image (0..1) placed on the anchor. See public/video-effects/README.md.
 */
(function (root) {
    const VFX = root.MiroTalkVFX;
    if (!VFX?.registerEffect) return;

    // Values follow the CSS filter functions; smoothing (0..1) needs the WebGL renderer
    const presets = [
        { id: 'none', label: 'None', order: 0, filters: {} },
        { id: 'beauty', label: 'Beauty', order: 10, filters: { smoothing: 0.6, brightness: 1.05, saturation: 1.05 } },
        { id: 'vivid', label: 'Vivid', order: 20, filters: { contrast: 1.12, saturation: 1.35 } },
        { id: 'warm', label: 'Warm', order: 30, filters: { temperature: 0.6, saturation: 1.05 } },
        { id: 'cool', label: 'Cool', order: 40, filters: { temperature: -0.6 } },
        { id: 'grayscale', label: 'Grayscale', order: 50, filters: { grayscale: 1, contrast: 1.05 } },
        { id: 'sepia', label: 'Sepia', order: 60, filters: { sepia: 0.85 } },
    ];
    presets.forEach((preset) => VFX.registerFilterPreset(preset));
})(typeof globalThis !== 'undefined' ? globalThis : self);

'use strict';

/**
 * MiroTalk Video Effects - mustache.
 *
 * Offsets and widths are in units of the eye distance (outer eye corners), along the face axes:
 * x towards the subject's left eye, y towards the chin, z into the head. `pivot` is the point of
 * the image (0..1) placed on the anchor. See public/video-effects/README.md.
 */
(function (root) {
    const VFX = root.MiroTalkVFX;
    if (!VFX?.registerEffect) return;

    VFX.registerEffect({
        id: 'mustache',
        label: 'Mustache',
        order: 40,
        thumbnail: 'assets/masks/mustache-thumb.svg',
        layers: [
            {
                asset: 'assets/masks/mustache.svg',
                anchor: 'mustache',
                offset: [0, 0, -0.05],
                width: 0.95,
                pivot: [0.5, 0.42],
            },
        ],
    });
})(typeof globalThis !== 'undefined' ? globalThis : self);

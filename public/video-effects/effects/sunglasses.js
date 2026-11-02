'use strict';

/**
 * MiroTalk Video Effects - sunglasses.
 *
 * Offsets and widths are in units of the eye distance (outer eye corners), along the face axes:
 * x towards the subject's left eye, y towards the chin, z into the head. `pivot` is the point of
 * the image (0..1) placed on the anchor. See public/video-effects/README.md.
 */
(function (root) {
    const VFX = root.MiroTalkVFX;
    if (!VFX?.registerEffect) return;

    VFX.registerEffect({
        id: 'sunglasses',
        label: 'Sunglasses',
        order: 10,
        layers: [
            {
                asset: 'assets/sunglasses/sunglasses.svg',
                anchor: 'eyes',
                offset: [0, 0.02, -0.08],
                width: 1.6,
                pivot: [0.5, 0.5],
            },
        ],
    });
})(typeof globalThis !== 'undefined' ? globalThis : self);

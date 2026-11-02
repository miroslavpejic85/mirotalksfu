'use strict';

/**
 * MiroTalk Video Effects - beard.
 *
 * Offsets and widths are in units of the eye distance (outer eye corners), along the face axes:
 * x towards the subject's left eye, y towards the chin, z into the head. `pivot` is the point of
 * the image (0..1) placed on the anchor. See public/video-effects/README.md.
 */
(function (root) {
    const VFX = root.MiroTalkVFX;
    if (!VFX?.registerEffect) return;

    VFX.registerEffect({
        id: 'beard',
        label: 'Beard',
        order: 50,
        thumbnail: 'assets/masks/beard-thumb.svg',
        layers: [
            {
                asset: 'assets/masks/beard.svg',
                anchor: 'mouth',
                offset: [0, 0, 0],
                width: 2.0,
                pivot: [0.5, 0.465],
            },
        ],
    });
})(typeof globalThis !== 'undefined' ? globalThis : self);

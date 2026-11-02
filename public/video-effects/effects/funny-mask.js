'use strict';

/**
 * MiroTalk Video Effects - funny face mask.
 *
 * Offsets and widths are in units of the eye distance (outer eye corners), along the face axes:
 * x towards the subject's left eye, y towards the chin, z into the head. `pivot` is the point of
 * the image (0..1) placed on the anchor. See public/video-effects/README.md.
 */
(function (root) {
    const VFX = root.MiroTalkVFX;
    if (!VFX?.registerEffect) return;

    VFX.registerEffect({
        id: 'funny-mask',
        label: 'Funny mask',
        order: 140,
        thumbnail: 'assets/masks/funny-mask-thumb.svg',
        layers: [
            {
                asset: 'assets/masks/googly-eye.svg',
                anchor: 'rightEye',
                offset: [0, 0, -0.1],
                width: 0.62,
            },
            {
                asset: 'assets/masks/googly-eye.svg',
                anchor: 'leftEye',
                offset: [0, 0, -0.1],
                width: 0.62,
                flipX: true,
            },
            {
                asset: 'assets/masks/clown-nose.svg',
                anchor: 'noseTip',
                offset: [0, 0, -0.05],
                width: 0.46,
            },
        ],
    });
})(typeof globalThis !== 'undefined' ? globalThis : self);

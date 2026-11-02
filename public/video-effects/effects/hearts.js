'use strict';

/**
 * MiroTalk Video Effects - love: heart eyes, heart glasses and a crown of hearts.
 *
 * Offsets and widths are in units of the eye distance (outer eye corners), along the face axes:
 * x towards the subject's left eye, y towards the chin, z into the head. `pivot` is the point of
 * the image (0..1) placed on the anchor. See public/video-effects/README.md.
 */
(function (root) {
    const VFX = root.MiroTalkVFX;
    if (!VFX?.registerEffect) return;

    VFX.registerEffect({
        id: 'heart-eyes',
        label: 'Heart eyes',
        order: 150,
        thumbnail: 'assets/love/heart-eyes-thumb.svg',
        layers: [
            {
                asset: 'assets/love/heart-eye.svg',
                anchor: 'rightEye',
                offset: [0, 0, -0.1],
                width: 0.68,
                pivot: [0.5, 0.5],
            },
            {
                asset: 'assets/love/heart-eye.svg',
                anchor: 'leftEye',
                offset: [0, 0, -0.1],
                width: 0.68,
                pivot: [0.5, 0.5],
                flipX: true,
            },
        ],
    });

    VFX.registerEffect({
        id: 'heart-glasses',
        label: 'Heart glasses',
        order: 40,
        layers: [
            {
                asset: 'assets/love/heart-glasses.svg',
                anchor: 'eyes',
                offset: [0, 0.1, -0.08],
                width: 2,
                pivot: [0.5, 0.45],
            },
        ],
    });

    VFX.registerEffect({
        id: 'heart-crown',
        label: 'Love crown',
        order: 160,
        layers: [
            {
                asset: 'assets/love/heart-crown.svg',
                anchor: 'forehead',
                offset: [0, 0.14, 0],
                width: 2,
                pivot: [0.5, 0.74],
            },
        ],
    });
})(typeof globalThis !== 'undefined' ? globalThis : self);

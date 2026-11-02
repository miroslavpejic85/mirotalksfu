'use strict';

/**
 * MiroTalk Video Effects - baseball cap.
 *
 * Offsets and widths are in units of the eye distance (outer eye corners), along the face axes:
 * x towards the subject's left eye, y towards the chin, z into the head. `pivot` is the point of
 * the image (0..1) placed on the anchor. See public/video-effects/README.md.
 */
(function (root) {
    const VFX = root.MiroTalkVFX;
    if (!VFX?.registerEffect) return;

    VFX.registerEffect({
        id: 'baseball-cap',
        label: 'Baseball cap',
        order: 30,
        layers: [
            {
                asset: 'assets/hats/baseball-cap.svg',
                anchor: 'forehead',
                offset: [0, 0.14, 0],
                width: 2.5,
                pivot: [0.5, 0.78],
            },
        ],
    });
})(typeof globalThis !== 'undefined' ? globalThis : self);

'use strict';

/**
 * MiroTalk Video Effects - dog ears.
 *
 * Offsets and widths are in units of the eye distance (outer eye corners), along the face axes:
 * x towards the subject's left eye, y towards the chin, z into the head. `pivot` is the point of
 * the image (0..1) placed on the anchor. See public/video-effects/README.md.
 */
(function (root) {
    const VFX = root.MiroTalkVFX;
    if (!VFX?.registerEffect) return;

    VFX.registerEffect({
        id: 'dog-ears',
        label: 'Dog ears',
        order: 60,
        thumbnail: 'assets/accessories/dog-thumb.svg',
        layers: [
            // Ear on the image left (subject's right), the other one is mirrored
            {
                asset: 'assets/accessories/dog-ear.svg',
                anchor: 'forehead',
                offset: [-0.72, -0.2, 0.1],
                width: 0.78,
                pivot: [0.46, 0.95],
                roll: -18,
            },
            {
                asset: 'assets/accessories/dog-ear.svg',
                anchor: 'forehead',
                offset: [0.72, -0.2, 0.1],
                width: 0.78,
                pivot: [0.46, 0.95],
                roll: 18,
                flipX: true,
            },
            {
                asset: 'assets/accessories/dog-nose.svg',
                anchor: 'noseTip',
                offset: [0, 0.02, 0],
                width: 0.55,
                pivot: [0.5, 0.45],
            },
        ],
    });
})(typeof globalThis !== 'undefined' ? globalThis : self);

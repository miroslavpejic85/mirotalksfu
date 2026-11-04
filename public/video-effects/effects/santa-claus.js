'use strict';

/**
 * MiroTalk Video Effects - Santa Claus: Santa hat, white mustache and white beard.
 *
 * Offsets and widths are in units of the eye distance (outer eye corners), along the face axes:
 * x towards the subject's left eye, y towards the chin, z into the head. `pivot` is the point of
 * the image (0..1) placed on the anchor. See public/video-effects/README.md.
 */
(function (root) {
    const VFX = root.MiroTalkVFX;
    if (!VFX?.registerEffect) return;

    VFX.registerEffect({
        id: 'santa-claus',
        label: 'Santa Claus',
        order: 135,
        thumbnail: 'assets/masks/santa-thumb.svg',
        layers: [
            {
                asset: 'assets/masks/santa-beard.svg',
                anchor: 'mouth',
                offset: [0, 0, 0],
                width: 2.0,
                pivot: [0.5, 0.44],
            },
            {
                asset: 'assets/masks/santa-mustache.svg',
                anchor: 'mustache',
                offset: [0, 0, -0.05],
                width: 0.95,
                pivot: [0.5, 0.42],
            },
            {
                asset: 'assets/hats/santa-hat.svg',
                anchor: 'forehead',
                offset: [0, 0.2, 0],
                width: 2.3,
                pivot: [0.5, 0.8],
            },
        ],
    });
})(typeof globalThis !== 'undefined' ? globalThis : self);

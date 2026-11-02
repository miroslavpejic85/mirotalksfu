'use strict';

/**
 * MiroTalk Video Effects - headwear: flower crown, golden crown, party hat, bunny ears and halo.
 *
 * Offsets and widths are in units of the eye distance (outer eye corners), along the face axes:
 * x towards the subject's left eye, y towards the chin, z into the head. `pivot` is the point of
 * the image (0..1) placed on the anchor. See public/video-effects/README.md.
 */
(function (root) {
    const VFX = root.MiroTalkVFX;
    if (!VFX?.registerEffect) return;

    VFX.registerEffect({
        id: 'flower-crown',
        label: 'Flower crown',
        order: 80,
        layers: [
            {
                asset: 'assets/accessories/flower-crown.svg',
                anchor: 'forehead',
                offset: [0, 0.12, 0],
                width: 2.3,
                pivot: [0.5, 0.62],
            },
        ],
    });

    VFX.registerEffect({
        id: 'crown',
        label: 'Crown',
        order: 60,
        layers: [
            {
                asset: 'assets/hats/crown.svg',
                anchor: 'forehead',
                offset: [0, 0.12, 0],
                width: 1.8,
                pivot: [0.5, 0.9],
            },
        ],
    });

    VFX.registerEffect({
        id: 'party-hat',
        label: 'Party hat',
        order: 70,
        layers: [
            {
                asset: 'assets/hats/party-hat.svg',
                anchor: 'forehead',
                offset: [0.5, 0.2, 0],
                width: 0.95,
                pivot: [0.5, 0.93],
                roll: 14,
            },
        ],
    });

    VFX.registerEffect({
        id: 'bunny-ears',
        label: 'Bunny ears',
        order: 110,
        layers: [
            {
                asset: 'assets/accessories/bunny-ears.svg',
                anchor: 'forehead',
                offset: [0, 0.12, 0.1],
                width: 1.8,
                pivot: [0.5, 0.96],
            },
        ],
    });

    VFX.registerEffect({
        id: 'halo',
        label: 'Halo',
        order: 90,
        layers: [
            {
                asset: 'assets/accessories/halo.svg',
                anchor: 'forehead',
                offset: [0, -0.45, 0],
                width: 1.5,
                pivot: [0.5, 0.5],
            },
        ],
    });
})(typeof globalThis !== 'undefined' ? globalThis : self);

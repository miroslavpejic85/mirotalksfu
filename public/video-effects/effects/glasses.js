'use strict';

/**
 * MiroTalk Video Effects - glasses.
 *
 * Offsets and widths are in units of the eye distance (outer eye corners), along the face axes:
 * x towards the subject's left eye, y towards the chin, z into the head. `pivot` is the point of
 * the image (0..1) placed on the anchor. See public/video-effects/README.md.
 */
(function (root) {
    const VFX = root.MiroTalkVFX;
    if (!VFX?.registerEffect) return;

    VFX.registerEffect({
        id: 'glasses',
        label: 'Glasses',
        order: 20,
        layers: [
            {
                asset: 'assets/glasses/glasses.svg',
                anchor: 'eyes',
                offset: [0, 0.02, -0.08],
                width: 1.5,
                pivot: [0.5, 0.5],
            },
        ],
    });

    // Optional 3D variant: GLB model rendered with Three.js, loaded only when selected
    VFX.registerEffect({
        id: 'glasses-3d',
        label: '3D glasses',
        order: 30,
        thumbnail: 'assets/glasses/glasses-3d-thumb.svg',
        model: {
            asset: 'assets/glasses/glasses-3d.glb',
            anchor: 'noseBridge',
            offset: [0, 0.04, 0],
            scale: 1,
            occluder: true,
        },
    });
})(typeof globalThis !== 'undefined' ? globalThis : self);

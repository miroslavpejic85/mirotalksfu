# MiroTalk Video Effects Engine

Face accessories, beauty and colour filters for the camera, processed **locally in the browser**. No
commercial SDK, no API key and no cloud processing: video frames never leave the device for processing.

## Pipeline

```
camera track ─► (optional) VirtualBackground ─► hidden <video>
                                                    │
                     ┌──────────────────────────────┤
                     ▼                              ▼
         FaceTracker (module worker)        WebGLRenderer / Canvas2DRenderer
         MediaPipe Face Landmarker          filters shader + accessory quads
         8-15 Hz, One Euro smoothing,       (+ Three.js overlay for GLB models)
         interpolation + prediction                 │
                     └──────── face pose ───────────┤
                                                    ▼
                                         canvas.captureStream()
                                                    │
                                    processed MediaStreamTrack ─► producer.replaceTrack()
```

| File                              | Role                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `index.js`                        | `MiroTalkVideoEffects` public API, render loop, lifecycle                         |
| `camera.js`                       | `VideoSource` (track → hidden video) and `FrameScheduler` (rVFC / worker timer)   |
| `face-tracker.js`                 | MediaPipe backends (worker, main thread), smoothing, pose, face-loss handling     |
| `workers/face-tracking-worker.js` | Module worker running Face Landmarker                                             |
| `renderer.js`                     | WebGL2/WebGL1 renderer (filters, skin smoothing, accessories), Canvas 2D fallback |
| `effects-manager.js`              | Effect/filter registries, asset loading and validation, accessory placement       |
| `model-renderer.js`               | Lazy Three.js renderer for GLB/GLTF accessories with a head occluder              |
| `stream-manager.js`               | `canvas.captureStream()` output track                                             |
| `effects/*.js`                    | Effect descriptors and filter presets                                             |
| `assets/`                         | Original SVG artwork and the generated 3D glasses (`glasses-3d.glb`)              |

The UI lives in `public/js/VideoEffectsPanel.js` (Settings > Effects, the lobby picker and the camera
dropdown entry). Backgrounds stay in their own Settings > Background tab (`public/js/VirtualBackground.js`);
the Effects panel only links to it, so there is no duplicate picker.

## API

```js
const effects = new MiroTalkVideoEffects({ video: localVideoElement, width: 1280, height: 720 });
await effects.initialize();
await effects.setEffect('sunglasses');
const processedTrack = effects.getStream().getVideoTracks()[0];

// or from a camera track (what MiroTalk does)
const processed = await effects.setSourceTrack(cameraTrack);
```

| Method / option                                                | Description                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `new MiroTalkVideoEffects(options)`                            | `video`, `width`/`height` (max output, never upscales), `maxFps` (30), `detectionFps` (15 desktop, 8 mobile), `delegate` (`'CPU'` default or `'GPU'`), `useWorker`, `preferWebGL`, `assetBaseUrl`, `mediapipe: { visionBundleUrl, wasmBaseUrl, modelUrl }`, `three: { threeUrl, gltfLoaderUrl }` |
| `initialize()`                                                 | Creates the renderer and output canvas                                                                                                                                                                                                                                                           |
| `setSourceTrack(track)` / `start()`                            | Processes a camera track, returns the processed track                                                                                                                                                                                                                                            |
| `getStream()` / `getOutputTrack()`                             | Processed output                                                                                                                                                                                                                                                                                 |
| `setEffect(id \| null)`                                        | Select an effect (`null`/`'none'` removes it). Rejects and keeps the previous effect if an asset is invalid                                                                                                                                                                                      |
| `setFilters({...})` / `setFilterPreset(id)` / `resetFilters()` | `brightness`, `contrast`, `saturation` (CSS filter semantics), `grayscale`, `sepia`, `temperature` (-1..1), `smoothing` (0..1, WebGL only)                                                                                                                                                       |
| `isActive()`                                                   | `true` when the output differs from the camera                                                                                                                                                                                                                                                   |
| `getEffects()`, `getFilterPresets()`, `getState()`             | For UIs                                                                                                                                                                                                                                                                                          |
| `on(event, fn)`                                                | `state`, `error` (`{ stage, error }`), `sourceended`, `destroyed`                                                                                                                                                                                                                                |
| `stop()`                                                       | Ends the output track and detaches the camera **without stopping it**; models stay loaded                                                                                                                                                                                                        |
| `destroy()`                                                    | Releases workers, MediaPipe, WebGL contexts, streams, listeners, loops and object URLs                                                                                                                                                                                                           |

`MiroTalkVideoEffects.isSupported()` is `false` when `canvas.captureStream()` is missing.

## WebRTC integration (RoomClient)

The engine knows nothing about signaling; `RoomClient` wires it to the existing mediasoup producer:

- **New camera** (`produce()`): after the optional virtual background, `applyVideoEffectsToStream()` wraps the
  track when an effect/filter is active. On failure the raw camera is sent and the user is warned.
- **Toggling effects live** (`updateVideoEffectsTrack()`): `producer.replaceTrack()` (`RTCRtpSender.replaceTrack()`)
  swaps camera ⇄ processed track on the same sender. No new peer connection, no renegotiation, no flicker for
  remote participants. Changing from one effect to another does not touch the track at all.
- **Camera switch / quality change** (`closeThenProduce`): `closeProducer()` releases the camera feeding the
  engine (`releaseVideoEffectsSource()`), the new camera is wrapped again by `produce()`; the model stays loaded.
- **Camera unplugged / revoked**: the engine emits `sourceended`, handled like a producer `trackended`.
- **Transport recovery** re-sends the existing processed track; an abandoned recovery releases the camera.
- **Screen sharing and audio** use their own producers and are never processed.
- **Leaving** (`exit()`): `destroyVideoEffects()` releases the camera and destroys the engine.

## Adding an effect

Create `effects/my-effect.js`, add its `<script>` tag in `public/views/Room.html` after `effects-manager.js`,
then run `npm run lang` (labels are extracted automatically) and translate the new keys.

```js
(function (root) {
    const VFX = root.MiroTalkVFX;
    if (!VFX?.registerEffect) return;

    VFX.registerEffect({
        id: 'pirate',
        label: 'Pirate',
        order: 80, // position in the panel
        thumbnail: 'assets/masks/pirate-thumb.svg', // optional, defaults to the first layer
        layers: [
            {
                asset: 'assets/masks/eye-patch.svg', // PNG, WebP or SVG with width/height attributes
                anchor: 'rightEye', // named anchor or an array of landmark indices
                offset: [0, -0.05, -0.1], // x: towards the subject's left eye, y: towards the chin, z: into the head
                width: 0.7, // in eye distances (outer eye corners)
                pivot: [0.5, 0.5], // point of the image placed on the anchor (0..1)
                roll: 0, // extra rotation in degrees
                tilt: 0, // tilt around the horizontal axis in degrees
                flipX: false, // mirror the image (e.g. reuse one ear for both sides)
            },
        ],
    });
})(typeof globalThis !== 'undefined' ? globalThis : self);
```

Named anchors: `eyes`, `rightEye`, `leftEye`, `rightIris`, `leftIris`, `noseBridge`, `noseTip`, `noseBottom`,
`upperLip`, `mustache`, `mouth`, `chin`, `forehead` (see `ANCHORS` in `effects-manager.js`). Any of the 478
[MediaPipe face mesh landmarks](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png)
can be used as an index array.

Filter presets: `VFX.registerFilterPreset({ id, label, order, filters: { ... } })` (see `effects/beauty.js`).

## Custom accessories

**2D (PNG/WebP/SVG)**: transparent background, the accessory seen from the front, horizontally centred.
Assets are rasterised once to a power-of-two texture (max 1024 px), so keep them around 600-1000 px wide. SVG
files must declare `width` and `height`. Use only artwork you own or that is licensed for redistribution.

**3D (GLB/GLTF)**: add `model` instead of (or in addition to) `layers`:

```js
VFX.registerEffect({
    id: 'my-hat-3d',
    label: '3D hat',
    thumbnail: 'assets/hats/my-hat-3d.svg',
    model: { asset: 'assets/hats/my-hat.glb', anchor: 'forehead', offset: [0, 0, 0.3], scale: 1, occluder: true },
});
```

Model convention: **1 unit = distance between the outer eye corners**, origin on the anchor, +X towards the
subject's left (image right), +Y up, +Z out of the face. `occluder` hides the parts behind the head. Three.js is
only downloaded when a 3D effect is selected. `scripts/generate-video-effects-glb.js` shows how the bundled
glasses were generated.

## Animated head avatars

`effects/avatars.js` registers cartoon heads (cat, bear, panda, robot, alien, fox, monkey) and an astronaut
helmet. They replace the head, follow its movements, **blink**, **raise their brows**, **smile** and
**open the mouth while talking**.

Expressions (0..1) are updated every frame:

| Expression                         | Source                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `blinkRight`, `blinkLeft`, `blink` | MediaPipe blendshapes; eyelid landmarks with an adaptive open-eye reference as fallback |
| `mouthOpen`                        | Inner-lip landmark distance                                                             |
| `smile`, `browUp`                  | MediaPipe blendshapes (`mouthSmile*`, `browInnerUp`, `browOuterUp*`)                    |

Blendshape sides are checked against the landmarks during clear winks, so the avatar always winks the same eye.

Any layer can be driven by expressions. Each property takes one spec or a list (`opacity`/`scaleY` multiply,
`offsetY` adds); a spec maps `smoothstep(from, to, expression)` (optionally inverted) to `[min, max]`:

```js
drive: {
    opacity: [
        { expression: 'mouthOpen', from: 0.04, to: 0.12, invert: true }, // hidden while talking...
        { expression: 'smile', from: 0.3, to: 0.55, invert: true }, // ...and while smiling
    ],
    scaleY: { expression: 'mouthOpen', from: 0.05, to: 0.7, min: 0.3, max: 1 }, // grows downwards
    offsetY: { expression: 'browUp', from: 0.15, to: 0.6, min: 0, max: -28 }, // moves up (canvas px for avatars)
}
```

Avatars are drawn on a 600x640 canvas split into parts and placed with `VFX.registerAvatar()`:

```js
VFX.registerAvatar({
    id: 'avatar-owl',
    label: 'Owl',
    thumbnail: 'assets/avatars/owl/thumb.svg',
    size: [600, 640], // drawing canvas
    eyes: [300, 300], // canvas point placed between the user's eyes
    width: 3.15, // canvas width in eye distances (3.15 covers the head and hair)
    parts: [
        { asset: 'assets/avatars/owl/head.svg', box: [0, 0, 600, 640] },
        { asset: 'assets/avatars/owl/eye-open.svg', box: [180, 245, 110, 110], drive: { ... } },
        // brows, closed eyes, neutral/smile/open mouths; the other side reuses drawings with flipX: true
    ],
});
```

The bundled avatars are **generated**: edit `scripts/generate-video-effects-avatars.js` (clean cartoon vector
art: outlines, gradients, soft shading, detailed eyes) and run `node scripts/generate-video-effects-avatars.js`;
it rewrites `assets/avatars/` and `effects/avatars.js`. Each avatar is ~20-35 KB, loaded only when selected.
Flat cartoon shapes are deliberate: they stay readable in small video tiles and compress well, while fine detail
such as fur strands shimmers when the head moves and turns into noise after video encoding.

## Performance

- Face detection runs in a module worker on downscaled frames (640 px wide, 480 on mobile) at 15 Hz (8 Hz on
  mobile), never on the main thread unless workers are unavailable. It only runs while a face effect is selected.
- The CPU (XNNPACK, WASM SIMD) delegate is the default: reliable on every GPU/driver and it keeps the GPU free for
  rendering and encoding. Pass `delegate: 'GPU'` to the constructor to experiment.
- Rendering follows the camera frames (`requestVideoFrameCallback`), capped at `maxFps`; a worker timer takes
  over in background tabs so remote participants never get a frozen picture.
- Filters, skin smoothing and accessories are one WebGL pass plus one quad per accessory. Skin smoothing samples
  12 texels only on skin-coloured pixels and is skipped when the slider is 0.
- Landmarks are One Euro filtered (no jitter when still, low lag when moving), interpolated every frame and
  extrapolated by their velocity (max 120 ms) to hide detection latency.
- Output is capped (1920×1080 desktop, 1280×720 mobile by default) and never upscaled.
- Assets, the model and the worker are cached; `stop()` keeps them for instant re-activation, `destroy()` frees them.

## Browser support

Modern Chrome, Edge, Firefox and Safari. Graceful degradation:

| Missing                                     | Behaviour                                                         |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `canvas.captureStream()`                    | Effects UI hidden (`MiroTalkVideoEffects.isSupported()` is false) |
| WebGL                                       | Canvas 2D renderer: accessories + CSS filters, no skin smoothing  |
| `CanvasRenderingContext2D.filter` (2D only) | Accessories only, filters disabled                                |
| Module workers / OffscreenCanvas            | Face tracking on the main thread                                  |
| Face model download / init                  | Error shown, filters and backgrounds keep working                 |

## Dependencies and licenses

Loaded from jsDelivr / Google storage at runtime, nothing added to `package.json`:

| Dependency                                  | Use                 | License    |
| ------------------------------------------- | ------------------- | ---------- |
| `@mediapipe/tasks-vision@1.2.0` (JS + WASM) | Face Landmarker     | Apache-2.0 |
| `face_landmarker.task` (float16/1)          | Face landmark model | Apache-2.0 |
| `three@0.181.0` + `GLTFLoader` (lazy)       | 3D accessories      | MIT        |
| `@mediapipe/selfie_segmentation` (existing) | Backgrounds         | Apache-2.0 |

All artwork in `assets/` (SVG and the generated GLB) was created for MiroTalk and is covered by the project
license. To self-host the runtime files, pass `mediapipe` / `three` URLs to the constructor.

## Tests

`npx mocha tests/test-VideoEffects.js` covers smoothing, pose, placement, registry validation, face-loss
handling, expressions (blink, wink, mouth, adaptive eye reference), avatar part mapping, the renderers, the API
lifecycle and the `RoomClient` track replacement and cleanup logic.

## Known limitations

- Faces smaller than ~15% of the frame width (far from the camera) are not detected (MediaPipe short-range model).
- 2D accessories are planar: they follow position, scale, roll, yaw and pitch, but hair or hands do not occlude
  them. 3D models use a simple ellipsoid head occluder.
- Only the first detected face gets accessories.
- Avatars are 2D: when the head turns far to the side they get narrower instead of showing a profile, and the
  neck and shoulders stay visible. Blink detection needs the eyes to be visible (not behind tinted glasses).
- Background effects use the existing virtual background module (separate segmentation pass).

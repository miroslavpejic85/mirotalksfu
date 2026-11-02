# 3D avatar licenses

The models in this folder are derived from third-party assets with permissive licenses. They were
converted by `scripts/generate-video-effects-3d-avatars.js`. The changes are: format conversion
(FBX/GLB to GLB), only the 52 ARKit blendshapes kept and renamed to the MediaPipe names, rest pose
with lowered arms, crop to a bust, a 2-joint neck rig, rescale/recentre between the eyes, WebP
textures, and quantized + meshopt compressed geometry. The `thumb.webp` images are renders of
these models.

## Microsoft Rocketbox (MIT)

`man/` (Male_Adult_01), `man-2/` (Male_Adult_12), `man-3/` (Male_Adult_04), `man-4/` (Male_Adult_10),
`man-5/` (Male_Adult_03, hair cards recoloured), `woman/` (Female_Adult_01), `woman-2/` (Female_Adult_11),
`woman-3/` (Female_Adult_15) and `woman-4/` (Female_Adult_12) come from
https://github.com/microsoft/Microsoft-Rocketbox

```
MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Google MediaPipe raccoon head (Apache-2.0)

`raccoon/` is derived from `raccoon_head_small.glb` from the MediaPipe Face Landmarker samples:
https://storage.googleapis.com/mediapipe-tasks/face_landmarker/raccoon_head_small.glb
(Copyright Google LLC). The MediaPipe team confirmed that this model is under the Apache 2.0
license and may be used commercially: https://github.com/google-ai-edge/mediapipe/issues/6389 (see
also https://github.com/google-ai-edge/mediapipe/issues/5662). It is licensed under the Apache
License, Version 2.0; a copy is in [LICENSE-APACHE-2.0.txt](./LICENSE-APACHE-2.0.txt).

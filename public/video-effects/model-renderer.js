'use strict';

/**
 * MiroTalk Video Effects - optional 3D (GLB/GLTF) accessories and realistic avatars.
 *
 * Three.js (MIT) and its GLTFLoader are imported on demand, only when a 3D effect is selected.
 * The model is posed with the face basis and drawn with an orthographic camera in output pixels,
 * so it lines up exactly with the 2D accessories. An invisible head occluder writes depth only,
 * hiding parts of the model behind the head (e.g. the far temple of a pair of glasses).
 *
 * Avatars (model.avatar) also get image based lighting, morph targets driven by the MediaPipe
 * blendshapes (same names: eyeBlinkLeft, jawOpen, ...), an optional "avatarHead" bone (the head
 * follows the user, the shoulders only partly) and an optional straight cut at model.clipY.
 *
 * Model convention: 1 unit = distance between the outer eye corners, origin at the anchor,
 * +X towards the subject's left (image right), +Y up, +Z out of the face (glTF front).
 * Models that do not follow it (model.fit, custom avatars) are fitted from their eyes when loaded.
 */
(function (root) {
    const VFX = (root.MiroTalkVFX = root.MiroTalkVFX || {});
    const { vec3 } = VFX;

    const THREE_VERSION = '0.181.0';
    const THREE_CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;
    const DEFAULT_THREE = Object.freeze({
        threeUrl: `${THREE_CDN}/+esm`,
        gltfLoaderUrl: `${THREE_CDN}/examples/jsm/loaders/GLTFLoader.js/+esm`,
        meshoptDecoderUrl: `${THREE_CDN}/examples/jsm/libs/meshopt_decoder.module.js/+esm`,
        roomEnvironmentUrl: `${THREE_CDN}/examples/jsm/environments/RoomEnvironment.js/+esm`,
        dracoLoaderUrl: `${THREE_CDN}/examples/jsm/loaders/DRACOLoader.js/+esm`,
        dracoDecoderPath: `${THREE_CDN}/examples/jsm/libs/draco/gltf/`,
        ktx2LoaderUrl: `${THREE_CDN}/examples/jsm/loaders/KTX2Loader.js/+esm`,
        ktx2TranscoderPath: `${THREE_CDN}/examples/jsm/libs/basis/`,
    });

    // Share of the head rotation applied to the shoulders of a bust
    const BODY_FOLLOW = 0.3;
    // Morph target smoothing (blendshapes arrive at the detection rate, frames at the render rate)
    const MORPH_TAU_MS = 60;
    // Without blendshapes (older MediaPipe builds) the landmark expressions still animate the face
    const EXPRESSION_FALLBACK = Object.freeze({
        jawOpen: (expressions) => expressions.mouthOpen,
        mouthSmileLeft: (expressions) => expressions.smile,
        mouthSmileRight: (expressions) => expressions.smile,
        browInnerUp: (expressions) => expressions.browUp,
    });

    function disposeObject(object) {
        object.traverse((child) => {
            child.geometry?.dispose();
            child.skeleton?.dispose();
            const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
            materials.forEach((material) => {
                Object.values(material).forEach((value) => {
                    if (value && value.isTexture) value.dispose();
                });
                material.dispose();
            });
        });
    }

    function mirrorSide(name) {
        return name.replace(/(Left|Right)$/, (side) => (side === 'Left' ? 'Right' : 'Left'));
    }

    // Morph target weight (0..1) of one blendshape for the current face
    function blendshapeWeight(name, face) {
        const expressions = face.expressions || {};
        // Blinks: the expression estimator already maps them to the subject's sides and debounces them
        if (name === 'eyeBlinkLeft') return expressions.blinkLeft || 0;
        if (name === 'eyeBlinkRight') return expressions.blinkRight || 0;
        const blendshapes = face.blendshapes;
        if (!blendshapes || !Number.isFinite(blendshapes.jawOpen)) return EXPRESSION_FALLBACK[name]?.(expressions) || 0;
        const value = blendshapes[face.sidesSwapped ? mirrorSide(name) : name] || 0;
        // MediaPipe under-reports jawOpen while talking: the measured lip gap keeps the mouth lively
        if (name === 'jawOpen') return Math.max(value, (expressions.mouthOpen || 0) * 0.85);
        return value;
    }

    // Outer eye corners are ~1.43x further apart than the eye centres (adult average)
    const EYE_CENTER_DISTANCE = 1 / 1.43;
    // Full bodies are cut below the shoulders, like the bundled busts
    const BODY_CUT_Y = -3.9;
    const BODY_MIN_Y = -4.5;
    const EYE_BLINK = Object.freeze({
        left: /^eye[_ ]?blink[_ ]?(left|l)$/i,
        right: /^eye[_ ]?blink[_ ]?(right|r)$/i,
    });
    const EYE_NODE = Object.freeze({
        left: /^(mixamorig:?)?(left[_ ]?eye|eye[_ ]?(left|l))$/i,
        right: /^(mixamorig:?)?(right[_ ]?eye|eye[_ ]?(right|r))$/i,
    });

    // Centre of the vertices a blink moves (the eye), in the world space of the loaded model
    function blinkCentroid(THREE, object, pattern) {
        const sum = new THREE.Vector3();
        const point = new THREE.Vector3();
        let total = 0;
        object.traverse((child) => {
            if (!child.isMesh || !child.morphTargetDictionary || !child.geometry?.morphAttributes?.position) return;
            const name = Object.keys(child.morphTargetDictionary).find((key) => pattern.test(key));
            const deltas = child.geometry.morphAttributes.position[child.morphTargetDictionary[name]];
            if (!deltas) return;
            const positions = child.geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
                const weight = Math.hypot(deltas.getX(i), deltas.getY(i), deltas.getZ(i));
                if (weight < 1e-6) continue;
                point.fromBufferAttribute(positions, i);
                // Skinned (and quantized) meshes only get their real position from the skeleton
                if (child.isSkinnedMesh) child.applyBoneTransform(i, point);
                point.applyMatrix4(child.matrixWorld);
                sum.addScaledVector(point, weight);
                total += weight;
            }
        });
        return total ? sum.multiplyScalar(1 / total) : null;
    }

    function eyeNodePosition(THREE, object, pattern) {
        let found = null;
        object.traverse((child) => {
            if (!found && pattern.test(child.name)) found = child.getWorldPosition(new THREE.Vector3());
        });
        return found;
    }

    /**
     * Any rigged head or body (Ready Player Me, Avaturn...) to the model convention: origin between
     * the eyes, 1 unit = outer eye distance, face towards +Z. The eyes come from the blink blendshapes
     * (as the bundled avatars are prepared) or from the eye nodes. Bodies are cut below the shoulders.
     */
    function fitAvatar(THREE, object) {
        object.updateMatrixWorld(true);
        const left = blinkCentroid(THREE, object, EYE_BLINK.left) || eyeNodePosition(THREE, object, EYE_NODE.left);
        const right = blinkCentroid(THREE, object, EYE_BLINK.right) || eyeNodePosition(THREE, object, EYE_NODE.right);
        const distance = left && right ? left.distanceTo(right) : 0;
        if (!(distance > 1e-6)) {
            throw new VFX.VideoEffectsError(
                'ASSET_INVALID',
                'The avatar needs eyeBlinkLeft/eyeBlinkRight blendshapes or LeftEye/RightEye nodes'
            );
        }
        const scale = EYE_CENTER_DISTANCE / distance;
        const center = left.clone().add(right).multiplyScalar(0.5);
        // A face looking at the viewer has its left eye on the viewer's right (+X): else turn it 180°
        if (left.x < right.x) object.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
        object.scale.setScalar(scale);
        object.position.copy(center).multiplyScalar(-scale).applyQuaternion(object.quaternion);
        object.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(object);
        return { clipY: box.min.y < BODY_MIN_Y ? BODY_CUT_Y : null };
    }

    class ModelRenderer {
        constructor(options = {}) {
            this.options = { ...DEFAULT_THREE, ...options };
            this.loadPromise = null;
            this.environmentPromise = null;
            this.decodersPromise = null;
            this.models = new Map();
            this.current = null;
            this.destroyed = false;
        }

        load() {
            if (this.loadPromise) return this.loadPromise;
            this.loadPromise = (async () => {
                const [THREE, loaderModule, meshoptModule] = await Promise.all([
                    import(this.options.threeUrl),
                    import(this.options.gltfLoaderUrl),
                    import(this.options.meshoptDecoderUrl),
                ]);
                if (this.destroyed) throw new VFX.VideoEffectsError('DESTROYED', 'Video effects destroyed');
                this.THREE = THREE;
                this.loader = new loaderModule.GLTFLoader();
                this.loader.setMeshoptDecoder(meshoptModule.MeshoptDecoder);
                this.canvas = document.createElement('canvas');
                this.renderer = new THREE.WebGLRenderer({
                    canvas: this.canvas,
                    alpha: true,
                    antialias: true,
                    premultipliedAlpha: true,
                    powerPreference: 'default',
                });
                this.renderer.setPixelRatio(1);
                this.renderer.setClearColor(0x000000, 0);
                this.renderer.localClippingEnabled = true;

                this.scene = new THREE.Scene();
                this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, -100000, 100000);
                this.hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x404040, 1.8);
                this.scene.add(this.hemisphereLight);
                this.keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
                this.keyLight.position.set(0.4, 0.8, 1);
                this.scene.add(this.keyLight);

                this.anchor = new THREE.Group();
                this.anchor.matrixAutoUpdate = false;
                this.scene.add(this.anchor);

                // Head volume behind the face, depth only
                this.occluder = new THREE.Mesh(
                    new THREE.SphereGeometry(1, 32, 24),
                    new THREE.MeshBasicMaterial({ colorWrite: false })
                );
                this.occluder.scale.set(0.82, 1.15, 1.0);
                this.occluder.position.set(0, -0.25, -1.02);
                this.occluder.renderOrder = -1;
                this.anchor.add(this.occluder);
                this.matrix = new THREE.Matrix4();
                this.rotation = new THREE.Matrix4();
                this.headRotation = new THREE.Quaternion();
                this.bodyRotation = new THREE.Quaternion();
                this.identity = new THREE.Quaternion();
                this.position = new THREE.Vector3();
                this.pivot = new THREE.Vector3();
                this.size = new THREE.Vector3();
                this.up = new THREE.Vector3();
                this.cutPoint = new THREE.Vector3();
            })().catch((error) => {
                this.loadPromise = null;
                if (error instanceof VFX.VideoEffectsError) throw error;
                throw new VFX.VideoEffectsError('THREE_LOAD_FAILED', 'Unable to start the 3D renderer', error);
            });
            return this.loadPromise;
        }

        // Soft studio lighting for avatars (prefiltered once, reused)
        loadEnvironment() {
            if (!this.environmentPromise) {
                this.environmentPromise = import(this.options.roomEnvironmentUrl)
                    .then(({ RoomEnvironment }) => {
                        if (this.destroyed || !this.renderer) return null;
                        const generator = new this.THREE.PMREMGenerator(this.renderer);
                        const room = new RoomEnvironment();
                        this.environment = generator.fromScene(room, 0.04).texture;
                        room.dispose?.();
                        generator.dispose();
                        return this.environment;
                    })
                    .catch((error) => {
                        // Still usable with the direct lights only
                        console.warn('[VideoEffects] Avatar environment lighting unavailable', error);
                        this.environmentPromise = null;
                        return null;
                    });
            }
            return this.environmentPromise;
        }

        // Custom models may use Draco geometry or KTX2 textures: decoders are only fetched for them
        enableCustomDecoders() {
            if (!this.decodersPromise) {
                this.decodersPromise = Promise.all([
                    import(this.options.dracoLoaderUrl),
                    import(this.options.ktx2LoaderUrl),
                ])
                    .then(([{ DRACOLoader }, { KTX2Loader }]) => {
                        if (this.destroyed || !this.renderer) return;
                        this.dracoLoader = new DRACOLoader().setDecoderPath(this.options.dracoDecoderPath);
                        this.ktx2Loader = new KTX2Loader()
                            .setTranscoderPath(this.options.ktx2TranscoderPath)
                            .detectSupport(this.renderer);
                        this.loader.setDRACOLoader(this.dracoLoader).setKTX2Loader(this.ktx2Loader);
                    })
                    .catch((error) => {
                        // Plain models still load
                        console.warn('[VideoEffects] Draco/KTX2 decoders unavailable', error);
                        this.decodersPromise = null;
                    });
            }
            return this.decodersPromise;
        }

        loadModel(url, fit = false) {
            if (!this.models.has(url)) {
                const promise = this.loader.loadAsync(url).then(
                    (gltf) => {
                        if (fit) gltf.scene.userData.vfxFit = fitAvatar(this.THREE, gltf.scene);
                        return gltf.scene;
                    },
                    (error) => {
                        throw new VFX.VideoEffectsError('ASSET_LOAD_FAILED', `Unable to load 3D model ${url}`, error);
                    }
                );
                // Do not cache failures: the asset may become reachable again
                promise.catch(() => this.models.delete(url));
                this.models.set(url, promise);
            }
            return this.models.get(url);
        }

        // Morph targets, neck bone and materials of an avatar (prepared once per model)
        prepareAvatar(object, config) {
            if (!object.userData.vfxAvatar) {
                const morphs = [];
                const names = new Set();
                const materials = new Set();
                let head = null;
                object.traverse((child) => {
                    if (child.isBone && child.name === 'avatarHead') head = child;
                    if (!child.isMesh) return;
                    // Skinned busts move far from their bind pose bounds: never cull them
                    child.frustumCulled = false;
                    (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) =>
                        materials.add(material)
                    );
                    if (!child.morphTargetDictionary) return;
                    const entries = Object.entries(child.morphTargetDictionary);
                    entries.forEach(([name]) => names.add(name));
                    morphs.push({ mesh: child, entries });
                });
                object.userData.vfxAvatar = {
                    morphs,
                    names: [...names],
                    head,
                    headRest: head ? head.position.clone() : null,
                    materials: [...materials],
                    plane: new this.THREE.Plane(),
                };
            }
            const avatar = object.userData.vfxAvatar;
            avatar.materials.forEach((material) => {
                material.clippingPlanes = config.clipY === null ? null : [avatar.plane];
                material.needsUpdate = true;
            });
            this.morphValues = new Map(avatar.names.map((name) => [name, 0]));
            this.morphTime = null;
            return avatar;
        }

        async setModel(definition, url) {
            await this.load();
            if (definition.fit) await this.enableCustomDecoders();
            const [object, environment] = await Promise.all([
                this.loadModel(url, definition.fit),
                definition.avatar ? this.loadEnvironment() : null,
            ]);
            if (this.destroyed) return;
            // A fitted model decides its own cut (bodies are cut below the shoulders)
            const config = object.userData.vfxFit ? { ...definition, clipY: object.userData.vfxFit.clipY } : definition;
            this.clearModel();
            const avatar = config.avatar ? this.prepareAvatar(object, config) : null;
            this.current = { object, config, avatar };
            this.occluder.visible = config.occluder;
            // Accessories keep the original flat lighting, avatars get a studio look
            this.scene.environment = avatar ? environment : null;
            this.scene.environmentIntensity = 0.8;
            this.hemisphereLight.visible = !avatar || !environment;
            this.keyLight.intensity = avatar ? 1.4 : 1.6;
            this.renderer.toneMapping = avatar ? this.THREE.ACESFilmicToneMapping : this.THREE.NoToneMapping;
            this.anchor.add(object);
        }

        clearModel() {
            if (this.current) {
                this.anchor.remove(this.current.object);
                this.current.avatar?.head?.quaternion.identity();
            }
            this.current = null;
        }

        updateMorphs(avatar, face) {
            const now = performance.now();
            const dt = this.morphTime === null ? 1000 : Math.min(250, Math.max(0, now - this.morphTime));
            this.morphTime = now;
            const alpha = 1 - Math.exp(-dt / MORPH_TAU_MS);
            const values = this.morphValues;
            for (let i = 0; i < avatar.names.length; i++) {
                const name = avatar.names[i];
                const previous = values.get(name);
                const target = Math.min(1, Math.max(0, blendshapeWeight(name, face)));
                values.set(name, previous + (target - previous) * alpha);
            }
            for (let m = 0; m < avatar.morphs.length; m++) {
                const { mesh, entries } = avatar.morphs[m];
                const influences = mesh.morphTargetInfluences;
                for (let i = 0; i < entries.length; i++) influences[entries[i][1]] = values.get(entries[i][0]);
            }
        }

        render(face, width, height) {
            if (!this.current || !face || !this.renderer) return null;
            if (this.canvas.width !== width || this.canvas.height !== height) {
                this.renderer.setSize(width, height, false);
            }
            const camera = this.camera;
            if (camera.right !== width || camera.bottom !== -height) {
                camera.left = 0;
                camera.right = width;
                camera.top = 0;
                camera.bottom = -height;
                camera.updateProjectionMatrix();
            }

            const { config, avatar } = this.current;
            const { pose, points } = face;
            const { x, y, z } = pose.axes;
            const s = pose.scale * config.scale;
            const [ox, oy, oz] = config.offset;
            const anchor = vec3.add(
                VFX.averagePoint(points, config.anchor),
                vec3.add(
                    vec3.scale(x, ox * pose.scale),
                    vec3.add(vec3.scale(y, oy * pose.scale), vec3.scale(z, oz * pose.scale))
                )
            );
            // Camera pixels (x right, y down, z away) to Three.js world (x right, y up, z towards viewer)
            const mx = [x[0], -x[1], -x[2]];
            const my = [-y[0], y[1], y[2]];
            const mz = [-z[0], z[1], z[2]];
            if (avatar) {
                this.poseAvatar(avatar, config, [mx, my, mz], [anchor[0], -anchor[1], 0], s);
                this.updateMorphs(avatar, face);
            } else {
                this.matrix.set(
                    mx[0] * s, my[0] * s, mz[0] * s, anchor[0],
                    mx[1] * s, my[1] * s, mz[1] * s, -anchor[1],
                    mx[2] * s, my[2] * s, mz[2] * s, 0,
                    0, 0, 0, 1
                ); // prettier-ignore
                this.anchor.matrix.copy(this.matrix);
            }
            this.anchor.matrixWorldNeedsUpdate = true;
            this.renderer.render(this.scene, camera);
            return this.canvas;
        }

        /**
         * Busts with an "avatarHead" bone: the body turns with part of the head rotation and the
         * head bone adds the rest, keeping the eyes (model origin) on the user's eyes:
         * eyes = T + s * (Rbody * pivot + Rhead * (0 - pivot))  =>  T = eyes - s * (Rbody - Rhead) * pivot
         */
        poseAvatar(avatar, config, [mx, my, mz], eyes, s) {
            this.rotation.set(
                mx[0], my[0], mz[0], 0,
                mx[1], my[1], mz[1], 0,
                mx[2], my[2], mz[2], 0,
                0, 0, 0, 1
            ); // prettier-ignore
            this.headRotation.setFromRotationMatrix(this.rotation);
            this.position.set(eyes[0], eyes[1], eyes[2]);
            if (avatar.head) {
                this.bodyRotation.copy(this.identity).slerp(this.headRotation, BODY_FOLLOW);
                avatar.head.quaternion.copy(this.bodyRotation).invert().multiply(this.headRotation);
                this.pivot.copy(avatar.headRest).applyQuaternion(this.bodyRotation);
                this.position.addScaledVector(this.pivot, -s);
                this.pivot.copy(avatar.headRest).applyQuaternion(this.headRotation);
                this.position.addScaledVector(this.pivot, s);
            } else {
                this.bodyRotation.copy(this.headRotation);
            }
            this.anchor.matrix.compose(this.position, this.bodyRotation, this.size.set(s, s, s));
            if (config.clipY !== null) {
                // Keeps what is above the cut, in the body frame
                this.up.set(0, 1, 0).applyQuaternion(this.bodyRotation);
                this.cutPoint.set(0, config.clipY, 0).applyMatrix4(this.anchor.matrix);
                avatar.plane.setFromNormalAndCoplanarPoint(this.up, this.cutPoint);
            }
        }

        destroy() {
            this.destroyed = true;
            this.clearModel();
            this.models.forEach((promise) => promise.then(disposeObject, () => {}));
            this.models.clear();
            if (this.occluder) disposeObject(this.occluder);
            this.environment?.dispose();
            this.environment = null;
            this.dracoLoader?.dispose();
            this.ktx2Loader?.dispose();
            if (this.renderer) {
                this.renderer.dispose();
                this.renderer.forceContextLoss();
            }
            this.renderer = null;
            this.scene = null;
            this.canvas = null;
        }
    }

    VFX.THREE_DEFAULTS = DEFAULT_THREE;
    VFX.ModelRenderer = ModelRenderer;
    VFX.fitAvatar = fitAvatar;
    VFX.blendshapeWeight = blendshapeWeight;
})(typeof globalThis !== 'undefined' ? globalThis : self);

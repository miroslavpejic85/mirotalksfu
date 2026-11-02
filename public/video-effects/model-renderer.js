'use strict';

/**
 * MiroTalk Video Effects - optional 3D (GLB/GLTF) accessories.
 *
 * Three.js (MIT) and its GLTFLoader are imported on demand, only when a 3D effect is selected.
 * The model is posed with the face basis and drawn with an orthographic camera in output pixels,
 * so it lines up exactly with the 2D accessories. An invisible head occluder writes depth only,
 * hiding parts of the model behind the head (e.g. the far temple of a pair of glasses).
 *
 * Model convention: 1 unit = distance between the outer eye corners, origin at the anchor,
 * +X towards the subject's left (image right), +Y up, +Z out of the face (glTF front).
 */
(function (root) {
    const VFX = (root.MiroTalkVFX = root.MiroTalkVFX || {});
    const { vec3 } = VFX;

    const THREE_VERSION = '0.181.0';
    const DEFAULT_THREE = Object.freeze({
        threeUrl: `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/+esm`,
        gltfLoaderUrl: `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/loaders/GLTFLoader.js/+esm`,
    });

    function disposeObject(object) {
        object.traverse((child) => {
            child.geometry?.dispose();
            const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
            materials.forEach((material) => {
                Object.values(material).forEach((value) => {
                    if (value && value.isTexture) value.dispose();
                });
                material.dispose();
            });
        });
    }

    class ModelRenderer {
        constructor(options = {}) {
            this.options = { ...DEFAULT_THREE, ...options };
            this.loadPromise = null;
            this.models = new Map();
            this.current = null;
            this.destroyed = false;
        }

        load() {
            if (this.loadPromise) return this.loadPromise;
            this.loadPromise = (async () => {
                const [THREE, loaderModule] = await Promise.all([
                    import(this.options.threeUrl),
                    import(this.options.gltfLoaderUrl),
                ]);
                if (this.destroyed) throw new VFX.VideoEffectsError('DESTROYED', 'Video effects destroyed');
                this.THREE = THREE;
                this.loader = new loaderModule.GLTFLoader();
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

                this.scene = new THREE.Scene();
                this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, -100000, 100000);
                this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.8));
                const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
                keyLight.position.set(0.4, 0.8, 1);
                this.scene.add(keyLight);

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
            })().catch((error) => {
                this.loadPromise = null;
                if (error instanceof VFX.VideoEffectsError) throw error;
                throw new VFX.VideoEffectsError('THREE_LOAD_FAILED', 'Unable to start the 3D renderer', error);
            });
            return this.loadPromise;
        }

        loadModel(url) {
            if (!this.models.has(url)) {
                const promise = this.loader.loadAsync(url).then(
                    (gltf) => gltf.scene,
                    (error) => {
                        this.models.delete(url);
                        throw new VFX.VideoEffectsError('ASSET_LOAD_FAILED', `Unable to load 3D model ${url}`, error);
                    }
                );
                this.models.set(url, promise);
            }
            return this.models.get(url);
        }

        async setModel(config, url) {
            await this.load();
            const object = await this.loadModel(url);
            if (this.destroyed) return;
            this.clearModel();
            this.current = { object, config };
            this.occluder.visible = config.occluder;
            this.anchor.add(object);
        }

        clearModel() {
            if (this.current) this.anchor.remove(this.current.object);
            this.current = null;
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

            const { config } = this.current;
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
            this.matrix.set(
                mx[0] * s, my[0] * s, mz[0] * s, anchor[0],
                mx[1] * s, my[1] * s, mz[1] * s, -anchor[1],
                mx[2] * s, my[2] * s, mz[2] * s, 0,
                0, 0, 0, 1
            ); // prettier-ignore
            this.anchor.matrix.copy(this.matrix);
            this.anchor.matrixWorldNeedsUpdate = true;
            this.renderer.render(this.scene, camera);
            return this.canvas;
        }

        destroy() {
            this.destroyed = true;
            this.clearModel();
            this.models.forEach((promise) => promise.then(disposeObject, () => {}));
            this.models.clear();
            if (this.occluder) disposeObject(this.occluder);
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
})(typeof globalThis !== 'undefined' ? globalThis : self);

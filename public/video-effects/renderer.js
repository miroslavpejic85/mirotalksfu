'use strict';

/**
 * MiroTalk Video Effects - renderers.
 *
 * WebGLRenderer (WebGL2 or WebGL1) draws the camera frame through a single filter shader
 * (brightness, contrast, saturation, grayscale, sepia, temperature and skin smoothing) and then
 * the accessory quads, all on the GPU. Canvas2DRenderer is the fallback for devices without
 * WebGL: same interface, colour filters through CanvasRenderingContext2D.filter when supported.
 *
 * Accessories are passed as 4 corners (TL, TR, BR, BL) in canvas pixels. They come from an
 * orthographic projection of a planar quad, so they are always a parallelogram and the 2D
 * renderer can draw them exactly with an affine transform.
 */
(function (root) {
    const VFX = (root.MiroTalkVFX = root.MiroTalkVFX || {});

    const SMOOTHING_TAPS = 12;

    const VIDEO_VERTEX_SHADER = `
        attribute vec2 a_position;
        varying vec2 v_uv;
        void main() {
            v_uv = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
            gl_Position = vec4(a_position, 0.0, 1.0);
        }
    `;

    const VIDEO_FRAGMENT_SHADER = `
        precision mediump float;
        varying vec2 v_uv;
        uniform sampler2D u_texture;
        uniform float u_brightness;
        uniform float u_contrast;
        uniform float u_saturation;
        uniform float u_grayscale;
        uniform float u_sepia;
        uniform float u_temperature;
        uniform float u_smoothing;
        uniform vec2 u_offsets[${SMOOTHING_TAPS}];

        const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

        // Soft YCbCr skin range, wide enough for most skin tones and lighting conditions
        float skinMask(vec3 c) {
            float y = dot(c, vec3(0.299, 0.587, 0.114));
            float cb = (c.b - y) * 0.564 + 0.5;
            float cr = (c.r - y) * 0.713 + 0.5;
            float mcb = smoothstep(0.27, 0.31, cb) * (1.0 - smoothstep(0.49, 0.53, cb));
            float mcr = smoothstep(0.50, 0.54, cr) * (1.0 - smoothstep(0.67, 0.71, cr));
            return mcb * mcr * smoothstep(0.08, 0.16, y);
        }

        // Edge-preserving (bilateral-like) blur restricted to skin, keeps eyes, hair and edges sharp
        vec3 smoothSkin(vec3 c0) {
            vec3 sum = c0;
            float weights = 1.0;
            for (int i = 0; i < ${SMOOTHING_TAPS}; i++) {
                vec3 c = texture2D(u_texture, v_uv + u_offsets[i]).rgb;
                vec3 d = c - c0;
                float w = exp(-dot(d, d) * 80.0);
                sum += c * w;
                weights += w;
            }
            return mix(c0, sum / weights, u_smoothing * skinMask(c0));
        }

        void main() {
            vec4 color = texture2D(u_texture, v_uv);
            vec3 c = color.rgb;
            if (u_smoothing > 0.001) c = smoothSkin(c);
            // Same order and formulas as the CSS filter functions used by the 2D fallback
            c *= u_brightness;
            c = (c - 0.5) * u_contrast + 0.5;
            float luma = dot(c, LUMA);
            c = mix(vec3(luma), c, u_saturation);
            c = mix(c, vec3(dot(c, LUMA)), u_grayscale);
            vec3 sepia = vec3(
                dot(c, vec3(0.393, 0.769, 0.189)),
                dot(c, vec3(0.349, 0.686, 0.168)),
                dot(c, vec3(0.272, 0.534, 0.131))
            );
            c = mix(c, sepia, u_sepia);
            c += vec3(0.10, 0.02, -0.10) * u_temperature;
            c = clamp(c, 0.0, 1.0);
            gl_FragColor = vec4(c * color.a, color.a);
        }
    `;

    const QUAD_VERTEX_SHADER = `
        attribute vec2 a_position;
        attribute vec2 a_uv;
        uniform vec2 u_resolution;
        varying vec2 v_uv;
        void main() {
            vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
            gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
            v_uv = a_uv;
        }
    `;

    const QUAD_FRAGMENT_SHADER = `
        precision mediump float;
        varying vec2 v_uv;
        uniform sampler2D u_texture;
        uniform float u_opacity;
        void main() {
            gl_FragColor = texture2D(u_texture, v_uv) * u_opacity;
        }
    `;

    const DEFAULT_FILTERS = Object.freeze({
        brightness: 1,
        contrast: 1,
        saturation: 1,
        grayscale: 0,
        sepia: 0,
        temperature: 0,
        smoothing: 0,
    });

    function cssFilter(filters) {
        const f = { ...DEFAULT_FILTERS, ...filters };
        return [
            `brightness(${f.brightness})`,
            `contrast(${f.contrast})`,
            `saturate(${f.saturation})`,
            `grayscale(${f.grayscale})`,
            `sepia(${f.sepia})`,
        ].join(' ');
    }

    function isPowerOfTwo(value) {
        return (value & (value - 1)) === 0;
    }

    class WebGLRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.type = 'webgl';
            this.textures = new Map();
            this.lost = false;
            const options = {
                alpha: true,
                premultipliedAlpha: true,
                antialias: false,
                depth: false,
                stencil: false,
                preserveDrawingBuffer: false,
                powerPreference: 'default',
            };
            let gl = canvas.getContext('webgl2', options);
            if (gl) {
                this.type = 'webgl2';
            } else {
                gl = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options);
            }
            if (!gl) throw new VFX.VideoEffectsError('WEBGL_UNAVAILABLE', 'WebGL is not available');
            this.gl = gl;
            this.capabilities = { filters: true, smoothing: true, webgl: true };

            this.onContextLost = (event) => {
                event.preventDefault();
                this.lost = true;
                console.warn('[VideoEffects] WebGL context lost');
            };
            this.onContextRestored = () => {
                console.info('[VideoEffects] WebGL context restored');
                this.textures.clear();
                this.setup();
                this.lost = false;
            };
            canvas.addEventListener('webglcontextlost', this.onContextLost);
            canvas.addEventListener('webglcontextrestored', this.onContextRestored);
            this.setup();
        }

        setup() {
            const gl = this.gl;
            this.videoProgram = this.createProgram(VIDEO_VERTEX_SHADER, VIDEO_FRAGMENT_SHADER);
            this.quadProgram = this.createProgram(QUAD_VERTEX_SHADER, QUAD_FRAGMENT_SHADER);

            this.videoUniforms = this.getUniforms(this.videoProgram, [
                'u_texture',
                'u_brightness',
                'u_contrast',
                'u_saturation',
                'u_grayscale',
                'u_sepia',
                'u_temperature',
                'u_smoothing',
                'u_offsets',
            ]);
            this.quadUniforms = this.getUniforms(this.quadProgram, ['u_texture', 'u_opacity', 'u_resolution']);
            this.videoPositionLocation = gl.getAttribLocation(this.videoProgram, 'a_position');
            this.quadPositionLocation = gl.getAttribLocation(this.quadProgram, 'a_position');
            this.quadUvLocation = gl.getAttribLocation(this.quadProgram, 'a_uv');

            this.fullscreenBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

            this.quadBuffer = gl.createBuffer();
            this.quadData = new Float32Array(16);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.quadData.byteLength, gl.DYNAMIC_DRAW);

            this.videoTexture = this.createTexture();
            this.overlayTexture = this.createTexture();
            this.offsetsFor = null;
        }

        createShader(type, source) {
            const gl = this.gl;
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
                const log = gl.getShaderInfoLog(shader);
                gl.deleteShader(shader);
                throw new VFX.VideoEffectsError('WEBGL_SHADER', `Shader compilation failed: ${log}`);
            }
            return shader;
        }

        createProgram(vertexSource, fragmentSource) {
            const gl = this.gl;
            const vertex = this.createShader(gl.VERTEX_SHADER, vertexSource);
            const fragment = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
            const program = gl.createProgram();
            gl.attachShader(program, vertex);
            gl.attachShader(program, fragment);
            gl.linkProgram(program);
            gl.deleteShader(vertex);
            gl.deleteShader(fragment);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
                const log = gl.getProgramInfoLog(program);
                gl.deleteProgram(program);
                throw new VFX.VideoEffectsError('WEBGL_PROGRAM', `Program link failed: ${log}`);
            }
            return program;
        }

        getUniforms(program, names) {
            const uniforms = {};
            names.forEach((name) => {
                uniforms[name] = this.gl.getUniformLocation(program, name);
            });
            return uniforms;
        }

        createTexture() {
            const gl = this.gl;
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            return texture;
        }

        resize(width, height) {
            if (this.canvas.width !== width || this.canvas.height !== height) {
                this.canvas.width = width;
                this.canvas.height = height;
            }
        }

        updateSmoothingOffsets(width, height) {
            const key = `${width}x${height}`;
            if (this.offsetsFor === key) return;
            this.offsetsFor = key;
            // Two rings of samples, radius scaled with the resolution so 720p and 1080p look alike
            const radius = 2.2 * Math.max(1, height / 720);
            const offsets = new Float32Array(SMOOTHING_TAPS * 2);
            for (let i = 0; i < SMOOTHING_TAPS; i++) {
                const angle = (i / SMOOTHING_TAPS) * Math.PI * 2;
                const r = i % 2 === 0 ? radius : radius * 2;
                offsets[i * 2] = (Math.cos(angle) * r) / width;
                offsets[i * 2 + 1] = (Math.sin(angle) * r) / height;
            }
            this.smoothingOffsets = offsets;
        }

        drawVideo(source, filters = DEFAULT_FILTERS) {
            if (this.lost) return false;
            const gl = this.gl;
            const { width, height } = this.canvas;
            const f = { ...DEFAULT_FILTERS, ...filters };

            gl.viewport(0, 0, width, height);
            gl.disable(gl.BLEND);
            gl.useProgram(this.videoProgram);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

            const u = this.videoUniforms;
            gl.uniform1i(u.u_texture, 0);
            gl.uniform1f(u.u_brightness, f.brightness);
            gl.uniform1f(u.u_contrast, f.contrast);
            gl.uniform1f(u.u_saturation, f.saturation);
            gl.uniform1f(u.u_grayscale, f.grayscale);
            gl.uniform1f(u.u_sepia, f.sepia);
            gl.uniform1f(u.u_temperature, f.temperature);
            gl.uniform1f(u.u_smoothing, f.smoothing);
            if (f.smoothing > 0) {
                this.updateSmoothingOffsets(width, height);
                gl.uniform2fv(u.u_offsets, this.smoothingOffsets);
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
            gl.enableVertexAttribArray(this.videoPositionLocation);
            gl.vertexAttribPointer(this.videoPositionLocation, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.disableVertexAttribArray(this.videoPositionLocation);
            return true;
        }

        getImageTexture(image) {
            let texture = this.textures.get(image);
            if (texture) return texture;
            const gl = this.gl;
            texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            // Mipmaps keep small, distant accessories crisp (WebGL1 needs power-of-two sizes)
            if (this.type === 'webgl2' || (isPowerOfTwo(image.width) && isPowerOfTwo(image.height))) {
                gl.generateMipmap(gl.TEXTURE_2D);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            } else {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            }
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            this.textures.set(image, texture);
            return texture;
        }

        drawTexturedQuad(texture, corners, opacity) {
            const gl = this.gl;
            const { width, height } = this.canvas;
            const d = this.quadData;
            // Triangle strip order: TL, TR, BL, BR
            d.set([corners[0], corners[1], 0, 0, corners[2], corners[3], 1, 0]);
            d.set([corners[6], corners[7], 0, 1, corners[4], corners[5], 1, 1], 8);

            gl.viewport(0, 0, width, height);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.useProgram(this.quadProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.uniform1i(this.quadUniforms.u_texture, 0);
            gl.uniform1f(this.quadUniforms.u_opacity, opacity);
            gl.uniform2f(this.quadUniforms.u_resolution, width, height);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
            gl.enableVertexAttribArray(this.quadPositionLocation);
            gl.vertexAttribPointer(this.quadPositionLocation, 2, gl.FLOAT, false, 16, 0);
            gl.enableVertexAttribArray(this.quadUvLocation);
            gl.vertexAttribPointer(this.quadUvLocation, 2, gl.FLOAT, false, 16, 8);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.disableVertexAttribArray(this.quadPositionLocation);
            gl.disableVertexAttribArray(this.quadUvLocation);
        }

        drawImageQuad(image, corners, opacity = 1) {
            if (this.lost || opacity <= 0) return;
            this.drawTexturedQuad(this.getImageTexture(image), corners, opacity);
        }

        // Composite a full-frame canvas (3D accessories) over the current frame
        drawOverlay(canvas, opacity = 1) {
            if (this.lost || opacity <= 0) return;
            const gl = this.gl;
            const { width, height } = this.canvas;
            gl.bindTexture(gl.TEXTURE_2D, this.overlayTexture);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            this.drawTexturedQuad(this.overlayTexture, [0, 0, width, 0, width, height, 0, height], opacity);
        }

        // Free GPU textures of accessories that are no longer used
        retainImages(images) {
            this.textures.forEach((texture, image) => {
                if (images.has(image)) return;
                this.gl.deleteTexture(texture);
                this.textures.delete(image);
            });
        }

        destroy() {
            const gl = this.gl;
            this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
            this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
            if (!gl.isContextLost()) {
                this.textures.forEach((texture) => gl.deleteTexture(texture));
                gl.deleteTexture(this.videoTexture);
                gl.deleteTexture(this.overlayTexture);
                gl.deleteBuffer(this.fullscreenBuffer);
                gl.deleteBuffer(this.quadBuffer);
                gl.deleteProgram(this.videoProgram);
                gl.deleteProgram(this.quadProgram);
                // Release the context right away instead of waiting for garbage collection
                gl.getExtension('WEBGL_lose_context')?.loseContext();
            }
            this.textures.clear();
        }
    }

    class Canvas2DRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.type = '2d';
            this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: false });
            if (!this.ctx) throw new VFX.VideoEffectsError('CANVAS_UNAVAILABLE', 'Canvas 2D is not available');
            this.supportsFilter = this.detectFilterSupport();
            this.capabilities = { filters: this.supportsFilter, smoothing: false, webgl: false };
        }

        detectFilterSupport() {
            if (!('filter' in this.ctx)) return false;
            this.ctx.filter = 'grayscale(1)';
            const supported = this.ctx.filter === 'grayscale(1)';
            this.ctx.filter = 'none';
            return supported;
        }

        resize(width, height) {
            if (this.canvas.width !== width || this.canvas.height !== height) {
                this.canvas.width = width;
                this.canvas.height = height;
            }
        }

        drawVideo(source, filters = DEFAULT_FILTERS) {
            const ctx = this.ctx;
            const { width, height } = this.canvas;
            const f = { ...DEFAULT_FILTERS, ...filters };
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.clearRect(0, 0, width, height);
            if (this.supportsFilter) ctx.filter = cssFilter(f);
            ctx.drawImage(source, 0, 0, width, height);
            if (this.supportsFilter) ctx.filter = 'none';
            if (this.supportsFilter && f.temperature) {
                // Approximation of the shader temperature shift
                const amount = Math.min(1, Math.abs(f.temperature)) * 0.35;
                ctx.globalCompositeOperation = 'soft-light';
                ctx.fillStyle = f.temperature > 0 ? `rgba(255,150,40,${amount})` : `rgba(40,130,255,${amount})`;
                ctx.fillRect(0, 0, width, height);
                ctx.globalCompositeOperation = 'source-over';
            }
            return true;
        }

        drawImageQuad(image, corners, opacity = 1) {
            if (opacity <= 0) return;
            const ctx = this.ctx;
            const w = image.width;
            const h = image.height;
            const a = (corners[2] - corners[0]) / w;
            const b = (corners[3] - corners[1]) / w;
            const c = (corners[6] - corners[0]) / h;
            const d = (corners[7] - corners[1]) / h;
            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.setTransform(a, b, c, d, corners[0], corners[1]);
            ctx.drawImage(image, 0, 0, w, h);
            ctx.restore();
        }

        drawOverlay(canvas, opacity = 1) {
            if (opacity <= 0) return;
            const ctx = this.ctx;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = opacity;
            ctx.drawImage(canvas, 0, 0, this.canvas.width, this.canvas.height);
            ctx.restore();
        }

        retainImages() {}

        destroy() {}
    }

    function createRenderer(canvas, { preferWebGL = true } = {}) {
        if (preferWebGL) {
            try {
                return new WebGLRenderer(canvas);
            } catch (error) {
                console.warn('[VideoEffects] WebGL renderer unavailable, using Canvas 2D', error);
                // A canvas that already returned a WebGL context cannot provide a 2D one
                if (error?.code !== 'WEBGL_UNAVAILABLE') {
                    canvas = document.createElement('canvas');
                }
            }
        }
        return new Canvas2DRenderer(canvas);
    }

    VFX.DEFAULT_FILTERS = DEFAULT_FILTERS;
    VFX.cssFilter = cssFilter;
    VFX.WebGLRenderer = WebGLRenderer;
    VFX.Canvas2DRenderer = Canvas2DRenderer;
    VFX.createRenderer = createRenderer;
})(typeof globalThis !== 'undefined' ? globalThis : self);

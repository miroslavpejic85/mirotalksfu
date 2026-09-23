'use strict';

/**
 * MiroTalk SFU - Video Drawing Overlay
 *
 * Provides a per-video Fabric.js canvas overlay for freehand drawing
 * on top of camera or screen video streams. Supports real-time two-way
 * sync via the signaling server. Drawings auto-clear after a configurable
 * timeout. The overlay is fully responsive and scales with video resizes.
 *
 * Sync strategy:
 *  - Drawings use normalized coordinates (0..1) so they scale across devices.
 *  - New strokes are batched and emitted every SYNC_INTERVAL_MS via a callback.
 *  - Remote strokes are received and rendered on the matching overlay.
 *  - Auto-clear runs independently on each peer (each stroke disappears 5s after
 *    it was received/created), keeping clocks loosely in sync.
 *
 * @link    GitHub: https://github.com/miroslavpejic85/mirotalksfu
 * @license For open source use: AGPLv3
 */

class VideoDrawingOverlay {
    /**
     * Registry of all active overlays, keyed by .Camera div ID.
     * @type {Map<string, VideoDrawingOverlay>}
     */
    static overlays = new Map();

    /** Text events received before their screen tile exists, keyed by producer ID. */
    static pendingTextEvents = new Map();

    /** Auto-clear delay in milliseconds */
    static AUTO_CLEAR_MS = 5000;

    /** Batched sync interval in milliseconds */
    static SYNC_INTERVAL_MS = 1000;

    /** Default brush color (semi-transparent yellow) */
    static BRUSH_COLOR = 'rgba(255, 255, 0, 0.7)';

    /** Default brush width as fraction of canvas width (scales with size) */
    static BRUSH_WIDTH = 4;

    /**
     * Global callback set by RoomClient to emit drawing data via the signaling server.
     * Signature: (data: { cameraId, paths: [{ d, color, width }] }) => void
     * @type {Function|null}
     */
    static onEmitDrawing = null;

    static getLocalDrawerId = null;

    static resolveDrawerName = null;

    /**
     * Create a drawing overlay for a .Camera container.
     * @param {HTMLElement} cameraDivEl - The .Camera wrapper div
     */
    constructor(cameraDivEl, producerId = cameraDivEl.id.replace('__video', '')) {
        this.cameraDivEl = cameraDivEl;
        this.cameraId = cameraDivEl.id;
        this.producerId = producerId;
        this.isActive = false;
        this.activeTool = null;
        this._clearTimers = new Map();
        this._drawerLabels = new Map();
        this.textAnnotations = new Map();

        /** Pending local strokes (normalized) waiting to be batched and sent */
        this._pendingPaths = [];

        /** Batch timer ID */
        this._syncTimerId = null;

        // Track previous dimensions for proportional scaling
        this._prevWidth = cameraDivEl.offsetWidth;
        this._prevHeight = cameraDivEl.offsetHeight;

        // Create an HTML canvas element inside the .Camera div
        this.canvasEl = document.createElement('canvas');
        this.canvasEl.id = this.cameraId + '__drawCanvas';
        this.canvasEl.className = 'video-drawing-canvas';
        this.canvasEl.width = cameraDivEl.offsetWidth;
        this.canvasEl.height = cameraDivEl.offsetHeight;
        cameraDivEl.appendChild(this.canvasEl);

        // Initialize Fabric.js canvas
        this.fabricCanvas = new fabric.Canvas(this.canvasEl, {
            isDrawingMode: false,
            selection: false,
            renderOnAddRemove: true,
            allowTouchScrolling: false,
        });

        // Add dedicated classes to the Fabric.js wrapper so styles work
        // even when the parent .Camera class is removed (pinned state)
        const wrapper = this.fabricCanvas.wrapperEl;
        if (wrapper) {
            wrapper.classList.add('video-drawing-wrap', 'video-drawing-inactive');
        }

        // Configure the drawing brush
        this._setupBrush();

        // Listen for new drawings to schedule auto-clear and queue for sync
        this._setupPathListener();
        this.fabricCanvas.on('mouse:down', (event) => {
            if (this.activeTool === 'text' && event.e) this._beginTextInput(event.e);
        });

        // Set up ResizeObserver for accurate per-element resize tracking
        this._setupResizeObserver();

        // Register in the global overlay map
        VideoDrawingOverlay.overlays.set(this.cameraId, this);

        for (const data of VideoDrawingOverlay.pendingTextEvents.get(this.producerId) || []) {
            this.receiveText(data);
        }
        VideoDrawingOverlay.pendingTextEvents.delete(this.producerId);

        console.log('[VideoDrawingOverlay] Created for', this.cameraId);
    }

    // ####################################################
    // PRIVATE SETUP
    // ####################################################

    /**
     * Configure the freehand drawing brush.
     * @private
     */
    _setupBrush() {
        const brush = this.fabricCanvas.freeDrawingBrush;
        brush.color = VideoDrawingOverlay.BRUSH_COLOR;
        brush.width = VideoDrawingOverlay.BRUSH_WIDTH;
        brush.decimate = 4; // Reduce point density for better mobile performance
    }

    /**
     * Listen for path:created events. For each local stroke:
     *  1. Schedule auto-clear after AUTO_CLEAR_MS.
     *  2. Normalize coordinates and queue for batched sync.
     * @private
     */
    _setupPathListener() {
        this.fabricCanvas.on('path:created', (opt) => {
            const path = opt.path;
            if (!path) return;

            // Tag as local so we can identify it
            path._isLocal = true;

            const drawerId = VideoDrawingOverlay.getLocalDrawerId?.() || 'local';
            const drawerName = VideoDrawingOverlay.resolveDrawerName?.(drawerId) || 'Participant';
            this._showDrawerLabel(drawerId, drawerName, path);

            // Schedule auto-clear
            this._scheduleAutoClear(path, drawerId);

            // Normalize and queue for sync
            this._queuePathForSync(path);
        });
    }

    /**
     * Schedule removal of a path after AUTO_CLEAR_MS.
     * @param {fabric.Path} path
     * @param {string} drawerId
     * @private
     */
    _scheduleAutoClear(path, drawerId) {
        const timerId = setTimeout(() => {
            this.fabricCanvas.remove(path);
            const drawerLabel = this._drawerLabels.get(drawerId);
            if (drawerLabel?.path === path) {
                this.fabricCanvas.remove(drawerLabel.group);
                this._drawerLabels.delete(drawerId);
            }
            this.fabricCanvas.requestRenderAll();
            this._clearTimers.delete(path);
        }, VideoDrawingOverlay.AUTO_CLEAR_MS);
        this._clearTimers.set(path, timerId);
    }

    /**
     * Convert a fabric.Path to normalized data (0..1 coordinates) and queue it.
     * Starts the batch timer if not already running.
     * @param {fabric.Path} path
     * @private
     */
    _queuePathForSync(path) {
        const w = this.fabricCanvas.getWidth();
        const h = this.fabricCanvas.getHeight();
        if (w <= 0 || h <= 0) return;

        // Serialize to SVG path string — compact representation
        const pathData = path.path;
        if (!pathData) return;

        // Normalize each path command's coordinates to 0..1
        const normalized = pathData.map((cmd) => {
            const op = cmd[0];
            const nums = cmd.slice(1).map((v, i) => {
                // Even indices (0, 2, 4...) are X, odd indices (1, 3, 5...) are Y
                return i % 2 === 0 ? +(v / w).toFixed(4) : +(v / h).toFixed(4);
            });
            return [op, ...nums];
        });

        this._pendingPaths.push({
            d: normalized,
            color: path.stroke || VideoDrawingOverlay.BRUSH_COLOR,
            width: w > 0 ? +(path.strokeWidth / w).toFixed(5) : 0.004,
        });

        // Start the batch timer if not running
        if (!this._syncTimerId) {
            this._syncTimerId = setTimeout(() => {
                this._flushSync();
            }, VideoDrawingOverlay.SYNC_INTERVAL_MS);
        }
    }

    /**
     * Flush all pending paths to the signaling server via the global callback.
     * @private
     */
    _flushSync() {
        this._syncTimerId = null;
        if (this._pendingPaths.length === 0) return;

        const data = {
            cameraId: this.cameraId,
            paths: this._pendingPaths.splice(0),
        };

        if (typeof VideoDrawingOverlay.onEmitDrawing === 'function') {
            VideoDrawingOverlay.onEmitDrawing(data);
        }
    }

    /**
     * Set up a ResizeObserver to resize the canvas when the .Camera div changes.
     * @private
     */
    _setupResizeObserver() {
        this._resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    this._resizeTo(width, height);
                }
            }
        });
        this._resizeObserver.observe(this.cameraDivEl);
    }

    // ####################################################
    // RESIZE
    // ####################################################

    /**
     * Resize the Fabric canvas and scale existing drawings proportionally.
     * @param {number} newWidth
     * @param {number} newHeight
     * @private
     */
    _resizeTo(newWidth, newHeight) {
        const prevW = this._prevWidth;
        const prevH = this._prevHeight;

        if (prevW === newWidth && prevH === newHeight) return;
        if (newWidth <= 0 || newHeight <= 0) return;

        const scaleX = newWidth / prevW;
        const scaleY = newHeight / prevH;

        // Resize Fabric canvas dimensions
        this.fabricCanvas.setWidth(newWidth);
        this.fabricCanvas.setHeight(newHeight);

        // Scale all existing objects proportionally
        this.fabricCanvas.getObjects().forEach((obj) => {
            obj.scaleX = (obj.scaleX || 1) * scaleX;
            obj.scaleY = (obj.scaleY || 1) * scaleY;
            obj.left = (obj.left || 0) * scaleX;
            obj.top = (obj.top || 0) * scaleY;
            obj.setCoords();
        });

        this.fabricCanvas.requestRenderAll();
        this._positionTextAnnotations();

        this._prevWidth = newWidth;
        this._prevHeight = newHeight;
    }

    // ####################################################
    // PUBLIC METHODS
    // ####################################################

    /**
     * Toggle drawing mode on/off.
     * @returns {boolean} The new active state.
     */
    toggle(tool = 'pen', buttons = {}) {
        this.isActive = !this.isActive || this.activeTool !== tool;
        this.activeTool = this.isActive ? tool : null;
        this.fabricCanvas.isDrawingMode = this.isActive && this.activeTool === 'pen';

        // Toggle pointer-events so the canvas doesn't block video interactions
        const wrapper = this.fabricCanvas.wrapperEl;
        if (wrapper) {
            if (this.isActive) {
                wrapper.classList.add('video-drawing-active');
                wrapper.classList.remove('video-drawing-inactive');
            } else {
                wrapper.classList.add('video-drawing-inactive');
                wrapper.classList.remove('video-drawing-active');
            }
        }

        for (const [buttonTool, button] of Object.entries(buttons)) {
            const selected = this.isActive && buttonTool === this.activeTool;
            button.style.color = selected ? 'lime' : '#fff';
            button.setAttribute('aria-pressed', String(selected));
        }
        if (this.activeTool !== 'text') this.textInput?.remove();

        console.log('[VideoDrawingOverlay] Toggle', this.cameraId, this.isActive ? 'ON' : 'OFF');
        return this.isActive;
    }

    _beginTextInput(pointerEvent) {
        pointerEvent.preventDefault();
        this.textInput?.remove();
        const canvasRect = this.fabricCanvas.wrapperEl.getBoundingClientRect();
        const cameraRect = this.cameraDivEl.getBoundingClientRect();
        const point = {
            x: Math.max(0, Math.min(1, (pointerEvent.clientX - canvasRect.left) / canvasRect.width)),
            y: Math.max(0, Math.min(1, (pointerEvent.clientY - canvasRect.top) / canvasRect.height)),
        };
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 80;
        input.className = 'video-drawing-text-input';
        input.placeholder = 'Type annotation';
        input.setAttribute('aria-label', 'Screen text annotation');
        const inputWidth = Math.min(240, Math.max(40, cameraRect.width - 16));
        const inputLeft = Math.min(pointerEvent.clientX - cameraRect.left, cameraRect.width - inputWidth - 8);
        const inputTop = Math.min(pointerEvent.clientY - cameraRect.top, cameraRect.height - 42);
        input.style.left = `${Math.max(8, inputLeft)}px`;
        input.style.top = `${Math.max(8, inputTop)}px`;
        input.style.width = `${inputWidth}px`;
        this.cameraDivEl.appendChild(input);
        this.textInput = input;

        let finished = false;
        const finish = (commit) => {
            if (finished) return;
            finished = true;
            const text = input.value.trim();
            input.remove();
            if (this.textInput === input) this.textInput = null;
            if (!commit || !text) return;
            const annotation = {
                annotationId: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                drawerId: VideoDrawingOverlay.getLocalDrawerId?.(),
                peer_name: VideoDrawingOverlay.resolveDrawerName?.(VideoDrawingOverlay.getLocalDrawerId?.()),
                text,
                ...point,
            };
            this.addTextAnnotation(annotation);
            VideoDrawingOverlay.onEmitDrawing?.({
                type: 'text',
                action: 'create',
                producerId: this.producerId,
                annotationId: annotation.annotationId,
                text,
                x: +point.x.toFixed(4),
                y: +point.y.toFixed(4),
            });
        };
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') finish(true);
            if (event.key === 'Escape') finish(false);
            event.stopPropagation();
        });
        input.addEventListener('blur', () => finish(true));
        input.focus();
    }

    addTextAnnotation(annotation) {
        if (!annotation.annotationId || this.textAnnotations.has(annotation.annotationId)) return;
        const element = document.createElement('div');
        element.className = 'video-drawing-text-annotation';
        element.tabIndex = 0;
        element.setAttribute('role', 'note');
        const drawerName = String(annotation.peer_name || 'Participant').trim();
        element.setAttribute('aria-label', 'Screen text annotation');

        const content = document.createElement('span');
        content.className = 'video-drawing-text-content notranslate';
        content.textContent = annotation.text;
        element.appendChild(content);
        const author = document.createElement('span');
        author.className = 'video-drawing-text-author';
        author.appendChild(document.createTextNode('Annotated by '));
        const authorName = document.createElement('span');
        authorName.className = 'notranslate';
        authorName.textContent = drawerName;
        author.appendChild(authorName);
        element.appendChild(author);

        annotation.element = element;
        this.textAnnotations.set(annotation.annotationId, annotation);
        this.cameraDivEl.appendChild(element);
        if (this._canManageText(annotation)) {
            element.classList.add('video-drawing-text-manageable');
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'video-drawing-text-delete fas fa-times';
            deleteButton.setAttribute('aria-label', 'Delete text annotation');
            deleteButton.addEventListener('click', (event) => {
                event.stopPropagation();
                this.deleteTextAnnotation(annotation.annotationId);
                VideoDrawingOverlay.onEmitDrawing?.({
                    type: 'text',
                    action: 'delete',
                    producerId: this.producerId,
                    annotationId: annotation.annotationId,
                });
            });
            element.appendChild(deleteButton);
            this._bindTextDrag(annotation);
        }
        this._positionTextAnnotation(annotation);
    }

    _canManageText(annotation) {
        const localDrawerId = VideoDrawingOverlay.getLocalDrawerId?.();
        return (
            localDrawerId === annotation.drawerId ||
            localDrawerId === VideoDrawingOverlay.getProducerOwnerId?.(this.producerId)
        );
    }

    _bindTextDrag(annotation) {
        const { element } = annotation;
        let drag = null;
        element.addEventListener('pointerdown', (event) => {
            if (event.target.closest('button') || event.button > 0) return;
            event.preventDefault();
            const rect = element.getBoundingClientRect();
            drag = {
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top,
            };
            element.setPointerCapture(event.pointerId);
            element.classList.add('video-drawing-text-dragging');
        });
        element.addEventListener('pointermove', (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            const canvasRect = this.fabricCanvas.wrapperEl.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            const maxX = Math.max(0, 1 - elementRect.width / canvasRect.width);
            const maxY = Math.max(0, 1 - elementRect.height / canvasRect.height);
            annotation.x = Math.max(
                0,
                Math.min(maxX, (event.clientX - drag.offsetX - canvasRect.left) / canvasRect.width)
            );
            annotation.y = Math.max(
                0,
                Math.min(maxY, (event.clientY - drag.offsetY - canvasRect.top) / canvasRect.height)
            );
            this._positionTextAnnotation(annotation);
        });
        const finishDrag = (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            drag = null;
            element.classList.remove('video-drawing-text-dragging');
            VideoDrawingOverlay.onEmitDrawing?.({
                type: 'text',
                action: 'move',
                producerId: this.producerId,
                annotationId: annotation.annotationId,
                x: +annotation.x.toFixed(4),
                y: +annotation.y.toFixed(4),
            });
        };
        element.addEventListener('pointerup', finishDrag);
        element.addEventListener('pointercancel', finishDrag);
    }

    _positionTextAnnotation(annotation) {
        const wrapper = this.fabricCanvas.wrapperEl;
        const width = wrapper.clientWidth;
        const height = wrapper.clientHeight;
        const annotationScale = Math.max(0.8, Math.min(1, width / 640));
        annotation.element.style.setProperty('--video-drawing-annotation-scale', annotationScale);
        annotation.element.style.maxWidth = `${Math.max(1, Math.min(280 * annotationScale, width - 16))}px`;
        const x = Math.min(annotation.x * width, Math.max(0, width - annotation.element.offsetWidth));
        const y = Math.min(annotation.y * height, Math.max(0, height - annotation.element.offsetHeight));
        annotation.element.style.left = `${wrapper.offsetLeft + x}px`;
        annotation.element.style.top = `${wrapper.offsetTop + y}px`;
        annotation.element.classList.toggle('video-drawing-text-author-below', annotation.y < 0.15);
        annotation.element.classList.toggle('video-drawing-text-author-align-right', annotation.x > 0.6);
    }

    _positionTextAnnotations() {
        for (const annotation of this.textAnnotations.values()) this._positionTextAnnotation(annotation);
    }

    deleteTextAnnotation(annotationId) {
        const annotation = this.textAnnotations.get(annotationId);
        if (!annotation) return;
        annotation.element.remove();
        this.textAnnotations.delete(annotationId);
    }

    clearTextAnnotations() {
        for (const annotation of this.textAnnotations.values()) annotation.element.remove();
        this.textAnnotations.clear();
    }

    receiveText(data) {
        if (data.action === 'move') {
            const annotation = this.textAnnotations.get(data.annotationId);
            if (annotation) {
                annotation.x = data.x;
                annotation.y = data.y;
                this._positionTextAnnotation(annotation);
            }
        } else if (data.action === 'delete') this.deleteTextAnnotation(data.annotationId);
        else if (data.action === 'clear') this.clearTextAnnotations();
        else this.addTextAnnotation(data);
    }

    /**
     * Add remote drawing paths (received from another peer via signaling).
     * Paths use normalized 0..1 coordinates, which are denormalized to the
     * current canvas size.
     * @param {Array<{d: Array, color: string, width: number}>} paths
     * @param {string} [peerName] - Name of the peer who drew (shown as a label)
     * @param {string} [drawerId] - Stable ID of the peer who drew
     */
    addRemotePaths(paths, peerName, drawerId = 'remote') {
        const w = this.fabricCanvas.getWidth();
        const h = this.fabricCanvas.getHeight();
        if (w <= 0 || h <= 0) return;

        for (const pathData of paths) {
            // Denormalize path commands from 0..1 back to pixel coordinates
            const denormalized = pathData.d.map((cmd) => {
                const op = cmd[0];
                const nums = cmd.slice(1).map((v, i) => {
                    return i % 2 === 0 ? v * w : v * h;
                });
                return [op, ...nums];
            });

            const fabricPath = new fabric.Path(denormalized, {
                stroke: pathData.color || VideoDrawingOverlay.BRUSH_COLOR,
                strokeWidth: (pathData.width || 0.004) * w,
                fill: null,
                selectable: false,
                evented: false,
                strokeLineCap: 'round',
                strokeLineJoin: 'round',
            });

            // Tag as remote
            fabricPath._isRemote = true;

            this.fabricCanvas.add(fabricPath);

            this._showDrawerLabel(drawerId, peerName || 'Participant', fabricPath);

            // Auto-clear remote paths too
            this._scheduleAutoClear(fabricPath, drawerId);
        }

        this.fabricCanvas.requestRenderAll();
    }

    /**
     * Show a label beside a drawer's latest stroke.
     * @param {string} drawerId
     * @param {string} peerName
     * @param {fabric.Path} path
     * @private
     */
    _showDrawerLabel(drawerId, peerName, path) {
        const bounds = path.getBoundingRect();
        const canvasWidth = this.fabricCanvas.getWidth();
        const canvasHeight = this.fabricCanvas.getHeight();
        const label =
            String(peerName || 'Participant')
                .trim()
                .slice(0, 40) || 'Participant';
        const text = new fabric.Text(label, {
            left: 6,
            top: 4,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'sans-serif',
            fill: '#fff',
            selectable: false,
            evented: false,
        });
        const labelWidth = Math.min(172, Math.max(40, (text.width || 0) + 12));
        if ((text.width || 0) > labelWidth - 12) text.scaleX = (labelWidth - 12) / text.width;
        const background = new fabric.Rect({
            width: labelWidth,
            height: 22,
            fill: 'rgba(0, 0, 0, 0.78)',
            rx: 3,
            ry: 3,
            selectable: false,
            evented: false,
        });
        const left = Math.max(0, Math.min(canvasWidth - labelWidth, bounds.left + bounds.width + 10));
        const top = Math.max(0, Math.min(canvasHeight - 22, bounds.top + bounds.height - 32));
        const group = new fabric.Group([background, text], {
            left,
            top,
            selectable: false,
            evented: false,
            excludeFromExport: true,
        });
        const previous = this._drawerLabels.get(drawerId);
        if (previous) this.fabricCanvas.remove(previous.group);
        this._drawerLabels.set(drawerId, { group, path });
        this.fabricCanvas.add(group);
    }

    /**
     * Clear all drawings immediately.
     */
    clearAll() {
        // Cancel all pending auto-clear timers
        for (const [, timerId] of this._clearTimers) {
            clearTimeout(timerId);
        }
        this._clearTimers.clear();
        this._drawerLabels.clear();

        // Clear pending sync queue
        this._pendingPaths = [];
        if (this._syncTimerId) {
            clearTimeout(this._syncTimerId);
            this._syncTimerId = null;
        }

        this.fabricCanvas.clear();
        this.fabricCanvas.requestRenderAll();
    }

    /**
     * Destroy the overlay, clean up resources, and remove from the DOM.
     */
    destroy() {
        console.log('[VideoDrawingOverlay] Destroy', this.cameraId);

        // Cancel all pending timers
        for (const [, timerId] of this._clearTimers) {
            clearTimeout(timerId);
        }
        this._clearTimers.clear();

        // Cancel sync timer
        if (this._syncTimerId) {
            clearTimeout(this._syncTimerId);
            this._syncTimerId = null;
        }
        this._pendingPaths = [];

        if (VideoDrawingOverlay.getProducerOwnerId?.(this.producerId) === VideoDrawingOverlay.getLocalDrawerId?.()) {
            VideoDrawingOverlay.onEmitDrawing?.({ type: 'text', action: 'clear', producerId: this.producerId });
        }
        this.textInput?.remove();
        this.clearTextAnnotations();

        this._drawerLabels.clear();

        // Disconnect resize observer
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }

        // Dispose the Fabric.js canvas
        try {
            this.fabricCanvas.dispose();
        } catch (e) {
            console.warn('[VideoDrawingOverlay] Dispose error:', e);
        }

        // Remove wrapper element that Fabric.js creates
        const wrapper = this.cameraDivEl.querySelector('.canvas-container');
        if (wrapper) {
            wrapper.remove();
        }

        // Remove from global registry
        VideoDrawingOverlay.overlays.delete(this.cameraId);
    }

    // ####################################################
    // STATIC METHODS
    // ####################################################

    /**
     * Get or create an overlay for the given .Camera div.
     * @param {HTMLElement} cameraDivEl - The .Camera wrapper div
     * @returns {VideoDrawingOverlay}
     */
    static getOrCreate(cameraDivEl, producerId) {
        const existing = VideoDrawingOverlay.overlays.get(cameraDivEl.id);
        if (existing) return existing;
        return new VideoDrawingOverlay(cameraDivEl, producerId);
    }

    /**
     * Destroy the overlay for a specific .Camera div ID.
     * @param {string} cameraId
     */
    static destroyById(cameraId) {
        const overlay = VideoDrawingOverlay.overlays.get(cameraId);
        if (overlay) overlay.destroy();
    }

    /**
     * Resize all active overlays. Called from VideoGrid.js after layout changes.
     */
    static resizeAll() {
        for (const [, overlay] of VideoDrawingOverlay.overlays) {
            const el = overlay.cameraDivEl;
            if (el) {
                overlay._resizeTo(el.offsetWidth, el.offsetHeight);
            }
        }
    }

    /**
     * Receive remote drawing data and render on the matching overlay.
     * The overlay is lazily created if it doesn't exist yet (the .Camera div
     * must already be in the DOM).
     * @param {Object} data - { cameraId, paths }
     */
    static receiveRemoteDrawing(data) {
        if (!data || !data.cameraId) return;

        // Find the overlay or create one (canvas must exist in DOM)
        let overlay = VideoDrawingOverlay.overlays.get(data.cameraId);
        if (!overlay) {
            const camDiv = document.getElementById(data.cameraId);
            if (!camDiv) {
                if (data.type === 'text' && data.producerId) {
                    const pending = VideoDrawingOverlay.pendingTextEvents.get(data.producerId) || [];
                    if (pending.length < 200) pending.push(data);
                    VideoDrawingOverlay.pendingTextEvents.set(data.producerId, pending);
                    return;
                }
                console.warn('[VideoDrawingOverlay] Camera div not found for remote drawing:', data.cameraId);
                return;
            }
            overlay = new VideoDrawingOverlay(camDiv, data.producerId);
        }

        if (data.type === 'text') overlay.receiveText(data);
        else if (data.paths) overlay.addRemotePaths(data.paths, data.peerName, data.drawerId);
    }

    /**
     * Destroy all active overlays. Useful for room cleanup.
     */
    static destroyAll() {
        for (const [, overlay] of VideoDrawingOverlay.overlays) {
            overlay.destroy();
        }
        VideoDrawingOverlay.overlays.clear();
        VideoDrawingOverlay.pendingTextEvents.clear();
    }
}

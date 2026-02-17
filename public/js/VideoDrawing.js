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

    /**
     * Create a drawing overlay for a .Camera container.
     * @param {HTMLElement} cameraDivEl - The .Camera wrapper div
     */
    constructor(cameraDivEl) {
        this.cameraDivEl = cameraDivEl;
        this.cameraId = cameraDivEl.id;
        this.isActive = false;
        this._clearTimers = new Map();

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

        // Set up ResizeObserver for accurate per-element resize tracking
        this._setupResizeObserver();

        // Register in the global overlay map
        VideoDrawingOverlay.overlays.set(this.cameraId, this);

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

            // Schedule auto-clear
            this._scheduleAutoClear(path);

            // Normalize and queue for sync
            this._queuePathForSync(path);
        });
    }

    /**
     * Schedule removal of a path after AUTO_CLEAR_MS.
     * @param {fabric.Path} path
     * @private
     */
    _scheduleAutoClear(path) {
        const timerId = setTimeout(() => {
            this.fabricCanvas.remove(path);
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
    toggle() {
        this.isActive = !this.isActive;
        this.fabricCanvas.isDrawingMode = this.isActive;

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

        console.log('[VideoDrawingOverlay] Toggle', this.cameraId, this.isActive ? 'ON' : 'OFF');
        return this.isActive;
    }

    /**
     * Add remote drawing paths (received from another peer via signaling).
     * Paths use normalized 0..1 coordinates, which are denormalized to the
     * current canvas size.
     * @param {Array<{d: Array, color: string, width: number}>} paths
     * @param {string} [peerName] - Name of the peer who drew (shown as a label)
     */
    addRemotePaths(paths, peerName) {
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

            // Auto-clear remote paths too
            this._scheduleAutoClear(fabricPath);
        }

        this.fabricCanvas.requestRenderAll();

        // Show who is drawing
        if (peerName) {
            this._showDrawerLabel(peerName);
        }
    }

    /**
     * Show a floating label indicating who is drawing on this video.
     * The label auto-hides after AUTO_CLEAR_MS to match the drawing lifecycle.
     * Repeated calls reset the timer and update the name.
     * @param {string} peerName
     * @private
     */
    _showDrawerLabel(peerName) {
        const wrapper = this.fabricCanvas.wrapperEl;
        if (!wrapper) return;

        // Create the label element lazily
        if (!this._drawerLabel) {
            this._drawerLabel = document.createElement('div');
            this._drawerLabel.className = 'video-drawing-label';
            wrapper.appendChild(this._drawerLabel);
        }

        this._drawerLabel.textContent = `✏️ ${peerName}`;
        this._drawerLabel.style.opacity = '1';
        this._drawerLabel.style.display = 'block';

        // Reset the hide timer
        if (this._drawerLabelTimer) {
            clearTimeout(this._drawerLabelTimer);
        }
        this._drawerLabelTimer = setTimeout(() => {
            if (this._drawerLabel) {
                this._drawerLabel.style.opacity = '0';
                // Remove from display after the CSS transition finishes
                setTimeout(() => {
                    if (this._drawerLabel) {
                        this._drawerLabel.style.display = 'none';
                    }
                }, 400);
            }
            this._drawerLabelTimer = null;
        }, VideoDrawingOverlay.AUTO_CLEAR_MS);
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

        // Clean up drawer label
        if (this._drawerLabelTimer) {
            clearTimeout(this._drawerLabelTimer);
            this._drawerLabelTimer = null;
        }
        if (this._drawerLabel) {
            this._drawerLabel.remove();
            this._drawerLabel = null;
        }

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
    static getOrCreate(cameraDivEl) {
        const existing = VideoDrawingOverlay.overlays.get(cameraDivEl.id);
        if (existing) return existing;
        return new VideoDrawingOverlay(cameraDivEl);
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
        if (!data || !data.cameraId || !data.paths) return;

        // Find the overlay or create one (canvas must exist in DOM)
        let overlay = VideoDrawingOverlay.overlays.get(data.cameraId);
        if (!overlay) {
            const camDiv = document.getElementById(data.cameraId);
            if (!camDiv) {
                console.warn('[VideoDrawingOverlay] Camera div not found for remote drawing:', data.cameraId);
                return;
            }
            overlay = new VideoDrawingOverlay(camDiv);
        }

        overlay.addRemotePaths(data.paths, data.peerName);
    }

    /**
     * Destroy all active overlays. Useful for room cleanup.
     */
    static destroyAll() {
        for (const [, overlay] of VideoDrawingOverlay.overlays) {
            overlay.destroy();
        }
        VideoDrawingOverlay.overlays.clear();
    }
}

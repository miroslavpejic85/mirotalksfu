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

    /** Drawing events received before their screen tile exists, keyed by producer ID. */
    static pendingAnnotationEvents = new Map();
    static pendingPermissions = new Map();

    /** Auto-clear delay in milliseconds */
    static AUTO_CLEAR_MS = 5000;

    /** Batched sync interval in milliseconds */
    static SYNC_INTERVAL_MS = 1000;

    static LASER_SYNC_INTERVAL_MS = 50;
    static LASER_CLEAR_MS = 1000;
    static LASER_COLOR = '#ff1744';

    static MAX_TEXT_LENGTH = 1000;

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
        this.participantsAllowed = VideoDrawingOverlay.pendingPermissions.get(producerId) !== false;
        this.annotationsHidden = false;
        this._eraserSweep = null;
        VideoDrawingOverlay.pendingPermissions.delete(producerId);
        this.isToolbarCollapsed = false;
        this.activeTool = null;
        this.lastDrawingTool = 'pencil';
        this.annotationColor = '#ffeb3b';
        this.annotationWidth = 0.004;
        this.textStyle = { color: '#ffffff', fontSize: 16, bold: false, italic: false, boxWidth: 0.35 };
        this.annotations = new Map();
        this.selectedAnnotationId = null;
        this.activeShape = null;
        this.undoStack = [];
        this.redoStack = [];
        this._clearTimers = new Map();
        this._drawerLabels = new Map();
        this._drawerLabelTimers = new Map();
        this.textAnnotations = new Map();
        this.laserPointers = new Map();
        this._laserTimers = new Map();
        this._laserSyncTimer = null;
        this._pendingLaserPoint = null;

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
            selectionKey: null,
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
            if (['circle', 'rectangle', 'diamond', 'arrow'].includes(this.activeTool) && event.e) {
                this._beginShape(event.e);
            }
        });
        this.fabricCanvas.on('mouse:move', (event) => {
            if (this.activeShape && event.e) this._resizeShape(event.e);
        });
        this.fabricCanvas.on('mouse:up', () => this._finishShape());
        const pointerCanvas = this.fabricCanvas.upperCanvasEl;
        pointerCanvas?.addEventListener('pointermove', (event) => this._moveLaser(event));
        pointerCanvas?.addEventListener('pointerdown', (event) => this._moveLaser(event));
        pointerCanvas?.addEventListener('pointerdown', (event) => this._startErasing(event));
        pointerCanvas?.addEventListener('pointermove', (event) => this._eraseAt(event));
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
            pointerCanvas?.addEventListener(type, () => this._finishErasing());
        }
        for (const type of ['pointerleave', 'pointercancel', 'pointerup']) {
            pointerCanvas?.addEventListener(type, (event) => {
                if (type !== 'pointerup' || event.pointerType !== 'mouse') this._stopLaser();
            });
        }
        this.fabricCanvas.on('selection:created', (event) => this._selectAnnotation(event.selected?.[0]));
        this.fabricCanvas.on('selection:updated', (event) => this._selectAnnotation(event.selected?.[0]));
        this.fabricCanvas.on('selection:cleared', () => this._selectAnnotation(null));
        this.fabricCanvas.on('object:modified', (event) => this._moveAnnotation(event.target));
        this._handleHistoryKeyDown = this._handleHistoryKeyDown.bind(this);
        document.addEventListener('keydown', this._handleHistoryKeyDown);

        // Set up ResizeObserver for accurate per-element resize tracking
        this._setupResizeObserver();

        // Register in the global overlay map
        VideoDrawingOverlay.overlays.set(this.cameraId, this);

        for (const data of VideoDrawingOverlay.pendingTextEvents.get(this.producerId) || []) {
            this.receiveText(data);
        }
        VideoDrawingOverlay.pendingTextEvents.delete(this.producerId);
        for (const data of VideoDrawingOverlay.pendingAnnotationEvents.get(this.producerId) || []) {
            this.receiveAnnotation(data);
        }
        VideoDrawingOverlay.pendingAnnotationEvents.delete(this.producerId);

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
        brush.color =
            this.activeTool === 'vanishing'
                ? VideoDrawingOverlay.BRUSH_COLOR
                : this.activeTool === 'highlighter'
                  ? `${this.annotationColor}59`
                  : this.annotationColor;
        const width = this.fabricCanvas.getWidth() || this._prevWidth;
        brush.width =
            this.activeTool === 'highlighter'
                ? Math.max(2, Math.min(0.05, this.annotationWidth * 4.5) * width)
                : Math.max(2, this.annotationWidth * width);
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
            if (!this._canDraw()) {
                this.fabricCanvas.remove(path);
                return;
            }

            // Tag as local so we can identify it
            path._isLocal = true;

            const drawerId = VideoDrawingOverlay.getLocalDrawerId?.() || 'local';
            const drawerName = VideoDrawingOverlay.resolveDrawerName?.(drawerId) || 'Participant';

            if (this.activeTool === 'pencil' || this.activeTool === 'highlighter') {
                this._createPathAnnotation(path, drawerId, drawerName);
                return;
            }

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
            obj._annotationLeft = obj.left;
            obj._annotationTop = obj.top;
        });

        this.fabricCanvas.requestRenderAll();
        this._positionTextAnnotations();
        this._constrainToolbarPosition();
        for (const pointer of this.laserPointers.values()) {
            pointer.object.set({
                left: pointer.point.x * newWidth,
                top: pointer.point.y * newHeight,
                scaleX: 1,
                scaleY: 1,
            });
            pointer.object.setCoords();
            this._showDrawerLabel(pointer.drawerId, pointer.peer_name, pointer.object);
        }

        this._prevWidth = newWidth;
        this._prevHeight = newHeight;
    }

    // ####################################################
    // PUBLIC METHODS
    // ####################################################

    bindControls(drawingButton) {
        this.drawingButton = drawingButton;

        const annotationTooltipLabels = [
            'Move annotation toolbar',
            'Pencil',
            'Highlighter',
            'Vanishing pen',
            'Laser pointer',
            'Yellow annotation color',
            'Red annotation color',
            'Green annotation color',
            'Blue annotation color',
            'White annotation color',
            'Circle',
            'Rectangle',
            'Diamond',
            'Arrow',
            'Text',
            'Select and move',
            'Annotation color',
            'Annotation width',
            'Undo annotation',
            'Redo annotation',
            'Delete selected annotation',
            'Clear my screen annotations',
            'Clear screen annotations',
            'Download annotated screen (PNG)',
            'Download annotated screen (PDF)',
            'Hide annotation toolbar',
        ];
        annotationTooltipLabels.forEach((label) => window.i18n?.t(label, 'tooltips'));

        const toolbar = document.createElement('div');
        toolbar.className = 'video-drawing-toolbar';
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-orientation', 'horizontal');
        this._setTranslatedAttribute(toolbar, 'aria-label', 'Screen annotation tools', 'labels');
        this.toolbarPanels = new Map();
        const primary = document.createElement('div');
        primary.className = 'video-drawing-toolbar-primary';
        toolbar.appendChild(primary);
        const secondaryTools = this._createToolbarGroup('Drawing tools');
        const addPanel = (name, icon, label, panel) => {
            const button = this._createToolbarButton(icon, label);
            button.setAttribute('aria-expanded', 'false');
            panel.id = `${this.cameraId}__annotationPanel_${name}`;
            panel.classList.add('video-drawing-toolbar-panel');
            panel.hidden = true;
            button.setAttribute('aria-controls', panel.id);
            button.addEventListener('click', () => this.setToolbarPanel(panel.hidden ? name : null));
            primary.appendChild(button);
            toolbar.appendChild(panel);
            this.toolbarPanels.set(name, { button, panel });
            return button;
        };

        const dragHandle = this._createToolbarButton(
            'video-drawing-drag-handle fas fa-arrows-alt',
            'Move annotation toolbar'
        );
        primary.appendChild(dragHandle);

        const drawingTools = this._createToolbarGroup('Drawing tools');
        const tools = [
            ['pencil', 'fas fa-pencil-alt', 'Pencil'],
            ['highlighter', 'fas fa-highlighter', 'Highlighter'],
            ['vanishing', 'fas fa-wand-magic-sparkles', 'Vanishing pen'],
            ['laser', 'fas fa-bullseye', 'Laser pointer'],
            ['circle', 'far fa-circle', 'Circle'],
            ['rectangle', 'far fa-square', 'Rectangle'],
            ['diamond', 'video-drawing-diamond far fa-square', 'Diamond'],
            ['arrow', 'fas fa-arrow-right-long', 'Arrow'],
            ['text', 'fas fa-font', 'Text'],
            ['select', 'fas fa-mouse-pointer', 'Select and move'],
            ['eraser', 'fas fa-eraser', 'Erase my annotations'],
        ];
        this.toolButtons = {};
        for (const [tool, icon, label] of tools) {
            const button = this._createToolbarButton(icon, label);
            button.setAttribute('aria-pressed', 'false');
            button.addEventListener('click', () => {
                this.lastDrawingTool = tool;
                this.setTool(tool);
                this.setToolbarPanel(null, true);
            });
            const group = ['pencil', 'highlighter', 'laser', 'eraser'].includes(tool) ? drawingTools : secondaryTools;
            group.appendChild(button);
            this.toolButtons[tool] = button;
        }
        drawingTools.prepend(this.toolButtons.select);
        primary.appendChild(drawingTools);
        addPanel('tools', 'fas fa-shapes', 'Drawing tools', secondaryTools);

        const appearanceTools = this._createToolbarGroup('Annotation appearance');
        this.colorButtons = [];
        for (const [color, label] of [
            ['#ffeb3b', 'Yellow annotation color'],
            ['#ff1744', 'Red annotation color'],
            ['#00e676', 'Green annotation color'],
            ['#2979ff', 'Blue annotation color'],
            ['#ffffff', 'White annotation color'],
        ]) {
            const button = this._createToolbarButton('video-drawing-swatch', label);
            button.dataset.color = color;
            const swatch = document.createElement('span');
            swatch.style.backgroundColor = color;
            button.appendChild(swatch);
            button.addEventListener('click', () => this.setColor(color));
            appearanceTools.appendChild(button);
            this.colorButtons.push(button);
        }
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = this.annotationColor;
        colorInput.className = 'video-drawing-color';
        this._setTranslatedAttribute(colorInput, 'aria-label', 'Annotation color', 'tooltips');
        colorInput.addEventListener('input', () => this.setColor(colorInput.value));
        this.colorInput = colorInput;
        this.setColor(this.annotationColor);
        appearanceTools.appendChild(colorInput);

        const widthInput = document.createElement('input');
        widthInput.type = 'range';
        widthInput.min = '0.002';
        widthInput.max = '0.012';
        widthInput.step = '0.002';
        widthInput.value = String(this.annotationWidth);
        widthInput.className = 'video-drawing-width';
        this._setTranslatedAttribute(widthInput, 'aria-label', 'Annotation width', 'tooltips');
        widthInput.addEventListener('input', () => {
            this.annotationWidth = Number(widthInput.value);
            this.widthPreview.style.height = `${Math.round(this.annotationWidth * 1000)}px`;
            this._setupBrush();
        });
        appearanceTools.appendChild(widthInput);
        this.widthInput = widthInput;
        const widthPreview = document.createElement('span');
        widthPreview.className = 'video-drawing-width-preview';
        widthPreview.setAttribute('aria-hidden', 'true');
        widthPreview.style.height = `${Math.round(this.annotationWidth * 1000)}px`;
        widthPreview.style.backgroundColor = this.annotationColor;
        appearanceTools.appendChild(widthPreview);
        this.widthPreview = widthPreview;
        this.appearanceButton = addPanel(
            'appearance',
            'video-drawing-appearance',
            'Annotation appearance',
            appearanceTools
        );
        const colorPreview = document.createElement('span');
        colorPreview.setAttribute('aria-hidden', 'true');
        colorPreview.style.backgroundColor = this.annotationColor;
        this.appearanceButton.appendChild(colorPreview);

        const historyTools = this._createToolbarGroup('Annotation history');
        this.undoButton = this._createToolbarButton('fas fa-undo', 'Undo annotation');
        this.undoButton.disabled = true;
        this.undoButton.addEventListener('click', () => this.undo());
        historyTools.appendChild(this.undoButton);

        this.redoButton = this._createToolbarButton('fas fa-redo', 'Redo annotation');
        this.redoButton.disabled = true;
        this.redoButton.addEventListener('click', () => this.redo());
        historyTools.appendChild(this.redoButton);

        this.deleteButton = this._createToolbarButton(
            'video-drawing-delete fas fa-trash-alt',
            'Delete selected annotation'
        );
        this.deleteButton.disabled = true;
        this.deleteButton.addEventListener('click', () => this.deleteSelectedAnnotation());
        primary.appendChild(historyTools);
        const moreTools = this._createToolbarGroup('More annotation options');
        moreTools.appendChild(this.deleteButton);

        const clearLabel =
            VideoDrawingOverlay.getLocalDrawerId?.() === VideoDrawingOverlay.getProducerOwnerId?.(this.producerId)
                ? 'Clear screen annotations'
                : 'Clear my screen annotations';
        const clearButton = this._createToolbarButton('video-drawing-clear fas fa-broom', clearLabel);
        clearButton.addEventListener('click', () => this.clearAnnotations(true));
        this.clearButton = clearButton;
        moreTools.appendChild(clearButton);

        this.visibilityButton = this._createToolbarButton('fas fa-eye', 'Hide annotations');
        this.visibilityButton.addEventListener('click', () => this.setAnnotationsHidden(!this.annotationsHidden));
        moreTools.appendChild(this.visibilityButton);
        if (this._isScreenOwner()) {
            this.permissionsButton = this._createToolbarButton('fas fa-lock-open', 'Disable participant annotations');
            this.permissionsButton.addEventListener('click', () => {
                const allowed = !this.participantsAllowed;
                this.setParticipantsAllowed(allowed);
                VideoDrawingOverlay.onEmitDrawing?.({ type: 'permissions', producerId: this.producerId, allowed });
            });
            moreTools.appendChild(this.permissionsButton);
        }

        const exportTools = this._createToolbarGroup('Annotation downloads');
        this.downloadButtons = [];
        for (const [format, icon, label] of [
            ['png', 'fas fa-download', 'Download annotated screen (PNG)'],
            ['pdf', 'fas fa-file-pdf', 'Download annotated screen (PDF)'],
        ]) {
            const button = this._createToolbarButton(icon, label);
            button.addEventListener('click', () => this.downloadSnapshot(format));
            exportTools.appendChild(button);
            this.downloadButtons.push(button);
        }
        moreTools.appendChild(exportTools);
        const exitButton = this._createToolbarButton('video-drawing-exit fas fa-power-off', 'Disable screen drawing');
        exitButton.addEventListener('click', () => {
            this.setTool(null);
            this.drawingButton.focus();
        });
        moreTools.appendChild(exitButton);
        addPanel('more', 'fas fa-ellipsis-h', 'More annotation options', moreTools);

        const closeButton = this._createToolbarButton(
            'video-drawing-close fas fa-chevron-up',
            'Hide annotation toolbar'
        );
        closeButton.addEventListener('click', () => this.setToolbarCollapsed(true));
        primary.appendChild(closeButton);
        toolbar.addEventListener('keydown', (event) => this._handleToolbarKeyDown(event));
        this._handleToolbarOutsidePointer = (event) => {
            if (!toolbar.contains(event.target)) this.setToolbarPanel(null);
        };
        document.addEventListener('pointerdown', this._handleToolbarOutsidePointer);

        this.toolbar = toolbar;
        this.cameraDivEl.appendChild(toolbar);
        if (typeof setTippy === 'function') {
            for (const [index, control] of [...toolbar.querySelectorAll('button, input')].entries()) {
                control.id = `${this.cameraId}__annotationControl${index}`;
                setTippy(control.id, control['__i18nAttr_aria-label'] || control.getAttribute('aria-label'), 'bottom');
            }
        }
        if (!isMobileDevice) this._bindToolbarDrag(toolbar, dragHandle);

        drawingButton.addEventListener('click', () => {
            if (this.isActive && this.isToolbarCollapsed) {
                this.setToolbarCollapsed(false);
                return;
            }
            const tool = this.isActive ? null : this.lastDrawingTool;
            this.setTool(tool);
        });
        this.refreshPermissions();
    }

    async captureSnapshot() {
        const video = this.cameraDivEl.querySelector('video');
        const wrapper = this.fabricCanvas.wrapperEl;
        const width = this.fabricCanvas.getWidth();
        const height = this.fabricCanvas.getHeight();
        if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight || !width || !height) {
            throw new Error('No screen video frame is available');
        }
        const snapshot = document.createElement('canvas');
        snapshot.width = video.videoWidth;
        snapshot.height = video.videoHeight;
        const context = snapshot.getContext('2d');
        context.drawImage(video, 0, 0, snapshot.width, snapshot.height);
        if (this.annotationsHidden) return snapshot;
        const labels = this.fabricCanvas.getObjects().filter((object) => object.excludeFromExport);
        const visibility = labels.map((object) => object.visible);
        try {
            labels.forEach((object) => (object.visible = false));
            const drawing = this.fabricCanvas.toCanvasElement();
            context.drawImage(drawing, 0, 0, snapshot.width, snapshot.height);
        } finally {
            labels.forEach((object, index) => (object.visible = visibility[index]));
        }
        if (!this.textAnnotations.size) return snapshot;
        if (typeof window.html2canvas !== 'function') throw new Error('Screen capture library is unavailable');

        const frame = document.createElement('div');
        Object.assign(frame.style, {
            position: 'absolute',
            left: '-100000px',
            top: '0',
            width: `${width}px`,
            height: `${height}px`,
            overflow: 'hidden',
            pointerEvents: 'none',
            fontFamily: getComputedStyle(this.cameraDivEl).fontFamily,
        });
        frame.setAttribute('aria-hidden', 'true');
        Object.assign(snapshot.style, { width: `${width}px`, height: `${height}px`, display: 'block' });
        frame.appendChild(snapshot);
        for (const { element } of this.textAnnotations.values()) {
            const clone = element.cloneNode(true);
            clone.classList.remove('video-drawing-text-selected', 'video-drawing-text-select-mode');
            clone.querySelectorAll('button, .video-drawing-text-author').forEach((control) => control.remove());
            Object.assign(clone.style, {
                left: `${element.offsetLeft - wrapper.offsetLeft}px`,
                top: `${element.offsetTop - wrapper.offsetTop}px`,
                width: `${element.offsetWidth}px`,
                height: `${element.offsetHeight}px`,
                borderColor: 'transparent',
                boxShadow: 'none',
            });
            frame.appendChild(clone);
        }
        document.body.appendChild(frame);
        try {
            const textSnapshot = await window.html2canvas(frame, {
                backgroundColor: null,
                scale: snapshot.width / width,
                width,
                height,
                logging: false,
            });
            context.clearRect(0, 0, snapshot.width, snapshot.height);
            context.drawImage(textSnapshot, 0, 0, snapshot.width, snapshot.height);
            return snapshot;
        } finally {
            frame.remove();
        }
    }

    async downloadSnapshot(format) {
        if (this.isCapturing) return;
        this.isCapturing = true;
        this.downloadButtons.forEach((button) => (button.disabled = true));
        try {
            const snapshot = await this.captureSnapshot();
            const fileName = `screen-annotations-${new Date().toISOString().replace(/[:.]/g, '-')}`;
            if (format === 'pdf') {
                if (!window.jspdf?.jsPDF) throw new Error('PDF library is unavailable');
                const pdf = new window.jspdf.jsPDF({
                    orientation: snapshot.width >= snapshot.height ? 'landscape' : 'portrait',
                    unit: 'px',
                    format: [snapshot.width, snapshot.height],
                    hotfixes: ['px_scaling'],
                });
                pdf.addImage(snapshot, 'PNG', 0, 0, snapshot.width, snapshot.height);
                pdf.save(`${fileName}.pdf`);
            } else {
                const blob = await new Promise((resolve) => snapshot.toBlob(resolve, 'image/png'));
                if (!blob) throw new Error('Screen image could not be encoded');
                rc.saveBlobToFile(blob, `${fileName}.png`);
            }
        } catch (error) {
            console.error('Screen annotation capture failed', error);
            if (typeof rc !== 'undefined') rc.userLog('error', 'Unable to download screen annotations');
        } finally {
            this.isCapturing = false;
            this.downloadButtons.forEach((button) => (button.disabled = false));
        }
    }

    _createToolbarButton(className, label) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        this._setTranslatedAttribute(button, 'aria-label', label, 'tooltips');
        return button;
    }

    _createToolbarGroup(label) {
        const group = document.createElement('div');
        group.className = 'video-drawing-toolbar-group';
        group.setAttribute('role', 'group');
        this._setTranslatedAttribute(group, 'aria-label', label, 'labels');
        return group;
    }

    setToolbarPanel(name, restoreFocus = false) {
        for (const [panelName, { button, panel }] of this.toolbarPanels || []) {
            if (!panel.hidden && panelName !== name && restoreFocus) button.focus();
            panel.hidden = panelName !== name;
            button.setAttribute('aria-expanded', String(!panel.hidden));
        }
        this._constrainToolbarPosition();
    }

    _handleToolbarKeyDown(event) {
        if (event.key === 'Escape') {
            if ([...(this.toolbarPanels?.values() || [])].some(({ panel }) => !panel.hidden)) {
                this.setToolbarPanel(null, true);
            } else {
                this.setToolbarCollapsed(true);
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.target.tagName !== 'BUTTON') {
            return;
        }
        const buttons = [...this.toolbar.querySelectorAll('button:not(:disabled)')].filter(
            (button) => button.offsetParent !== null
        );
        const currentIndex = buttons.indexOf(event.target);
        if (currentIndex === -1) return;
        event.preventDefault();
        const nextIndex =
            event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[nextIndex].focus();
    }

    _setTranslatedAttribute(element, attribute, source, namespace) {
        const property = `__i18nAttr_${attribute}`;
        element[property] = source;
        element.setAttribute(attribute, window.i18n?.t(source, namespace) || source);
    }

    _bindToolbarDrag(toolbar, dragHandle) {
        let drag = null;
        const moveToolbar = (left, top) => this._setToolbarPosition(left, top);
        dragHandle.addEventListener('pointerdown', (event) => {
            if (event.button > 0) return;
            event.preventDefault();
            const parentRect = this.cameraDivEl.getBoundingClientRect();
            const toolbarRect = toolbar.getBoundingClientRect();
            const scaleX = this.cameraDivEl.offsetWidth ? parentRect.width / this.cameraDivEl.offsetWidth : 1;
            const scaleY = this.cameraDivEl.offsetHeight ? parentRect.height / this.cameraDivEl.offsetHeight : 1;
            const left = (toolbarRect.left - parentRect.left) / scaleX;
            const top = (toolbarRect.top - parentRect.top) / scaleY;

            moveToolbar(left, top);
            drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, left, top };
            dragHandle.setPointerCapture(event.pointerId);
        });
        dragHandle.addEventListener('pointermove', (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            const parentRect = this.cameraDivEl.getBoundingClientRect();
            const scaleX = this.cameraDivEl.offsetWidth ? parentRect.width / this.cameraDivEl.offsetWidth : 1;
            const scaleY = this.cameraDivEl.offsetHeight ? parentRect.height / this.cameraDivEl.offsetHeight : 1;
            const left = drag.left + (event.clientX - drag.clientX) / scaleX;
            const top = drag.top + (event.clientY - drag.clientY) / scaleY;

            moveToolbar(left, top);
        });
        const finishDrag = (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            drag = null;
        };
        dragHandle.addEventListener('pointerup', finishDrag);
        dragHandle.addEventListener('pointercancel', finishDrag);
        dragHandle.addEventListener('keydown', (event) => {
            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            const step = event.shiftKey ? 24 : 8;
            const left = Number.parseFloat(toolbar.style.left) || toolbar.offsetLeft;
            const top = Number.parseFloat(toolbar.style.top) || toolbar.offsetTop;
            moveToolbar(
                left + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
                top + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)
            );
        });
    }

    _setToolbarPosition(left, top) {
        if (!this.toolbar) return;
        const maxLeft = Math.max(0, this.cameraDivEl.clientWidth - this.toolbar.offsetWidth);
        const maxTop = Math.max(0, this.cameraDivEl.clientHeight - this.toolbar.offsetHeight);
        this.toolbar.style.left = `${Math.max(0, Math.min(maxLeft, left))}px`;
        this.toolbar.style.top = `${Math.max(0, Math.min(maxTop, top))}px`;
        this.toolbar.style.transform = 'none';
    }

    _constrainToolbarPosition() {
        if (!this.toolbar || this.toolbar.style.transform !== 'none') return;
        this._setToolbarPosition(
            Number.parseFloat(this.toolbar.style.left) || 0,
            Number.parseFloat(this.toolbar.style.top) || 0
        );
    }

    setToolbarCollapsed(collapsed) {
        this.isToolbarCollapsed = collapsed;
        if (collapsed) this.setToolbarPanel(null);
        this.toolbar?.classList.toggle('video-drawing-toolbar-collapsed', collapsed);
        if (collapsed && this.toolbar?.contains(document.activeElement) && !this.drawingButton?.hidden) {
            this.drawingButton?.focus();
        }
        this._updateDrawingButton();
    }

    setTool(tool) {
        if (!tool) this.setToolbarPanel(null);
        if (tool && this.isToolbarCollapsed) this.setToolbarCollapsed(false);
        if (tool && tool !== 'view' && !this._canDraw()) tool = 'view';
        this._finishErasing();
        if (this.activeTool === 'laser' && tool !== 'laser') this._stopLaser();
        this.isActive = Boolean(tool);
        this.activeTool = tool;
        const drawingMode = ['pencil', 'highlighter', 'vanishing'].includes(tool);
        this.fabricCanvas.isDrawingMode = drawingMode;
        this.fabricCanvas.selection = false;
        this._setupBrush();

        for (const annotation of this.annotations.values()) {
            annotation.object.selectable = tool === 'select' && this._canManageAnnotation(annotation);
            annotation.object.evented = annotation.object.selectable;
        }
        if (tool !== 'select') {
            this.fabricCanvas.discardActiveObject();
            this._selectTextAnnotation(null);
        }
        for (const annotation of this.textAnnotations.values()) {
            annotation.element.classList.toggle('video-drawing-text-select-mode', tool === 'select');
        }

        const wrapper = this.fabricCanvas.wrapperEl;
        wrapper?.classList.toggle('video-drawing-active', this.isActive && tool !== 'view');
        wrapper?.classList.toggle('video-drawing-inactive', !this.isActive || tool === 'view');
        wrapper?.classList.toggle('video-drawing-selecting', tool === 'select');
        this.cameraDivEl.classList.toggle('video-drawing-erasing', tool === 'eraser');
        this.toolbar?.classList.toggle('video-drawing-toolbar-active', this.isActive);

        for (const [buttonTool, button] of Object.entries(this.toolButtons || {})) {
            const selected = this.isActive && buttonTool === tool;
            button.classList.toggle('video-drawing-tool-active', selected);
            button.setAttribute('aria-pressed', String(selected));
        }
        const secondaryTools = this.toolbarPanels?.get('tools');
        if (secondaryTools) {
            const selectedButton = this.toolButtons[tool];
            secondaryTools.button.className =
                selectedButton && secondaryTools.panel.contains(selectedButton)
                    ? selectedButton.className
                    : 'fas fa-shapes';
        }
        this._updateDrawingButton();
        if (tool !== 'text') this.textInput?.__cancel?.();
        this.fabricCanvas.requestRenderAll();
    }

    _updateDrawingButton() {
        if (!this.drawingButton) return;
        this.drawingButton.classList.toggle('video-drawing-tool-active', this.isActive);
        this.drawingButton.setAttribute('aria-pressed', String(this.isActive));
        const label =
            this.isActive && this.isToolbarCollapsed
                ? 'Show annotation toolbar'
                : `${this.isActive ? 'Disable' : 'Enable'} screen drawing`;
        this._setTranslatedAttribute(this.drawingButton, 'aria-label', label, 'tooltips');
        if (this.drawingButton._tippy) {
            this.drawingButton._tippy.__i18nSrc = label;
            this.drawingButton._tippy.setContent(window.i18n?.t(label, 'tooltips') || label);
        }
    }

    setColor(color) {
        this.annotationColor = color;
        if (this.colorInput) this.colorInput.value = color;
        if (this.appearanceButton) this.appearanceButton.firstChild.style.backgroundColor = color;
        if (this.widthPreview) this.widthPreview.style.backgroundColor = color;
        for (const button of this.colorButtons || []) {
            const selected = button.dataset.color === color.toLowerCase();
            button.classList.toggle('video-drawing-tool-active', selected);
            button.setAttribute('aria-pressed', String(selected));
        }
        this._setupBrush();
    }

    _moveLaser(event) {
        if (this.activeTool !== 'laser') return;
        if (!this._canDraw()) {
            this._stopLaser();
            return;
        }
        event.preventDefault();
        const rect = this.fabricCanvas.upperCanvasEl.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const point = {
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        };
        const drawerId = VideoDrawingOverlay.getLocalDrawerId?.() || 'local';
        this.receiveLaser({ drawerId, peer_name: VideoDrawingOverlay.resolveDrawerName?.(drawerId), points: [point] });
        this._pendingLaserPoint = point;
        if (this._laserSyncTimer) return;
        this._laserSyncTimer = setTimeout(() => {
            this._laserSyncTimer = null;
            const latest = this._pendingLaserPoint;
            this._pendingLaserPoint = null;
            if (!latest) return;
            VideoDrawingOverlay.onEmitDrawing?.({
                type: 'laser',
                producerId: this.producerId,
                points: [{ x: +latest.x.toFixed(4), y: +latest.y.toFixed(4) }],
                end: false,
            });
        }, VideoDrawingOverlay.LASER_SYNC_INTERVAL_MS);
    }

    _stopLaser() {
        clearTimeout(this._laserSyncTimer);
        this._laserSyncTimer = null;
        this._pendingLaserPoint = null;
        const drawerId = VideoDrawingOverlay.getLocalDrawerId?.() || 'local';
        const pointer = this.laserPointers?.get(drawerId);
        if (!pointer) return;
        this._removeLaser(drawerId);
        VideoDrawingOverlay.onEmitDrawing?.({
            type: 'laser',
            producerId: this.producerId,
            points: [pointer.point],
            end: true,
        });
    }

    _removeLaser(drawerId) {
        clearTimeout(this._laserTimers.get(drawerId));
        this._laserTimers.delete(drawerId);
        const pointer = this.laserPointers.get(drawerId);
        if (!pointer) return;
        this._removeDrawerLabel(drawerId, pointer.object);
        this.fabricCanvas.remove(pointer.object);
        this.laserPointers.delete(drawerId);
        this.fabricCanvas.requestRenderAll();
    }

    receiveLaser(data) {
        if (this.annotationsHidden) return;
        if (data.end) {
            this._removeLaser(data.drawerId);
            return;
        }
        const point = data.points?.[0];
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
        const previous = this.laserPointers.get(data.drawerId);
        const object =
            previous?.object ||
            new fabric.Circle({
                radius: 6,
                originX: 'center',
                originY: 'center',
                fill: VideoDrawingOverlay.LASER_COLOR,
                stroke: '#ffffff',
                strokeWidth: 1.5,
                shadow: new fabric.Shadow({ color: VideoDrawingOverlay.LASER_COLOR, blur: 12 }),
                selectable: false,
                evented: false,
                excludeFromExport: true,
            });
        object.set({ left: point.x * this.fabricCanvas.getWidth(), top: point.y * this.fabricCanvas.getHeight() });
        object.setCoords();
        if (!previous) this.fabricCanvas.add(object);
        const peerName = data.peer_name || VideoDrawingOverlay.resolveDrawerName?.(data.drawerId) || 'Participant';
        this.laserPointers.set(data.drawerId, { object, point, drawerId: data.drawerId, peer_name: peerName });
        this._showDrawerLabel(data.drawerId, peerName, object);
        clearTimeout(this._laserTimers.get(data.drawerId));
        this._laserTimers.set(
            data.drawerId,
            setTimeout(() => this._removeLaser(data.drawerId), VideoDrawingOverlay.LASER_CLEAR_MS)
        );
        this.fabricCanvas.requestRenderAll();
    }

    refreshPermissions() {
        const canDraw = this._canDraw();
        if (this.drawingButton) {
            this.drawingButton.hidden = false;
            this.drawingButton.disabled = false;
        }
        this.cameraDivEl.classList.toggle('video-drawing-readonly', !canDraw);
        for (const button of Object.values(this.toolButtons || {})) button.disabled = !canDraw;
        if (this.clearButton) this.clearButton.disabled = !canDraw;
        if (this.colorInput) this.colorInput.disabled = !canDraw;
        for (const button of this.colorButtons || []) button.disabled = !canDraw;
        if (this.toolbar) {
            for (const input of this.toolbar.querySelectorAll('input')) input.disabled = !canDraw;
        }
        this._updateHistoryButtons();
        if (this.deleteButton) this.deleteButton.disabled = true;
        if (!canDraw) {
            this._cancelDrawing();
            for (const annotation of this.textAnnotations.values()) annotation.cancelDrag?.();
            if (this.isActive) this.setTool('view');
            this.textInput?.__cancel?.();
        } else if (this.activeTool === 'view') {
            this.setTool(this.lastDrawingTool);
        }
        if (this.permissionsButton) {
            this.permissionsButton.classList.toggle('fa-lock', !this.participantsAllowed);
            this.permissionsButton.classList.toggle('fa-lock-open', this.participantsAllowed);
            this.permissionsButton.classList.toggle('video-drawing-permissions-locked', !this.participantsAllowed);
            this.permissionsButton.setAttribute('aria-pressed', String(!this.participantsAllowed));
            this._updateControlLabel(
                this.permissionsButton,
                this.participantsAllowed ? 'Disable participant annotations' : 'Enable participant annotations'
            );
        }
    }

    _canDraw() {
        return (
            !this.annotationsHidden &&
            (this.participantsAllowed !== false || this._isScreenOwner()) &&
            VideoDrawingOverlay.canDraw?.(this.producerId) !== false
        );
    }

    _isScreenOwner() {
        const localId = VideoDrawingOverlay.getLocalDrawerId?.();
        return Boolean(localId && localId === VideoDrawingOverlay.getProducerOwnerId?.(this.producerId));
    }

    _updateControlLabel(control, label) {
        this._setTranslatedAttribute(control, 'aria-label', label, 'tooltips');
        if (control._tippy) {
            control._tippy.__i18nSrc = label;
            control._tippy.setContent?.(window.i18n?.t(label, 'tooltips') || label);
        }
    }

    setParticipantsAllowed(allowed) {
        this.participantsAllowed = allowed;
        this.refreshPermissions();
    }

    setAnnotationsHidden(hidden) {
        this.annotationsHidden = hidden;
        this.cameraDivEl.classList.toggle('video-drawing-annotations-hidden', hidden);
        if (hidden) {
            this._stopLaser();
            for (const drawerId of this.laserPointers.keys()) this._removeLaser(drawerId);
        }
        this.visibilityButton?.classList.toggle('fa-eye', !hidden);
        this.visibilityButton?.classList.toggle('fa-eye-slash', hidden);
        this.visibilityButton?.setAttribute('aria-pressed', String(hidden));
        if (this.visibilityButton)
            this._updateControlLabel(this.visibilityButton, hidden ? 'Show annotations' : 'Hide annotations');
        this.refreshPermissions();
    }

    _cancelDrawing() {
        this._finishErasing();
        if (this.activeShape) {
            this._removeAnnotation(this.activeShape.annotationId);
            this.activeShape = null;
        }
        const brush = this.fabricCanvas.freeDrawingBrush;
        if (this.fabricCanvas._isCurrentlyDrawing) {
            this.fabricCanvas._isCurrentlyDrawing = false;
            brush?._reset?.();
            if (this.fabricCanvas.contextTop) this.fabricCanvas.clearContext(this.fabricCanvas.contextTop);
        }
        clearTimeout(this._syncTimerId);
        this._syncTimerId = null;
        this._pendingPaths = [];
    }

    _startErasing(event) {
        if (this.activeTool !== 'eraser' || !this._canDraw() || event.button > 0) return;
        event.preventDefault();
        this._eraserSweep = { undo: [], redo: [], point: null };
        this.fabricCanvas.upperCanvasEl.setPointerCapture?.(event.pointerId);
        this._eraseAt(event);
    }

    _eraseAt(event) {
        if (!this._eraserSweep || !this._canDraw()) return;
        const rect = this.fabricCanvas.upperCanvasEl.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const previous = this._eraserSweep.point || point;
        const steps = Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.y - previous.y) / 6));
        const localId = VideoDrawingOverlay.getLocalDrawerId?.();
        for (let step = 0; step <= steps; step++) {
            const sample = {
                x: previous.x + ((point.x - previous.x) * step) / steps,
                y: previous.y + ((point.y - previous.y) * step) / steps,
            };
            for (const annotation of this.annotations.values()) {
                if (annotation.drawerId !== localId) continue;
                const points = annotation.points.map(({ x, y }) => ({ x: x * rect.width, y: y * rect.height }));
                const hit = ['pencil', 'highlighter'].includes(annotation.tool)
                    ? points.slice(1).some((end, index) => {
                          const start = points[index];
                          const deltaX = end.x - start.x;
                          const deltaY = end.y - start.y;
                          const length = deltaX * deltaX + deltaY * deltaY;
                          const fraction = length
                              ? Math.max(
                                    0,
                                    Math.min(
                                        1,
                                        ((sample.x - start.x) * deltaX + (sample.y - start.y) * deltaY) / length
                                    )
                                )
                              : 0;
                          return (
                              Math.hypot(
                                  sample.x - start.x - fraction * deltaX,
                                  sample.y - start.y - fraction * deltaY
                              ) <=
                              10 + (annotation.width * rect.width) / 2
                          );
                      })
                    : annotation.object.containsPoint(
                          new fabric.Point(
                              (sample.x * this.fabricCanvas.getWidth()) / rect.width,
                              (sample.y * this.fabricCanvas.getHeight()) / rect.height
                          )
                      );
                if (hit) this._eraseAnnotation(annotation, false);
            }
            for (const annotation of this.textAnnotations.values()) {
                if (annotation.drawerId !== localId) continue;
                const bounds = annotation.element.getBoundingClientRect();
                if (
                    sample.x + rect.left >= bounds.left - 10 &&
                    sample.x + rect.left <= bounds.right + 10 &&
                    sample.y + rect.top >= bounds.top - 10 &&
                    sample.y + rect.top <= bounds.bottom + 10
                ) {
                    this._eraseAnnotation(annotation, true);
                }
            }
        }
        this._eraserSweep.point = point;
    }

    _eraseAnnotation(annotation, text) {
        const type = text ? 'text' : 'annotation';
        const snapshot = text ? this._cloneTextAnnotation(annotation) : this._cloneAnnotation(annotation);
        this._eraserSweep.undo.push({ type, action: 'create', annotation: snapshot });
        this._eraserSweep.redo.push({ type, action: 'delete', annotationId: annotation.annotationId });
        if (text) {
            annotation.element.remove();
            this.textAnnotations.delete(annotation.annotationId);
        } else this._removeAnnotation(annotation.annotationId);
        VideoDrawingOverlay.onEmitDrawing?.({
            type,
            action: 'delete',
            producerId: this.producerId,
            annotationId: annotation.annotationId,
        });
    }

    _finishErasing() {
        const sweep = this._eraserSweep;
        this._eraserSweep = null;
        if (sweep?.undo.length) this._recordHistory(sweep.undo, sweep.redo);
    }

    /**
     * Toggle drawing mode on/off.
     * @returns {boolean} The new active state.
     */
    toggle(tool = 'pen', buttons = {}) {
        if (this.toolbar) {
            this.setTool(this.isActive && this.activeTool === tool ? null : tool === 'pen' ? 'pencil' : tool);
            return this.isActive;
        }
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
        if (this.activeTool !== 'text') this.textInput?.__cancel?.();

        console.log('[VideoDrawingOverlay] Toggle', this.cameraId, this.isActive ? 'ON' : 'OFF');
        return this.isActive;
    }

    _createPathAnnotation(path, drawerId, peerName) {
        const width = this.fabricCanvas.getWidth();
        const height = this.fabricCanvas.getHeight();
        const points = (path.path || [])
            .map((command) => command.slice(1).filter(Number.isFinite))
            .filter((values) => values.length >= 2)
            .map((values) => ({
                x: +(values.at(-2) / width).toFixed(4),
                y: +(values.at(-1) / height).toFixed(4),
            }))
            .filter((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
        if (points.length < 2) {
            this.fabricCanvas.remove(path);
            return;
        }

        const annotation = {
            type: 'annotation',
            action: 'create',
            producerId: this.producerId,
            annotationId: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            drawerId,
            peer_name: peerName,
            tool: this.activeTool,
            color: this.annotationColor,
            width:
                this.activeTool === 'highlighter' ? Math.min(0.05, this.annotationWidth * 4.5) : this.annotationWidth,
            points,
        };
        this.fabricCanvas.remove(path);
        this._addAnnotation(annotation);
        this._recordHistory(
            [{ action: 'delete', annotationId: annotation.annotationId }],
            [{ action: 'create', annotation: this._cloneAnnotation(annotation) }]
        );
        VideoDrawingOverlay.onEmitDrawing?.(annotation);
    }

    _beginShape(pointerEvent) {
        if (pointerEvent.button > 0) return;
        const point = this._getNormalizedPoint(pointerEvent);
        const annotation = {
            type: 'annotation',
            action: 'create',
            producerId: this.producerId,
            annotationId: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            drawerId: VideoDrawingOverlay.getLocalDrawerId?.(),
            peer_name: VideoDrawingOverlay.resolveDrawerName?.(VideoDrawingOverlay.getLocalDrawerId?.()),
            tool: this.activeTool,
            color: this.annotationColor,
            width: this.annotationWidth,
            points: [point, point],
        };
        this._addAnnotation(annotation, false);
        this.activeShape = annotation;
    }

    _resizeShape(pointerEvent) {
        this.activeShape.points[1] = this._getNormalizedPoint(pointerEvent);
        this._refreshAnnotationObject(this.activeShape);
        this.fabricCanvas.requestRenderAll();
    }

    _finishShape() {
        if (!this.activeShape) return;
        const annotation = this.activeShape;
        this.activeShape = null;
        const [start, end] = annotation.points;
        if (Math.hypot(end.x - start.x, end.y - start.y) < 0.005) {
            this._removeAnnotation(annotation.annotationId);
            return;
        }
        this._showAnnotationDrawerLabel(annotation);
        this._recordHistory(
            [{ action: 'delete', annotationId: annotation.annotationId }],
            [{ action: 'create', annotation: this._cloneAnnotation(annotation) }]
        );
        VideoDrawingOverlay.onEmitDrawing?.({ ...annotation, object: undefined });
    }

    _getNormalizedPoint(pointerEvent) {
        const rect = this.fabricCanvas.wrapperEl.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (pointerEvent.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (pointerEvent.clientY - rect.top) / rect.height)),
        };
    }

    _addAnnotation(annotation, showDrawerLabel = true) {
        if (!annotation.annotationId || this.annotations.has(annotation.annotationId)) return;
        const object = this._createAnnotationObject(annotation);
        object.annotationId = annotation.annotationId;
        annotation.object = object;
        this.annotations.set(annotation.annotationId, annotation);
        this.fabricCanvas.add(object);
        if (showDrawerLabel) this._showAnnotationDrawerLabel(annotation);
        this.fabricCanvas.requestRenderAll();
    }

    _createAnnotationObject(annotation) {
        const width = this.fabricCanvas.getWidth();
        const height = this.fabricCanvas.getHeight();
        let object;
        if (annotation.tool === 'circle') {
            object = new fabric.Circle({
                originX: 'center',
                originY: 'center',
                fill: 'transparent',
                stroke: annotation.color,
                strokeWidth: Math.max(2, annotation.width * width),
                selectable: false,
                evented: false,
            });
            this._applyCirclePoints(annotation, object);
        } else if (annotation.tool === 'rectangle') {
            object = new fabric.Rect({
                fill: 'transparent',
                stroke: annotation.color,
                strokeWidth: Math.max(2, annotation.width * width),
                selectable: false,
                evented: false,
            });
            this._applyRectanglePoints(annotation, object);
        } else if (annotation.tool === 'diamond') {
            const [start, end] = annotation.points;
            const centerX = ((start.x + end.x) / 2) * width;
            const centerY = ((start.y + end.y) / 2) * height;
            object = new fabric.Polyline(
                [
                    { x: centerX, y: start.y * height },
                    { x: end.x * width, y: centerY },
                    { x: centerX, y: end.y * height },
                    { x: start.x * width, y: centerY },
                    { x: centerX, y: start.y * height },
                ],
                {
                    fill: null,
                    stroke: annotation.color,
                    strokeWidth: Math.max(2, annotation.width * width),
                    strokeLineJoin: 'round',
                    selectable: false,
                    evented: false,
                    objectCaching: false,
                }
            );
            object.containsPoint = (point) => {
                const center = object.getCenterPoint();
                const tolerance = Math.max(8, object.strokeWidth * 2);
                return (
                    Math.abs(point.x - center.x) / ((object.width * object.scaleX) / 2 + tolerance) +
                        Math.abs(point.y - center.y) / ((object.height * object.scaleY) / 2 + tolerance) <=
                    1
                );
            };
        } else if (annotation.tool === 'arrow') {
            object = new fabric.Polyline(this._getArrowPoints(annotation, width, height), {
                fill: null,
                stroke: annotation.color,
                strokeWidth: Math.max(2, annotation.width * width),
                strokeLineCap: 'round',
                strokeLineJoin: 'round',
                selectable: false,
                evented: false,
                objectCaching: false,
            });
        } else {
            object = new fabric.Polyline(
                annotation.points.map((point) => ({ x: point.x * width, y: point.y * height })),
                {
                    fill: null,
                    stroke: annotation.tool === 'highlighter' ? `${annotation.color}59` : annotation.color,
                    strokeWidth: Math.max(2, annotation.width * width),
                    strokeLineCap: 'round',
                    strokeLineJoin: 'round',
                    selectable: false,
                    evented: false,
                    objectCaching: false,
                }
            );
        }
        const selectable = this.activeTool === 'select' && this._canManageAnnotation(annotation);
        object.set({
            selectable,
            evented: selectable,
            hasControls: false,
            lockRotation: true,
            lockScalingX: true,
            lockScalingY: true,
        });
        object._annotationLeft = object.left;
        object._annotationTop = object.top;
        return object;
    }

    _applyCirclePoints(annotation, object = annotation.object) {
        const [center, edge] = annotation.points;
        const width = this.fabricCanvas.getWidth();
        const height = this.fabricCanvas.getHeight();
        object.set({
            left: center.x * width,
            top: center.y * height,
            radius: Math.hypot((edge.x - center.x) * width, (edge.y - center.y) * height),
            scaleX: 1,
            scaleY: 1,
        });
        object.setCoords();
    }

    _applyRectanglePoints(annotation, object = annotation.object) {
        const [start, end] = annotation.points;
        const width = this.fabricCanvas.getWidth();
        const height = this.fabricCanvas.getHeight();
        object.set({
            left: Math.min(start.x, end.x) * width,
            top: Math.min(start.y, end.y) * height,
            width: Math.abs(end.x - start.x) * width,
            height: Math.abs(end.y - start.y) * height,
            scaleX: 1,
            scaleY: 1,
        });
        object.setCoords();
    }

    _getArrowPoints(annotation, width, height) {
        const [start, end] = annotation.points;
        const startX = start.x * width;
        const startY = start.y * height;
        const endX = end.x * width;
        const endY = end.y * height;
        const angle = Math.atan2(endY - startY, endX - startX);
        const headLength = Math.max(12, Math.min(24, Math.hypot(endX - startX, endY - startY) * 0.25));
        return [
            { x: startX, y: startY },
            { x: endX, y: endY },
            {
                x: endX - headLength * Math.cos(angle - Math.PI / 6),
                y: endY - headLength * Math.sin(angle - Math.PI / 6),
            },
            { x: endX, y: endY },
            {
                x: endX - headLength * Math.cos(angle + Math.PI / 6),
                y: endY - headLength * Math.sin(angle + Math.PI / 6),
            },
        ];
    }

    _refreshAnnotationObject(annotation) {
        const selected = this.selectedAnnotationId === annotation.annotationId;
        this.fabricCanvas.remove(annotation.object);
        const object = this._createAnnotationObject(annotation);
        object.annotationId = annotation.annotationId;
        object.selectable = this.activeTool === 'select' && this._canManageAnnotation(annotation);
        object.evented = object.selectable;
        annotation.object = object;
        this.fabricCanvas.add(object);
        if (selected) this.fabricCanvas.setActiveObject(object);
    }

    _selectAnnotation(object) {
        this.selectedTextAnnotationId = null;
        for (const annotation of this.textAnnotations.values()) {
            annotation.element.classList.remove('video-drawing-text-selected');
        }
        const annotation = object && this.annotations.get(object.annotationId);
        this.selectedAnnotationId = annotation?.annotationId || null;
        if (this.deleteButton) this.deleteButton.disabled = !annotation || !this._canManageAnnotation(annotation);
    }

    _selectTextAnnotation(annotationId) {
        this.fabricCanvas.discardActiveObject();
        this.selectedAnnotationId = null;
        this.selectedTextAnnotationId = annotationId;
        const annotation = this.textAnnotations.get(annotationId);
        for (const textAnnotation of this.textAnnotations.values()) {
            textAnnotation.element.classList.toggle(
                'video-drawing-text-selected',
                textAnnotation.annotationId === annotationId
            );
        }
        if (this.deleteButton) this.deleteButton.disabled = !annotation || !this._canManageText(annotation);
        this.fabricCanvas.requestRenderAll();
    }

    _moveAnnotation(object) {
        const annotation = object && this.annotations.get(object.annotationId);
        if (!annotation || !this._canManageAnnotation(annotation)) return;
        const width = this.fabricCanvas.getWidth();
        const height = this.fabricCanvas.getHeight();
        const originalPoints = this._clonePoints(annotation.points);
        let deltaX = (object.left - object._annotationLeft) / width;
        let deltaY = (object.top - object._annotationTop) / height;
        deltaX = Math.max(-Math.min(...annotation.points.map((point) => point.x)), deltaX);
        deltaX = Math.min(1 - Math.max(...annotation.points.map((point) => point.x)), deltaX);
        deltaY = Math.max(-Math.min(...annotation.points.map((point) => point.y)), deltaY);
        deltaY = Math.min(1 - Math.max(...annotation.points.map((point) => point.y)), deltaY);
        annotation.points = annotation.points.map((point) => ({
            x: +(point.x + deltaX).toFixed(4),
            y: +(point.y + deltaY).toFixed(4),
        }));
        this._refreshAnnotationObject(annotation);
        this._showAnnotationDrawerLabel(annotation);
        this._recordHistory(
            [{ action: 'move', annotationId: annotation.annotationId, points: originalPoints }],
            [{ action: 'move', annotationId: annotation.annotationId, points: this._clonePoints(annotation.points) }]
        );
        VideoDrawingOverlay.onEmitDrawing?.({
            type: 'annotation',
            action: 'move',
            producerId: this.producerId,
            annotationId: annotation.annotationId,
            points: annotation.points,
        });
    }

    _canManageAnnotation(annotation) {
        if (!this._canDraw()) return false;
        const localDrawerId = VideoDrawingOverlay.getLocalDrawerId?.();
        return (
            localDrawerId === annotation.drawerId ||
            localDrawerId === VideoDrawingOverlay.getProducerOwnerId?.(this.producerId)
        );
    }

    deleteSelectedAnnotation() {
        const textAnnotation = this.textAnnotations.get(this.selectedTextAnnotationId);
        if (textAnnotation && this._canManageText(textAnnotation)) {
            this._deleteTextAnnotationWithHistory(textAnnotation);
            return;
        }
        const annotation = this.annotations.get(this.selectedAnnotationId);
        if (!annotation || !this._canManageAnnotation(annotation)) return;
        const snapshot = this._cloneAnnotation(annotation);
        this._removeAnnotation(annotation.annotationId);
        VideoDrawingOverlay.onEmitDrawing?.({
            type: 'annotation',
            action: 'delete',
            producerId: this.producerId,
            annotationId: annotation.annotationId,
        });
        this._recordHistory(
            [{ action: 'create', annotation: snapshot }],
            [{ action: 'delete', annotationId: annotation.annotationId }]
        );
    }

    _removeAnnotation(annotationId) {
        const annotation = this.annotations.get(annotationId);
        if (!annotation) return;
        this._removeDrawerLabel(annotation.drawerId, annotation.object);
        this.fabricCanvas.remove(annotation.object);
        this.annotations.delete(annotationId);
        if (this.selectedAnnotationId === annotationId) {
            this.selectedAnnotationId = null;
            if (this.deleteButton) this.deleteButton.disabled = true;
        }
        this.fabricCanvas.requestRenderAll();
    }

    clearAnnotations(emit = false, drawerId, clearAll = false) {
        if (emit && !this._canDraw()) return;
        const localDrawerId = VideoDrawingOverlay.getLocalDrawerId?.();
        const ownerId = VideoDrawingOverlay.getProducerOwnerId?.(this.producerId);
        const removeAll = clearAll || (emit && localDrawerId === ownerId);
        const targetDrawerId = drawerId || localDrawerId;
        const removedAnnotations = [];
        const removedTextAnnotations = [];
        for (const [annotationId, annotation] of this.annotations) {
            if (removeAll || annotation.drawerId === targetDrawerId) {
                if (emit) removedAnnotations.push(this._cloneAnnotation(annotation));
                this._removeAnnotation(annotationId);
            }
        }
        for (const [annotationId, annotation] of this.textAnnotations) {
            if (removeAll || annotation.drawerId === targetDrawerId) {
                if (emit) removedTextAnnotations.push(this._cloneTextAnnotation(annotation));
                annotation.element.remove();
                this.textAnnotations.delete(annotationId);
            }
        }
        if (emit) {
            VideoDrawingOverlay.onEmitDrawing?.({
                type: 'annotation',
                action: 'clear',
                producerId: this.producerId,
            });
            if (removeAll) {
                VideoDrawingOverlay.onEmitDrawing?.({
                    type: 'text',
                    action: 'clear',
                    producerId: this.producerId,
                });
            } else {
                for (const annotation of removedTextAnnotations) {
                    VideoDrawingOverlay.onEmitDrawing?.({
                        type: 'text',
                        action: 'delete',
                        producerId: this.producerId,
                        annotationId: annotation.annotationId,
                    });
                }
            }
            if (removedAnnotations.length || removedTextAnnotations.length) {
                this._recordHistory(
                    [
                        ...removedAnnotations.map((annotation) => ({ action: 'create', annotation })),
                        ...removedTextAnnotations.map((annotation) => ({ type: 'text', action: 'create', annotation })),
                    ],
                    [
                        ...removedAnnotations.map(({ annotationId }) => ({ action: 'delete', annotationId })),
                        ...removedTextAnnotations.map(({ annotationId }) => ({
                            type: 'text',
                            action: 'delete',
                            annotationId,
                        })),
                    ]
                );
            }
        }
    }

    receiveAnnotation(data) {
        if (data.action === 'clear') {
            this.clearAnnotations(false, data.drawerId, Boolean(data.clearAll));
        } else if (data.action === 'delete') {
            this._removeAnnotation(data.annotationId);
        } else if (data.action === 'move') {
            const annotation = this.annotations.get(data.annotationId);
            if (!annotation || !Array.isArray(data.points)) return;
            annotation.points = data.points;
            this._refreshAnnotationObject(annotation);
            this._showAnnotationDrawerLabel(annotation);
            this.fabricCanvas.requestRenderAll();
        } else if (data.action === 'create') {
            this._addAnnotation(data);
        }
    }

    _clonePoints(points) {
        return points.map(({ x, y }) => ({ x, y }));
    }

    _cloneAnnotation(annotation) {
        return {
            annotationId: annotation.annotationId,
            drawerId: annotation.drawerId,
            peer_name: annotation.peer_name,
            tool: annotation.tool,
            color: annotation.color,
            width: annotation.width,
            points: this._clonePoints(annotation.points),
        };
    }

    _cloneTextAnnotation(annotation) {
        return {
            type: 'text',
            annotationId: annotation.annotationId,
            drawerId: annotation.drawerId,
            peer_name: annotation.peer_name,
            text: annotation.text,
            x: annotation.x,
            y: annotation.y,
            ...this._getTextStyle(annotation),
        };
    }

    _recordHistory(undoCommands, redoCommands) {
        this.undoStack.push({ undoCommands, redoCommands });
        if (this.undoStack.length > 50) this.undoStack.shift();
        this.redoStack = [];
        this._updateHistoryButtons();
    }

    _updateHistoryButtons() {
        if (this.undoButton) this.undoButton.disabled = !this._canDraw() || this.undoStack.length === 0;
        if (this.redoButton) this.redoButton.disabled = !this._canDraw() || this.redoStack.length === 0;
    }

    undo() {
        if (!this._canDraw()) return;
        const entry = this.undoStack.pop();
        if (!entry) return;
        for (const command of entry.undoCommands) this._executeHistoryCommand(command);
        this.redoStack.push(entry);
        this._updateHistoryButtons();
    }

    redo() {
        if (!this._canDraw()) return;
        const entry = this.redoStack.pop();
        if (!entry) return;
        for (const command of entry.redoCommands) this._executeHistoryCommand(command);
        this.undoStack.push(entry);
        this._updateHistoryButtons();
    }

    _executeHistoryCommand(command) {
        if (command.type === 'text') {
            this._executeTextHistoryCommand(command);
            return;
        }
        if (command.action === 'create') {
            const annotation = this._cloneAnnotation(command.annotation);
            this.receiveAnnotation({ action: 'create', ...annotation });
            const localDrawerId = VideoDrawingOverlay.getLocalDrawerId?.();
            VideoDrawingOverlay.onEmitDrawing?.({
                type: 'annotation',
                action: annotation.drawerId === localDrawerId ? 'create' : 'restore',
                producerId: this.producerId,
                ...annotation,
            });
            return;
        }
        if (command.action === 'move') {
            const points = this._clonePoints(command.points);
            this.receiveAnnotation({ action: 'move', annotationId: command.annotationId, points });
            VideoDrawingOverlay.onEmitDrawing?.({
                type: 'annotation',
                action: 'move',
                producerId: this.producerId,
                annotationId: command.annotationId,
                points,
            });
            return;
        }
        this.receiveAnnotation({ action: 'delete', annotationId: command.annotationId });
        VideoDrawingOverlay.onEmitDrawing?.({
            type: 'annotation',
            action: 'delete',
            producerId: this.producerId,
            annotationId: command.annotationId,
        });
    }

    _executeTextHistoryCommand(command) {
        if (command.action === 'create') {
            const annotation = this._cloneTextAnnotation(command.annotation);
            this.receiveText({ action: 'create', ...annotation });
            const localDrawerId = VideoDrawingOverlay.getLocalDrawerId?.();
            VideoDrawingOverlay.onEmitDrawing?.({
                type: 'text',
                action: annotation.drawerId === localDrawerId ? 'create' : 'restore',
                producerId: this.producerId,
                ...annotation,
            });
            return;
        }
        if (command.action === 'move') {
            this.receiveText(command);
            VideoDrawingOverlay.onEmitDrawing?.({
                type: 'text',
                action: 'move',
                producerId: this.producerId,
                annotationId: command.annotationId,
                x: command.x,
                y: command.y,
            });
            return;
        }
        if (command.action === 'update') {
            this.receiveText(command);
            VideoDrawingOverlay.onEmitDrawing?.({
                type: 'text',
                action: 'update',
                producerId: this.producerId,
                ...command,
            });
            return;
        }
        this.receiveText({ action: 'delete', annotationId: command.annotationId });
        VideoDrawingOverlay.onEmitDrawing?.({
            type: 'text',
            action: 'delete',
            producerId: this.producerId,
            annotationId: command.annotationId,
        });
    }

    _handleHistoryKeyDown(event) {
        if (!this.isActive || !(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'z') {
            return;
        }
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
    }

    _beginTextInput(pointerEvent, annotation = null) {
        if (!this._canDraw()) return;
        pointerEvent.preventDefault();
        this.textInput?.__cancel?.();
        this.textInput?.remove();
        const canvasRect = this.fabricCanvas.wrapperEl.getBoundingClientRect();
        const cameraRect = this.cameraDivEl.getBoundingClientRect();
        const point = annotation
            ? { x: annotation.x, y: annotation.y }
            : {
                  x: Math.max(0, Math.min(1, (pointerEvent.clientX - canvasRect.left) / canvasRect.width)),
                  y: Math.max(0, Math.min(1, (pointerEvent.clientY - canvasRect.top) / canvasRect.height)),
              };
        const initialStyle = this._getTextStyle(annotation || this.textStyle);
        const editor = document.createElement('div');
        editor.className = 'video-drawing-text-editor';
        editor.setAttribute('role', 'dialog');
        this._setTranslatedAttribute(editor, 'aria-label', 'Edit screen text annotation', 'labels');
        const setAccessibleLabel = (element, label) =>
            this._setTranslatedAttribute(element, 'aria-label', label, 'tooltips');
        const textTooltipLabels = [
            'Bold text',
            'Italic text',
            'Underline text',
            'Strikethrough text',
            'Text color',
            'Text size',
            'Text alignment: left. Click to cycle',
            'Text alignment: center. Click to cycle',
            'Text alignment: right. Click to cycle',
            'More text options',
            'Text background',
            'Text background color',
            'Text rotation',
            'Cancel text annotation',
            'Save text annotation',
        ];
        const alignmentTooltipLabels = {
            left: textTooltipLabels[6],
            center: textTooltipLabels[7],
            right: textTooltipLabels[8],
        };

        const controls = document.createElement('div');
        controls.className = 'video-drawing-text-editor-controls';
        const formatting = document.createElement('div');
        formatting.className = 'video-drawing-text-formatting';
        formatting.setAttribute('role', 'group');
        this._setTranslatedAttribute(formatting, 'aria-label', 'Text formatting', 'labels');
        const appearance = document.createElement('div');
        appearance.className = 'video-drawing-text-appearance';
        const actions = document.createElement('div');
        actions.className = 'video-drawing-text-actions';
        const morePanel = document.createElement('div');
        morePanel.className = 'video-drawing-text-more-panel';
        morePanel.hidden = true;
        morePanel.setAttribute('role', 'group');
        this._setTranslatedAttribute(morePanel, 'aria-label', 'More text options', 'labels');
        const moreButton = document.createElement('button');
        moreButton.type = 'button';
        moreButton.className = 'fas fa-ellipsis-h';
        setAccessibleLabel(moreButton, 'More text options');
        moreButton.setAttribute('aria-expanded', 'false');
        const setMoreOpen = (open) => {
            if (open) {
                morePanel.style.top = `${controls.offsetTop + controls.offsetHeight + 5}px`;
                morePanel.style.maxHeight = `${input.offsetHeight}px`;
            }
            morePanel.hidden = !open;
            moreButton.setAttribute('aria-expanded', String(open));
        };
        moreButton.addEventListener('click', () => setMoreOpen(morePanel.hidden));
        appearance.appendChild(moreButton);
        controls.append(formatting, appearance, actions);
        const createToggle = (className, label, selected) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = className;
            setAccessibleLabel(button, label);
            button.setAttribute('aria-pressed', String(selected));
            button.addEventListener('click', () => {
                button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
                updatePreview();
                input.focus();
            });
            return button;
        };

        const bold = createToggle('fas fa-bold', 'Bold text', initialStyle.bold);
        const italic = createToggle('fas fa-italic', 'Italic text', initialStyle.italic);
        const underline = createToggle('fas fa-underline', 'Underline text', initialStyle.underline);
        const strikethrough = createToggle('fas fa-strikethrough', 'Strikethrough text', initialStyle.strikethrough);
        formatting.append(bold, italic, underline, strikethrough);
        let textAlign = initialStyle.textAlign;
        const alignmentButton = document.createElement('button');
        alignmentButton.type = 'button';
        const updateAlignmentButton = () => {
            alignmentButton.className = `video-drawing-text-alignment fas fa-align-${textAlign}`;
            const label = alignmentTooltipLabels[textAlign];
            setAccessibleLabel(alignmentButton, label);
            alignmentButton.dataset.alignment = textAlign;
            if (alignmentButton._tippy && typeof setTippy === 'function') setTippy(alignmentButton.id, label, 'bottom');
        };
        const setAlignment = (alignment) => {
            textAlign = alignment;
            updateAlignmentButton();
            updatePreview();
            input.focus();
        };
        alignmentButton.addEventListener('click', () => {
            const alignments = ['left', 'center', 'right'];
            setAlignment(alignments[(alignments.indexOf(textAlign) + 1) % alignments.length]);
        });
        updateAlignmentButton();

        const textColor = document.createElement('input');
        textColor.type = 'color';
        textColor.value = initialStyle.color;
        textColor.className = 'video-drawing-text-color';
        setAccessibleLabel(textColor, 'Text color');
        formatting.appendChild(textColor);
        const backgroundToggle = createToggle(
            'fas fa-fill-drip',
            'Text background',
            initialStyle.backgroundColor !== 'transparent'
        );
        const backgroundControls = document.createElement('div');
        backgroundControls.className = 'video-drawing-text-background-controls';
        backgroundControls.appendChild(backgroundToggle);
        const backgroundColor = document.createElement('input');
        backgroundColor.type = 'color';
        backgroundColor.value =
            initialStyle.backgroundColor === 'transparent' ? '#000000' : initialStyle.backgroundColor;
        backgroundColor.className = 'video-drawing-text-background-color';
        setAccessibleLabel(backgroundColor, 'Text background color');
        backgroundControls.appendChild(backgroundColor);

        const fontSize = document.createElement('select');
        fontSize.className = 'video-drawing-text-size';
        setAccessibleLabel(fontSize, 'Text size');
        for (const size of [12, 16, 20, 24, 32]) {
            const option = document.createElement('option');
            option.value = String(size);
            option.textContent = `${size}px`;
            option.selected = size === initialStyle.fontSize;
            fontSize.appendChild(option);
        }
        formatting.append(fontSize, alignmentButton);
        const rotation = document.createElement('select');
        rotation.className = 'video-drawing-text-rotation';
        setAccessibleLabel(rotation, 'Text rotation');
        for (const degrees of [-45, -30, -15, 0, 15, 30, 45]) {
            const option = document.createElement('option');
            option.value = String(degrees);
            option.textContent = `${degrees}\u00b0`;
            option.selected = degrees === initialStyle.rotation;
            rotation.appendChild(option);
        }
        for (const [label, control] of [
            ['Background', backgroundControls],
            ['Rotation', rotation],
        ]) {
            const row = document.createElement('div');
            row.className = 'video-drawing-text-more-row';
            const caption = document.createElement('span');
            const captionText = document.createTextNode(window.i18n?.t(label, 'labels') || label);
            captionText.__i18nSrc = label;
            caption.appendChild(captionText);
            row.append(caption, control);
            morePanel.appendChild(row);
        }

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'video-drawing-text-cancel fas fa-times';
        setAccessibleLabel(cancelButton, 'Cancel text annotation');
        actions.appendChild(cancelButton);

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'video-drawing-text-save fas fa-check';
        setAccessibleLabel(saveButton, 'Save text annotation');
        actions.appendChild(saveButton);

        const input = document.createElement('textarea');
        input.maxLength = VideoDrawingOverlay.MAX_TEXT_LENGTH;
        input.rows = 3;
        input.className = 'video-drawing-text-input';
        this._setTranslatedAttribute(input, 'placeholder', 'Type annotation', 'labels');
        this._setTranslatedAttribute(input, 'aria-label', 'Screen text annotation', 'labels');
        const updatePreview = () => {
            input.style.setProperty('color', textColor.value, 'important');
            input.style.setProperty('-webkit-text-fill-color', textColor.value);
            input.style.fontSize = `${fontSize.value}px`;
            input.style.fontWeight = bold.getAttribute('aria-pressed') === 'true' ? '700' : '500';
            input.style.fontStyle = italic.getAttribute('aria-pressed') === 'true' ? 'italic' : 'normal';
            input.style.textDecoration = [
                underline.getAttribute('aria-pressed') === 'true' ? 'underline' : '',
                strikethrough.getAttribute('aria-pressed') === 'true' ? 'line-through' : '',
            ]
                .filter(Boolean)
                .join(' ');
            input.style.textAlign = textAlign;
            input.style.setProperty(
                'background',
                backgroundToggle.getAttribute('aria-pressed') === 'true' ? backgroundColor.value : 'transparent',
                'important'
            );
        };
        textColor.addEventListener('input', updatePreview);
        textColor.addEventListener('change', updatePreview);
        const updateBackgroundColor = () => {
            backgroundToggle.setAttribute('aria-pressed', 'true');
            updatePreview();
        };
        backgroundColor.addEventListener('input', updateBackgroundColor);
        backgroundColor.addEventListener('change', updateBackgroundColor);
        fontSize.addEventListener('change', updatePreview);
        input.value = annotation?.text || '';
        updatePreview();
        editor.append(controls, morePanel, input);
        editor.style.width = `${Math.min(480, cameraRect.width - 16)}px`;
        this.cameraDivEl.appendChild(editor);
        formatting.style.flex = '0 0 auto';
        const toolbarWidth =
            formatting.scrollWidth +
            appearance.offsetWidth +
            actions.offsetWidth +
            2 * (Number.parseFloat(getComputedStyle(controls).columnGap) || 0) +
            editor.offsetWidth -
            controls.clientWidth;
        formatting.style.removeProperty('flex');
        const inputWidth = Math.min(cameraRect.width - 16, Math.max(160, Math.ceil(toolbarWidth) || 480));
        const inputLeft = Math.min(
            point.x * canvasRect.width + canvasRect.left - cameraRect.left,
            cameraRect.width - inputWidth - 8
        );
        const inputTop = Math.min(
            point.y * canvasRect.height + canvasRect.top - cameraRect.top,
            cameraRect.height - 150
        );
        editor.style.left = `${Math.max(8, inputLeft)}px`;
        editor.style.top = `${Math.max(8, inputTop)}px`;
        editor.style.width = `${inputWidth}px`;
        editor.style.maxWidth = `${Math.max(160, cameraRect.width - inputLeft - 8)}px`;
        editor.style.maxHeight = `${Math.max(120, cameraRect.height - Math.max(8, inputTop) - 8)}px`;
        const tooltipControls = [...editor.querySelectorAll('button, input, select')];
        if (typeof setTippy === 'function') {
            for (const [index, control] of tooltipControls.entries()) {
                control.id = `video-drawing-text-${this.producerId}-${index}`;
                setTippy(control.id, control['__i18nAttr_aria-label'], 'bottom');
            }
        }
        editor.__destroyTooltips = () => {
            for (const control of tooltipControls) control._tippy?.destroy();
        };
        editor.addEventListener('pointerdown', (event) => {
            if (!morePanel.contains(event.target) && !moreButton.contains(event.target)) setMoreOpen(false);
        });
        editor.addEventListener('focusout', (event) => {
            if (event.relatedTarget && !editor.contains(event.relatedTarget)) setMoreOpen(false);
        });
        editor.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (!morePanel.hidden) {
                    setMoreOpen(false);
                    moreButton.focus();
                } else finish(false);
            }
            event.stopPropagation();
        });
        this.textInput = editor;
        annotation?.element.classList.add('video-drawing-text-editing');

        let finished = false;
        const finish = (commit) => {
            if (finished) return;
            finished = true;
            const text = input.value.trim();
            const style = this._getTextStyle({
                color: textColor.value,
                fontSize: Number(fontSize.value),
                bold: bold.getAttribute('aria-pressed') === 'true',
                italic: italic.getAttribute('aria-pressed') === 'true',
                underline: underline.getAttribute('aria-pressed') === 'true',
                strikethrough: strikethrough.getAttribute('aria-pressed') === 'true',
                textAlign,
                backgroundColor:
                    backgroundToggle.getAttribute('aria-pressed') === 'true' ? backgroundColor.value : 'transparent',
                rotation: Number(rotation.value),
                boxWidth: editor.offsetWidth / canvasRect.width,
            });
            editor.__destroyTooltips();
            editor.remove();
            if (this.textInput === editor) this.textInput = null;
            annotation?.element.classList.remove('video-drawing-text-editing');
            if (!commit || !text) return;

            if (annotation) {
                const previousAnnotation = this._cloneTextAnnotation(annotation);
                const nextAnnotation = { ...previousAnnotation, text, ...style };
                if (JSON.stringify(previousAnnotation) === JSON.stringify(nextAnnotation)) return;
                this.updateTextAnnotation(annotation.annotationId, nextAnnotation);
                this._recordHistory(
                    [{ type: 'text', action: 'update', ...previousAnnotation }],
                    [{ type: 'text', action: 'update', ...nextAnnotation }]
                );
                VideoDrawingOverlay.onEmitDrawing?.({
                    type: 'text',
                    action: 'update',
                    producerId: this.producerId,
                    ...nextAnnotation,
                });
                return;
            }

            const newAnnotation = {
                annotationId: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                drawerId: VideoDrawingOverlay.getLocalDrawerId?.(),
                peer_name: VideoDrawingOverlay.resolveDrawerName?.(VideoDrawingOverlay.getLocalDrawerId?.()),
                text,
                ...style,
                ...point,
            };
            this.textStyle = style;
            this.addTextAnnotation(newAnnotation);
            this._recordHistory(
                [{ type: 'text', action: 'delete', annotationId: newAnnotation.annotationId }],
                [{ type: 'text', action: 'create', annotation: this._cloneTextAnnotation(newAnnotation) }]
            );
            VideoDrawingOverlay.onEmitDrawing?.({
                type: 'text',
                action: 'create',
                producerId: this.producerId,
                annotationId: newAnnotation.annotationId,
                text,
                ...style,
                x: +point.x.toFixed(4),
                y: +point.y.toFixed(4),
            });
        };
        editor.__cancel = () => finish(false);
        input.addEventListener('keydown', (event) => {
            if ((event.metaKey || event.ctrlKey) && !event.altKey) {
                const key = event.key.toLowerCase();
                const toggle =
                    key === 'b'
                        ? bold
                        : key === 'i'
                          ? italic
                          : key === 'u'
                            ? underline
                            : event.shiftKey && key === 'x'
                              ? strikethrough
                              : null;
                if (toggle) {
                    event.preventDefault();
                    toggle.click();
                }
                if (event.shiftKey && ['l', 'e', 'r'].includes(key)) {
                    event.preventDefault();
                    setAlignment(key === 'l' ? 'left' : key === 'e' ? 'center' : 'right');
                }
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) finish(true);
            if (event.key !== 'Escape') event.stopPropagation();
        });
        saveButton.addEventListener('click', () => finish(true));
        cancelButton.addEventListener('click', () => finish(false));
        input.focus();
        input.select();
    }

    addTextAnnotation(annotation) {
        if (!annotation.annotationId || this.textAnnotations.has(annotation.annotationId)) return;
        Object.assign(annotation, this._getTextStyle(annotation));
        const element = document.createElement('div');
        element.className = 'video-drawing-text-annotation';
        element.tabIndex = 0;
        element.setAttribute('role', 'note');
        const drawerName = String(annotation.peer_name || 'Participant').trim();
        this._setTranslatedAttribute(element, 'aria-label', 'Screen text annotation', 'labels');

        const content = document.createElement('span');
        content.className = 'video-drawing-text-content notranslate';
        content.textContent = annotation.text;
        element.appendChild(content);
        annotation.element = element;
        this._applyTextAnnotationStyle(annotation);
        element.classList.toggle('video-drawing-text-select-mode', this.activeTool === 'select');
        const author = document.createElement('span');
        author.className = 'video-drawing-text-author';
        const authorLabel = 'Annotated by';
        const authorLabelNode = document.createTextNode(`${window.i18n?.t(authorLabel, 'labels') || authorLabel} `);
        authorLabelNode.__i18nSrc = `${authorLabel} `;
        author.appendChild(authorLabelNode);
        const authorName = document.createElement('span');
        authorName.className = 'notranslate';
        authorName.textContent = drawerName;
        author.appendChild(authorName);
        element.appendChild(author);

        this.textAnnotations.set(annotation.annotationId, annotation);
        this.cameraDivEl.appendChild(element);
        if (annotation.drawerId === VideoDrawingOverlay.getLocalDrawerId?.() || this._isScreenOwner()) {
            element.classList.add('video-drawing-text-manageable');
            const editButton = document.createElement('button');
            editButton.type = 'button';
            editButton.className = 'video-drawing-text-edit fas fa-pen';
            this._setTranslatedAttribute(editButton, 'aria-label', 'Edit text annotation', 'buttons');
            editButton.addEventListener('click', (event) => {
                event.stopPropagation();
                this._beginTextInput(event, annotation);
            });
            element.appendChild(editButton);

            const duplicateButton = document.createElement('button');
            duplicateButton.type = 'button';
            duplicateButton.className = 'video-drawing-text-duplicate fas fa-copy';
            this._setTranslatedAttribute(duplicateButton, 'aria-label', 'Duplicate text annotation', 'buttons');
            duplicateButton.addEventListener('click', (event) => {
                event.stopPropagation();
                this._duplicateTextAnnotation(annotation);
            });
            element.appendChild(duplicateButton);

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'video-drawing-text-delete fas fa-times';
            this._setTranslatedAttribute(deleteButton, 'aria-label', 'Delete text annotation', 'buttons');
            deleteButton.addEventListener('click', (event) => {
                event.stopPropagation();
                this._deleteTextAnnotationWithHistory(annotation);
            });
            element.appendChild(deleteButton);
            element.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                this._beginTextInput(event, annotation);
            });
            this._bindTextDrag(annotation);
        }
        this._positionTextAnnotation(annotation);
    }

    _canManageText(annotation) {
        if (!this._canDraw()) return false;
        const localDrawerId = VideoDrawingOverlay.getLocalDrawerId?.();
        return (
            localDrawerId === annotation.drawerId ||
            localDrawerId === VideoDrawingOverlay.getProducerOwnerId?.(this.producerId)
        );
    }

    _bindTextDrag(annotation) {
        const { element } = annotation;
        let drag = null;
        annotation.cancelDrag = () => {
            if (!drag) return;
            annotation.x = drag.originalX;
            annotation.y = drag.originalY;
            drag = null;
            element.classList.remove('video-drawing-text-dragging');
            this._positionTextAnnotation(annotation);
        };
        element.addEventListener('pointerdown', (event) => {
            if (!this._canManageText(annotation) || this.activeTool === 'eraser') return;
            if (event.target.closest('button') || event.button > 0) return;
            event.preventDefault();
            if (this.activeTool === 'select') this._selectTextAnnotation(annotation.annotationId);
            element.focus({ preventScroll: true });
            const rect = element.getBoundingClientRect();
            drag = {
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top,
                originalX: annotation.x,
                originalY: annotation.y,
            };
            element.setPointerCapture(event.pointerId);
            element.classList.add('video-drawing-text-dragging');
        });
        element.addEventListener('pointermove', (event) => {
            if (!this._canManageText(annotation)) {
                annotation.cancelDrag();
                return;
            }
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
            if (!this._canManageText(annotation)) {
                annotation.cancelDrag();
                return;
            }
            if (!drag || drag.pointerId !== event.pointerId) return;
            const { originalX, originalY } = drag;
            drag = null;
            element.classList.remove('video-drawing-text-dragging');
            if (originalX === annotation.x && originalY === annotation.y) return;
            this._recordHistory(
                [{ type: 'text', action: 'move', annotationId: annotation.annotationId, x: originalX, y: originalY }],
                [
                    {
                        type: 'text',
                        action: 'move',
                        annotationId: annotation.annotationId,
                        x: annotation.x,
                        y: annotation.y,
                    },
                ]
            );
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
        const annotationScale = Math.max(0.5, Math.min(1, width / 640, height / 360));
        annotation.element.style.setProperty('--video-drawing-annotation-scale', annotationScale);
        annotation.element.style.fontSize = `${annotation.fontSize * annotationScale}px`;
        annotation.element.style.width = 'max-content';
        annotation.element.style.maxWidth = `${Math.max(80, Math.min(annotation.boxWidth * width, width - 16))}px`;
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

    updateTextAnnotation(annotationId, data) {
        const annotation = this.textAnnotations.get(annotationId);
        if (!annotation) return;
        annotation.text = data.text;
        Object.assign(annotation, this._getTextStyle(data));
        annotation.element.querySelector('.video-drawing-text-content').textContent = data.text;
        this._applyTextAnnotationStyle(annotation);
        this._positionTextAnnotation(annotation);
    }

    _getTextStyle(source = {}) {
        const validColor = typeof source.color === 'string' && /^#[0-9a-f]{6}$/i.test(source.color);
        const fontSize = [12, 16, 20, 24, 32].includes(Number(source.fontSize)) ? Number(source.fontSize) : 16;
        const boxWidth = Number.isFinite(Number(source.boxWidth)) ? Number(source.boxWidth) : 0.35;
        return {
            color: validColor ? source.color : '#ffffff',
            fontSize,
            bold: source.bold === true,
            italic: source.italic === true,
            boxWidth: Math.max(0.15, Math.min(0.8, boxWidth)),
            underline: source.underline === true,
            strikethrough: source.strikethrough === true,
            textAlign: ['left', 'center', 'right'].includes(source.textAlign) ? source.textAlign : 'left',
            backgroundColor:
                typeof source.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(source.backgroundColor)
                    ? source.backgroundColor
                    : 'transparent',
            rotation: [-45, -30, -15, 0, 15, 30, 45].includes(Number(source.rotation)) ? Number(source.rotation) : 0,
        };
    }

    _applyTextAnnotationStyle(annotation) {
        annotation.element.style.setProperty('--video-drawing-text-color', annotation.color);
        annotation.element.style.setProperty('--video-drawing-text-background', annotation.backgroundColor);
        annotation.element.style.textAlign = annotation.textAlign;
        annotation.element.style.transform = `rotate(${annotation.rotation}deg)`;
        annotation.element.classList.toggle('video-drawing-text-bold', annotation.bold);
        annotation.element.classList.toggle('video-drawing-text-italic', annotation.italic);
        annotation.element.classList.toggle('video-drawing-text-underline', annotation.underline);
        annotation.element.classList.toggle('video-drawing-text-strikethrough', annotation.strikethrough);
        annotation.element.classList.toggle(
            'video-drawing-text-has-background',
            annotation.backgroundColor !== 'transparent'
        );
    }

    _duplicateTextAnnotation(annotation) {
        if (!this._canManageText(annotation)) return;
        const drawerId = VideoDrawingOverlay.getLocalDrawerId?.();
        const duplicate = {
            ...this._cloneTextAnnotation(annotation),
            annotationId: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            drawerId,
            peer_name: VideoDrawingOverlay.resolveDrawerName?.(drawerId),
            x: Math.min(0.95, annotation.x + 0.02),
            y: Math.min(0.95, annotation.y + 0.02),
        };
        this.addTextAnnotation(duplicate);
        this._recordHistory(
            [{ type: 'text', action: 'delete', annotationId: duplicate.annotationId }],
            [{ type: 'text', action: 'create', annotation: this._cloneTextAnnotation(duplicate) }]
        );
        VideoDrawingOverlay.onEmitDrawing?.({
            type: 'text',
            action: 'create',
            producerId: this.producerId,
            ...this._cloneTextAnnotation(duplicate),
        });
    }

    _deleteTextAnnotationWithHistory(annotation) {
        if (!this._canManageText(annotation)) return;
        const snapshot = this._cloneTextAnnotation(annotation);
        this.deleteTextAnnotation(annotation.annotationId);
        this._recordHistory(
            [{ type: 'text', action: 'create', annotation: snapshot }],
            [{ type: 'text', action: 'delete', annotationId: annotation.annotationId }]
        );
        VideoDrawingOverlay.onEmitDrawing?.({
            type: 'text',
            action: 'delete',
            producerId: this.producerId,
            annotationId: annotation.annotationId,
        });
    }

    deleteTextAnnotation(annotationId) {
        const annotation = this.textAnnotations.get(annotationId);
        if (!annotation) return;
        annotation.element.remove();
        this.textAnnotations.delete(annotationId);
        if (this.selectedTextAnnotationId === annotationId) this._selectTextAnnotation(null);
    }

    clearTextAnnotations() {
        for (const annotation of this.textAnnotations.values()) annotation.element.remove();
        this.textAnnotations.clear();
        if (this.selectedTextAnnotationId) this._selectTextAnnotation(null);
    }

    receiveText(data) {
        if (data.action === 'move') {
            const annotation = this.textAnnotations.get(data.annotationId);
            if (annotation) {
                annotation.x = data.x;
                annotation.y = data.y;
                this._positionTextAnnotation(annotation);
            }
        } else if (data.action === 'update') this.updateTextAnnotation(data.annotationId, data);
        else if (data.action === 'delete') this.deleteTextAnnotation(data.annotationId);
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

    _showAnnotationDrawerLabel(annotation) {
        const peerName =
            annotation.peer_name || VideoDrawingOverlay.resolveDrawerName?.(annotation.drawerId) || 'Participant';
        this._showDrawerLabel(annotation.drawerId, peerName, annotation.object);
        clearTimeout(this._drawerLabelTimers.get(annotation.drawerId));
        const timer = setTimeout(() => {
            this._removeDrawerLabel(annotation.drawerId, annotation.object);
        }, VideoDrawingOverlay.AUTO_CLEAR_MS);
        this._drawerLabelTimers.set(annotation.drawerId, timer);
    }

    _removeDrawerLabel(drawerId, path) {
        const drawerLabel = this._drawerLabels.get(drawerId);
        if (!drawerLabel || (path && drawerLabel.path !== path)) return;
        clearTimeout(this._drawerLabelTimers.get(drawerId));
        this._drawerLabelTimers.delete(drawerId);
        this.fabricCanvas.remove(drawerLabel.group);
        this._drawerLabels.delete(drawerId);
        this.fabricCanvas.requestRenderAll();
    }

    /**
     * Clear all drawings immediately.
     */
    clearAll() {
        this._stopLaser();
        for (const drawerId of this.laserPointers.keys()) this._removeLaser(drawerId);
        // Cancel all pending auto-clear timers
        for (const [, timerId] of this._clearTimers) {
            clearTimeout(timerId);
        }
        this._clearTimers.clear();
        for (const timerId of this._drawerLabelTimers.values()) clearTimeout(timerId);
        this._drawerLabelTimers.clear();
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
        this._finishErasing();
        this._stopLaser();
        for (const drawerId of this.laserPointers.keys()) this._removeLaser(drawerId);

        // Cancel all pending timers
        for (const [, timerId] of this._clearTimers) {
            clearTimeout(timerId);
        }
        this._clearTimers.clear();
        for (const timerId of this._drawerLabelTimers.values()) clearTimeout(timerId);
        this._drawerLabelTimers.clear();

        // Cancel sync timer
        if (this._syncTimerId) {
            clearTimeout(this._syncTimerId);
            this._syncTimerId = null;
        }
        this._pendingPaths = [];
        document.removeEventListener('keydown', this._handleHistoryKeyDown);
        document.removeEventListener('pointerdown', this._handleToolbarOutsidePointer);

        if (VideoDrawingOverlay.getProducerOwnerId?.(this.producerId) === VideoDrawingOverlay.getLocalDrawerId?.()) {
            VideoDrawingOverlay.onEmitDrawing?.({ type: 'text', action: 'clear', producerId: this.producerId });
        }
        this.textInput?.__cancel?.();
        this.clearTextAnnotations();
        this.clearAnnotations();
        for (const control of this.toolbar?.querySelectorAll('button, input') || []) control._tippy?.destroy();
        this.toolbar?.remove();

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
        VideoDrawingOverlay.pendingTextEvents.delete(this.producerId);
        VideoDrawingOverlay.pendingAnnotationEvents.delete(this.producerId);
        VideoDrawingOverlay.pendingPermissions.delete(this.producerId);
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

    static refreshPermissions() {
        for (const [, overlay] of VideoDrawingOverlay.overlays) {
            overlay.refreshPermissions();
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
        if (data.type === 'permissions') {
            if (typeof data.allowed !== 'boolean') return;
            const overlay = [...VideoDrawingOverlay.overlays.values()].find(
                (entry) => entry.producerId === data.producerId
            );
            if (overlay) overlay.setParticipantsAllowed(data.allowed);
            else VideoDrawingOverlay.pendingPermissions.set(data.producerId, data.allowed);
            return;
        }

        // Find the overlay or create one (canvas must exist in DOM)
        let overlay = VideoDrawingOverlay.overlays.get(data.cameraId);
        if (!overlay) {
            const camDiv = document.getElementById(data.cameraId);
            if (!camDiv) {
                if ((data.type === 'text' || data.type === 'annotation') && data.producerId) {
                    const pendingEvents =
                        data.type === 'text'
                            ? VideoDrawingOverlay.pendingTextEvents
                            : VideoDrawingOverlay.pendingAnnotationEvents;
                    const limit = data.type === 'text' ? 200 : 500;
                    const pending = pendingEvents.get(data.producerId) || [];
                    if (pending.length < limit) pending.push(data);
                    pendingEvents.set(data.producerId, pending);
                    return;
                }
                console.warn('[VideoDrawingOverlay] Camera div not found for remote drawing:', data.cameraId);
                return;
            }
            overlay = new VideoDrawingOverlay(camDiv, data.producerId);
        }

        if (data.type === 'text') overlay.receiveText(data);
        else if (data.type === 'annotation') overlay.receiveAnnotation(data);
        else if (data.type === 'laser') overlay.receiveLaser(data);
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
        VideoDrawingOverlay.pendingAnnotationEvents.clear();
        VideoDrawingOverlay.pendingPermissions.clear();
    }
}

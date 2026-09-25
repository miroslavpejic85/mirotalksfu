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
        this.isToolbarCollapsed = false;
        this.activeTool = null;
        this.lastDrawingTool = 'pencil';
        this.annotationColor = '#ffeb3b';
        this.annotationWidth = 0.004;
        this.annotations = new Map();
        this.selectedAnnotationId = null;
        this.activeShape = null;
        this.undoStack = [];
        this.redoStack = [];
        this._clearTimers = new Map();
        this._drawerLabels = new Map();
        this._drawerLabelTimers = new Map();
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
            if (['circle', 'rectangle', 'arrow'].includes(this.activeTool) && event.e) {
                this._beginShape(event.e);
            }
        });
        this.fabricCanvas.on('mouse:move', (event) => {
            if (this.activeShape && event.e) this._resizeShape(event.e);
        });
        this.fabricCanvas.on('mouse:up', () => this._finishShape());
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
        brush.color = this.activeTool === 'vanishing' ? VideoDrawingOverlay.BRUSH_COLOR : this.annotationColor;
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

        this._prevWidth = newWidth;
        this._prevHeight = newHeight;
    }

    // ####################################################
    // PUBLIC METHODS
    // ####################################################

    bindControls(drawingButton, textButton) {
        this.drawingButton = drawingButton;
        this.textButton = textButton;

        const annotationTooltipLabels = [
            'Move annotation toolbar',
            'Pencil',
            'Highlighter',
            'Vanishing pen',
            'Circle',
            'Rectangle',
            'Arrow',
            'Select and move',
            'Annotation color',
            'Annotation width',
            'Undo annotation',
            'Redo annotation',
            'Delete selected annotation',
            'Clear my screen annotations',
            'Clear screen annotations',
            'Hide annotation toolbar',
        ];
        annotationTooltipLabels.forEach((label) => window.i18n?.t(label, 'tooltips'));

        const toolbar = document.createElement('div');
        toolbar.className = 'video-drawing-toolbar';
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-orientation', 'horizontal');
        this._setTranslatedAttribute(toolbar, 'aria-label', 'Screen annotation tools', 'labels');

        const dragHandle = this._createToolbarButton(
            'video-drawing-drag-handle fas fa-arrows-alt',
            'Move annotation toolbar'
        );
        toolbar.appendChild(dragHandle);

        const drawingTools = this._createToolbarGroup('Drawing tools');
        const tools = [
            ['pencil', 'fas fa-pencil-alt', 'Pencil'],
            ['highlighter', 'fas fa-highlighter', 'Highlighter'],
            ['vanishing', 'fas fa-wand-magic-sparkles', 'Vanishing pen'],
            ['circle', 'far fa-circle', 'Circle'],
            ['rectangle', 'far fa-square', 'Rectangle'],
            ['arrow', 'fas fa-arrow-right-long', 'Arrow'],
            ['select', 'fas fa-mouse-pointer', 'Select and move'],
        ];
        this.toolButtons = {};
        for (const [tool, icon, label] of tools) {
            const button = this._createToolbarButton(icon, label);
            button.setAttribute('aria-pressed', 'false');
            button.addEventListener('click', () => {
                this.lastDrawingTool = tool;
                this.setTool(tool);
            });
            drawingTools.appendChild(button);
            this.toolButtons[tool] = button;
        }
        toolbar.appendChild(drawingTools);

        const appearanceTools = this._createToolbarGroup('Annotation appearance');
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = this.annotationColor;
        colorInput.className = 'video-drawing-color';
        this._setTranslatedAttribute(colorInput, 'aria-label', 'Annotation color', 'tooltips');
        colorInput.addEventListener('input', () => {
            this.annotationColor = colorInput.value;
            this._setupBrush();
        });
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
            this._setupBrush();
        });
        appearanceTools.appendChild(widthInput);
        toolbar.appendChild(appearanceTools);

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
        historyTools.appendChild(this.deleteButton);
        toolbar.appendChild(historyTools);

        const clearLabel =
            VideoDrawingOverlay.getLocalDrawerId?.() === VideoDrawingOverlay.getProducerOwnerId?.(this.producerId)
                ? 'Clear screen annotations'
                : 'Clear my screen annotations';
        const clearButton = this._createToolbarButton('fas fa-broom', clearLabel);
        clearButton.addEventListener('click', () => this.clearAnnotations(true));
        toolbar.appendChild(clearButton);

        const closeButton = this._createToolbarButton('video-drawing-close fas fa-times', 'Hide annotation toolbar');
        closeButton.addEventListener('click', () => this.setToolbarCollapsed(true));
        toolbar.appendChild(closeButton);
        toolbar.addEventListener('keydown', (event) => this._handleToolbarKeyDown(event));

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
            const drawingActive = this.isActive && this.activeTool !== 'text';
            if (drawingActive && this.isToolbarCollapsed) {
                this.setToolbarCollapsed(false);
                return;
            }
            if (!drawingActive) this.setToolbarCollapsed(false);
            this.setTool(drawingActive ? null : this.lastDrawingTool);
        });
        textButton.addEventListener('click', () => {
            this.setTool(this.isActive && this.activeTool === 'text' ? null : 'text');
        });
        this.refreshPermissions();
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

    _handleToolbarKeyDown(event) {
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
        this.toolbar?.classList.toggle('video-drawing-toolbar-collapsed', collapsed);
        if (collapsed && this.toolbar?.contains(document.activeElement) && !this.drawingButton?.hidden) {
            this.drawingButton?.focus();
        }
    }

    setTool(tool) {
        if (tool && !this._canDraw()) return;
        this.isActive = Boolean(tool);
        this.activeTool = tool;
        const drawingMode = ['pencil', 'highlighter', 'vanishing'].includes(tool);
        this.fabricCanvas.isDrawingMode = drawingMode;
        this.fabricCanvas.selection = tool === 'select';
        this._setupBrush();

        for (const annotation of this.annotations.values()) {
            annotation.object.selectable = tool === 'select' && this._canManageAnnotation(annotation);
            annotation.object.evented = annotation.object.selectable;
        }
        if (tool !== 'select') this.fabricCanvas.discardActiveObject();

        const wrapper = this.fabricCanvas.wrapperEl;
        wrapper?.classList.toggle('video-drawing-active', this.isActive);
        wrapper?.classList.toggle('video-drawing-inactive', !this.isActive);
        wrapper?.classList.toggle('video-drawing-selecting', tool === 'select');
        this.toolbar?.classList.toggle(
            'video-drawing-toolbar-active',
            drawingMode || ['circle', 'rectangle', 'arrow', 'select'].includes(tool)
        );

        for (const [buttonTool, button] of Object.entries(this.toolButtons || {})) {
            const selected = this.isActive && buttonTool === tool;
            button.classList.toggle('video-drawing-tool-active', selected);
            button.setAttribute('aria-pressed', String(selected));
        }
        this.drawingButton?.classList.toggle('video-drawing-tool-active', this.isActive && tool !== 'text');
        this.textButton?.classList.toggle('video-drawing-tool-active', this.isActive && tool === 'text');
        this.drawingButton?.setAttribute('aria-pressed', String(this.isActive && tool !== 'text'));
        this.textButton?.setAttribute('aria-pressed', String(this.isActive && tool === 'text'));
        if (tool !== 'text') this.textInput?.remove();
        this.fabricCanvas.requestRenderAll();
    }

    refreshPermissions() {
        const canDraw = this._canDraw();
        if (this.drawingButton) {
            this.drawingButton.hidden = !canDraw;
            this.drawingButton.disabled = !canDraw;
        }
        if (this.textButton) {
            this.textButton.hidden = !canDraw;
            this.textButton.disabled = !canDraw;
        }
        if (!canDraw) {
            if (this.isActive) this.setTool(null);
            this.setToolbarCollapsed(true);
        }
    }

    _canDraw() {
        return VideoDrawingOverlay.canDraw?.(this.producerId) !== false;
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
        if (this.activeTool !== 'text') this.textInput?.remove();

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
                    stroke: annotation.color,
                    strokeWidth: Math.max(2, annotation.width * width),
                    strokeLineCap: 'round',
                    strokeLineJoin: 'round',
                    opacity: annotation.tool === 'highlighter' ? 0.35 : 1,
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
        const annotation = object && this.annotations.get(object.annotationId);
        this.selectedAnnotationId = annotation?.annotationId || null;
        if (this.deleteButton) this.deleteButton.disabled = !annotation || !this._canManageAnnotation(annotation);
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
        const localDrawerId = VideoDrawingOverlay.getLocalDrawerId?.();
        return (
            localDrawerId === annotation.drawerId ||
            localDrawerId === VideoDrawingOverlay.getProducerOwnerId?.(this.producerId)
        );
    }

    deleteSelectedAnnotation() {
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
        const localDrawerId = VideoDrawingOverlay.getLocalDrawerId?.();
        const ownerId = VideoDrawingOverlay.getProducerOwnerId?.(this.producerId);
        const removeAll = clearAll || (emit && localDrawerId === ownerId);
        const targetDrawerId = drawerId || localDrawerId;
        const removedAnnotations = [];
        for (const [annotationId, annotation] of this.annotations) {
            if (removeAll || annotation.drawerId === targetDrawerId) {
                if (emit) removedAnnotations.push(this._cloneAnnotation(annotation));
                this._removeAnnotation(annotationId);
            }
        }
        if (emit) {
            VideoDrawingOverlay.onEmitDrawing?.({
                type: 'annotation',
                action: 'clear',
                producerId: this.producerId,
            });
            if (removedAnnotations.length) {
                this._recordHistory(
                    removedAnnotations.map((annotation) => ({ action: 'create', annotation })),
                    removedAnnotations.map(({ annotationId }) => ({ action: 'delete', annotationId }))
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

    _recordHistory(undoCommands, redoCommands) {
        this.undoStack.push({ undoCommands, redoCommands });
        if (this.undoStack.length > 50) this.undoStack.shift();
        this.redoStack = [];
        this._updateHistoryButtons();
    }

    _updateHistoryButtons() {
        if (this.undoButton) this.undoButton.disabled = this.undoStack.length === 0;
        if (this.redoButton) this.redoButton.disabled = this.redoStack.length === 0;
    }

    undo() {
        const entry = this.undoStack.pop();
        if (!entry) return;
        for (const command of entry.undoCommands) this._executeHistoryCommand(command);
        this.redoStack.push(entry);
        this._updateHistoryButtons();
    }

    redo() {
        const entry = this.redoStack.pop();
        if (!entry) return;
        for (const command of entry.redoCommands) this._executeHistoryCommand(command);
        this.undoStack.push(entry);
        this._updateHistoryButtons();
    }

    _executeHistoryCommand(command) {
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

    _handleHistoryKeyDown(event) {
        if (!this.isActive || !(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'z') {
            return;
        }
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
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
        this._setTranslatedAttribute(input, 'placeholder', 'Type annotation', 'labels');
        this._setTranslatedAttribute(input, 'aria-label', 'Screen text annotation', 'labels');
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
        this._setTranslatedAttribute(element, 'aria-label', 'Screen text annotation', 'labels');

        const content = document.createElement('span');
        content.className = 'video-drawing-text-content notranslate';
        content.textContent = annotation.text;
        element.appendChild(content);
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

        annotation.element = element;
        this.textAnnotations.set(annotation.annotationId, annotation);
        this.cameraDivEl.appendChild(element);
        if (this._canManageText(annotation)) {
            element.classList.add('video-drawing-text-manageable');
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'video-drawing-text-delete fas fa-times';
            this._setTranslatedAttribute(deleteButton, 'aria-label', 'Delete text annotation', 'buttons');
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
        const annotationScale = Math.max(0.5, Math.min(1, width / 640, height / 360));
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

        if (VideoDrawingOverlay.getProducerOwnerId?.(this.producerId) === VideoDrawingOverlay.getLocalDrawerId?.()) {
            VideoDrawingOverlay.onEmitDrawing?.({ type: 'text', action: 'clear', producerId: this.producerId });
        }
        this.textInput?.remove();
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
    }
}

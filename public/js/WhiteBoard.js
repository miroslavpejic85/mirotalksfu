/**
 * DrawXR - WhiteBoard component
 *
 * @link    http://drawxr.eu
 * @license For open source use: GPLv3
 *          For commercial use: DrawXR Commercial License
 * @author  Enzo Francesca - Holomask s.r.l.
 * @version 1.0.0
 *
 * See usage examples at http://drawxr.eu/examples/
 */

'use strict';

/**
 * global variables
 */
var imgDelete = null;
var imgClone = null;
var deleteIcon = "data:image/svg+xml,%3C%3Fxml version='1.0' encoding='utf-8'%3F%3E%3C!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN' 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'%3E%3Csvg version='1.1' id='Ebene_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' width='595.275px' height='595.275px' viewBox='200 215 230 470' xml:space='preserve'%3E%3Ccircle style='fill:%23F44336;' cx='299.76' cy='439.067' r='218.516'/%3E%3Cg%3E%3Crect x='267.162' y='307.978' transform='matrix(0.7071 -0.7071 0.7071 0.7071 -222.6202 340.6915)' style='fill:white;' width='65.545' height='262.18'/%3E%3Crect x='266.988' y='308.153' transform='matrix(0.7071 0.7071 -0.7071 0.7071 398.3889 -83.3116)' style='fill:white;' width='65.544' height='262.179'/%3E%3C/g%3E%3C/svg%3E";
var cloneIcon = "data:image/svg+xml,%3C%3Fxml version='1.0' encoding='iso-8859-1'%3F%3E%3Csvg version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' viewBox='0 0 55.699 55.699' width='100px' height='100px' xml:space='preserve'%3E%3Cpath style='fill:white;' d='M51.51,18.001c-0.006-0.085-0.022-0.167-0.05-0.248c-0.012-0.034-0.02-0.067-0.035-0.1 c-0.049-0.106-0.109-0.206-0.194-0.291v-0.001l0,0c0,0-0.001-0.001-0.001-0.002L34.161,0.293c-0.086-0.087-0.188-0.148-0.295-0.197 c-0.027-0.013-0.057-0.02-0.086-0.03c-0.086-0.029-0.174-0.048-0.265-0.053C33.494,0.011,33.475,0,33.453,0H22.177 c-3.678,0-6.669,2.992-6.669,6.67v1.674h-4.663c-3.678,0-6.67,2.992-6.67,6.67V49.03c0,3.678,2.992,6.669,6.67,6.669h22.677 c3.677,0,6.669-2.991,6.669-6.669v-1.675h4.664c3.678,0,6.669-2.991,6.669-6.669V18.069C51.524,18.045,51.512,18.025,51.51,18.001z M34.454,3.414l13.655,13.655h-8.985c-2.575,0-4.67-2.095-4.67-4.67V3.414z M38.191,49.029c0,2.574-2.095,4.669-4.669,4.669H10.845 c-2.575,0-4.67-2.095-4.67-4.669V15.014c0-2.575,2.095-4.67,4.67-4.67h5.663h4.614v10.399c0,3.678,2.991,6.669,6.668,6.669h10.4 v18.942L38.191,49.029L38.191,49.029z M36.777,25.412h-8.986c-2.574,0-4.668-2.094-4.668-4.669v-8.985L36.777,25.412z M44.855,45.355h-4.664V26.412c0-0.023-0.012-0.044-0.014-0.067c-0.006-0.085-0.021-0.167-0.049-0.249 c-0.012-0.033-0.021-0.066-0.036-0.1c-0.048-0.105-0.109-0.205-0.194-0.29l0,0l0,0c0-0.001-0.001-0.002-0.001-0.002L22.829,8.637 c-0.087-0.086-0.188-0.147-0.295-0.196c-0.029-0.013-0.058-0.021-0.088-0.031c-0.086-0.03-0.172-0.048-0.263-0.053 c-0.021-0.002-0.04-0.013-0.062-0.013h-4.614V6.67c0-2.575,2.095-4.67,4.669-4.67h10.277v10.4c0,3.678,2.992,6.67,6.67,6.67h10.399 v21.616C49.524,43.26,47.429,45.355,44.855,45.355z'/%3E%3C/svg%3E%0A";
/**
 * Graphical class to create a canvas with complete tool set
 */
class WhiteBoard {

    /**
     * constructor of WhiteBoard class
     * @param {*} wbImageInput type of input images
     * @param {*} wbWidth   width of initial canvas
     * @param {*} wbHeight height of initial canvas
     * @param {*} wbSocketFunction optional function to send data via socket
     * @param {*} wbTransmitModify optional function to send object mods via socket
     * @param {*} wbTransmitDelete optional function to send object deletions via socket
     */
    constructor(wbImageInput, wbWidth, wbHeight, wbSocketFunction = null, wbTransmitPointer = null, wbTransmitModify = null, wbTransmitDelete = null) {
        this.wbImageInput = wbImageInput;
        this.wbWidth = wbWidth;
        this.wbHeight = wbHeight;
        this.wbSocketFunction = wbSocketFunction;
        this.wbTransmitPointer = wbTransmitPointer;
        this.wbTransmitModify = wbTransmitModify;
        this.wbTransmitDelete = wbTransmitDelete;

        this.wbCanvas = null;
        this.wbIsDrawing = false;
        this.wbIsOpen = false;
        //this.wbIsRedoing = false;
        //this.wbPop = [];
        this.wbCurrentTool = "pointer";
        this.wbCurrentPoint = null;
        this.wbFillColor = "#FFFFFF33";
        this.setupWhiteboardCanvas();
        this.setupWhiteboardCanvasSize();
        this.setupWhiteboardLocalListners();


        // undo section
        this.wbCanvasState = [];
        this.wbCurrentStateIndex = -1;
        this.wbUndoStatus = false;
        this.wbRedoStatus = false;
        this.wbUndoFinishedStatus = 1;
        this.wbRedoFinishedStatus = 1;
        //this.undoButton = document.getElementById('whiteboardUndoBtn');
        //this.redoButton = document.getElementById('whiteboardRedoBtn');
        

        imgDelete = document.createElement('img');
        imgDelete.src = deleteIcon;
        imgClone = document.createElement('img');
        imgClone.src = cloneIcon;


        fabric.Object.prototype.transparentCorners = false;
        fabric.Object.prototype.cornerColor = 'blue';
        fabric.Object.prototype.cornerStyle = 'circle';

       /* fabric.Object.prototype.controls.deleteControl = new fabric.Control({
            x: 0.5,
            y: -0.5,
            offsetY: -16,
            offsetX: 16,
            cursorStyle: 'pointer',
            mouseUpHandler: this.deleteObject,
            render: this.renderIcon(imgDelete),
            cornerSize: 24
        });

        fabric.Object.prototype.controls.clone = new fabric.Control({
            x: -0.5,
            y: -0.5,
            offsetY: -16,
            offsetX: -16,
            cursorStyle: 'pointer',
            mouseUpHandler: this.cloneObject,
            render: this.renderIcon(imgClone),
            cornerSize: 24
        });*/

      


        this.sendRate = 5;
        this.rateCounter = this.sendRate;
        this.lastObj = null;
    }

    movePointer(px,py){
        if(this.pointerObject){
            this.pointerObject.set({
                left: px-10,
                top: py-10
            }).setCoords();
            
            this.wbCanvas.renderAll();
        }
    }

    revivePointer(){
        this.wbCanvas.remove(this.pointerObject);
        this.wbCanvas.add(this.pointerObject);
    }

    /**
     * Render an icon from vector to a ctx compatible object
     * @param {*} icon 
     * @returns the icon
     */
    renderIcon(icon) {
        return function renderIcon(ctx, left, top, styleOverride, fabricObject) {
            var size = this.cornerSize;
            ctx.save();
            ctx.translate(left, top);
            ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle));
            ctx.drawImage(icon, -size / 2, -size / 2, size, size);
            ctx.restore();
        }
    }

    /**
     * Delete the current selected object
     * @param {*} eventData 
     * @param {*} transform 
     */
    deleteObject(eventData, transform) {
        var target = transform.target;
        var canvas = target.canvas;       
        canvas.remove(target);
        canvas.requestRenderAll();
    }

    /**
     * Clone the current selected object and put the copy slightly offset
     * @param {*} eventData 
     * @param {*} transform 
     */
    cloneObject(eventData, transform) {
        var target = transform.target;
        var canvas = target.canvas;
        target.clone(function (cloned) {
            cloned.left += 10;
            cloned.top += 10;
            canvas.add(cloned);
        });
    }

    createPointerObject() {
        // make the pointer object
        this.pointerObject = new fabric.Ellipse({
            top: 30,
            left: 30,
            rx: 10,
            ry: 10,
            fill: "#FF0000",
            strokeWidth: this.wbCanvas.freeDrawingBrush.width,
            stroke: "#FFFFFF",
        });
        this.pointerObject.selectable = false;
        this.pointerObject.hasBorders = false;
        this.pointerObject.hasControls = false;
        this.wbCanvas.add(this.pointerObject);
    }

    /**
     * Setup the fabricjs object and set the default tool
     */
    setupWhiteboardCanvas() {
        this.wbCanvas = new fabric.Canvas('wbCanvas');
        this.wbCanvas.freeDrawingBrush.color = '#FF0000FF';
        this.wbCanvas.freeDrawingBrush.width = 5;
        this.createPointerObject();
        this.whiteboardSetDrawingMode("draw");

        var that = this;

        // undo helpers
        this.wbCanvas.on(
            'object:modified', function (evt) {
                console.log("object modified!");
                //console.log(evt.target.type);
                if(wbTransmitModify != null)
                {
                    // add the elementID
                    evt.elementID = that.wbCanvas.getActiveObject().elementID;
                    wbTransmitModify(evt);
                }
                that.updateCanvasState();
            }
        );

        this.wbCanvas.on(
            'object:added', function (evt) {
                console.log("object added!");
                console.log(evt);
                that.lastObj = evt.target;

              

                that.updateCanvasState();
            }
        );

        this.wbCanvas.on(
            'path:created', function (evt) {
                console.log("path created!");
                //that.lastObj = evt.target;
            }
        );



        // Zoom management
        this.wbCanvas.on('mouse:wheel', function (opt) {
            var delta = opt.e.deltaY;
            var zoom = that.wbCanvas.getZoom();
            zoom *= 0.999 ** delta;
            if (zoom > 20) zoom = 20;
            if (zoom < 0.01) zoom = 0.01;
            that.wbCanvas.setZoom(zoom);
            opt.e.preventDefault();
            opt.e.stopPropagation();
        })
        this.wbCanvas.on('mouse:down', function (opt) {
            var evt = opt.e;
            if (evt.altKey === true) {
                this.isDragging = true;
                //this.selection = false;
                this.lastPosX = evt.clientX;
                this.lastPosY = evt.clientY;
            }
        });
        this.wbCanvas.on('mouse:move', function (opt) {
            if (this.isDragging) {
                var e = opt.e;
                var vpt = this.viewportTransform;
                vpt[4] += e.clientX - this.lastPosX;
                vpt[5] += e.clientY - this.lastPosY;
                this.requestRenderAll();
                this.lastPosX = e.clientX;
                this.lastPosY = e.clientY;
            }
        });
        this.wbCanvas.on('mouse:up', function (opt) {
            // on mouse up we want to recalculate new interaction
            // for all objects, so we call setViewportTransform
            this.setViewportTransform(this.viewportTransform);
            this.isDragging = false;
            //this.selection = true;
        });
    }



    /**
     * setup the canvas size related to width , height and zoom factor
     */
    setupWhiteboardCanvasSize() {
        let optimalSize = [this.wbWidth, this.wbHeight];
        let scaleFactorX = window.innerWidth / optimalSize[0];
        let scaleFactorY = window.innerHeight / optimalSize[1];
        if (scaleFactorX < scaleFactorY && scaleFactorX < 1) {
            this.wbCanvas.setWidth(optimalSize[0] * scaleFactorX);
            this.wbCanvas.setHeight(optimalSize[1] * scaleFactorX);
            this.wbCanvas.setZoom(scaleFactorX);
            this.setWhiteboardSize(optimalSize[0] * scaleFactorX, optimalSize[1] * scaleFactorX);
        } else if (scaleFactorX > scaleFactorY && scaleFactorY < 1) {
            this.wbCanvas.setWidth(optimalSize[0] * scaleFactorY);
            this.wbCanvas.setHeight(optimalSize[1] * scaleFactorY);
            this.wbCanvas.setZoom(scaleFactorY);
            this.setWhiteboardSize(optimalSize[0] * scaleFactorY, optimalSize[1] * scaleFactorY);
        } else {
            this.wbCanvas.setWidth(optimalSize[0]);
            this.wbCanvas.setHeight(optimalSize[1]);
            this.wbCanvas.setZoom(1);
            this.setWhiteboardSize(optimalSize[0], optimalSize[1]);
        }
        this.wbCanvas.calcOffset();
        this.wbCanvas.renderAll();
    }

    setWhiteboardSize(w, h) {
        document.documentElement.style.setProperty('--wb-width', w);
        document.documentElement.style.setProperty('--wb-height', h);
    }

    setupWhiteboardLocalListners() {
        var that = this;
        this.wbCanvas.on('mouse:down', function (e) {
            that.mouseDown(e);
        });
        this.wbCanvas.on('mouse:up', function () {
            that.mouseUp();
        });
        this.wbCanvas.on('mouse:move', function (e) {
            that.mouseMove(e);
        });
        /* this.wbCanvas.on('object:added', function () {
            that.objectAdded();
        }); */
    }

    whiteboardToolBoxReset() {
        setColor(whiteboardPencilBtn, 'white');
        setColor(whiteboardObjectBtn, 'white');
        setColor(whiteboardEraserBtn, 'white');
        setColor(whiteboardLineBtn, 'white');
        setColor(whiteboardCircleBtn, 'white');
        setColor(whiteboardRectBtn, 'white');
        setColor(whiteboardPointerBtn, 'white');
    }

    /**
     * instruct the state machine on the current tool
     * @param {*} status the actual tool
     */
    whiteboardSetDrawingMode(status) {
        this.wbCanvas.isDrawingMode = false;
        this.wbCanvas.selection = true;
        this.wbCurrentTool = status;
        this.wbCanvas.discardActiveObject();
        this.whiteboardToolBoxReset();
        this.wbCanvas.remove(this.pointerObject);
        this.wbCanvas.add(this.pointerObject);
        this.movePointer(3000,3000);
        if (status == "draw") {
            this.wbCanvas.isDrawingMode = true;
            setColor(whiteboardPencilBtn, 'green');
        } else if (status == "line") {
            this.setWhiteBoardObjectsSelectable(false);
            this.wbCanvas.selection = false;
            setColor(whiteboardLineBtn, 'green');
        } else if (status == "pointer") {
            
            this.setWhiteBoardObjectsSelectable(false);
            this.wbCanvas.selection = false;
            setColor(whiteboardPointerBtn, 'green');
        } else if (status == "circle") {
            this.setWhiteBoardObjectsSelectable(false);
            this.wbCanvas.selection = false;
            setColor(whiteboardCircleBtn, 'green');
        } else if (status == "rect") {
            this.setWhiteBoardObjectsSelectable(false);
            this.wbCanvas.selection = false;
            setColor(whiteboardRectBtn, 'green');
        } else if (status == "eraser") {
            this.wbCanvas.selection = false;
            setColor(whiteboardEraserBtn, 'green');
        } else {
            this.setWhiteBoardObjectsSelectable(true);
            setColor(whiteboardObjectBtn, 'green');
        }
    }

    mouseDown(e) {
        if(this.wbCurrentTool == "pointer")
            return;

        if (this.wbCurrentTool == "line") {
            const pointer = this.wbCanvas.getPointer(e);
            var line = new fabric.Line([pointer.x, pointer.y, pointer.x + 1, pointer.y + 1], {
                fill: this.wbCanvas.freeDrawingBrush.color,
                strokeWidth: this.wbCanvas.freeDrawingBrush.width,
                stroke: this.wbCanvas.freeDrawingBrush.color,
                strokeLineCap: "round"
            });
            line.selectable = false;
            line.hasBorders = false;
            line.hasControls = false;
            //let myid='line'+ Math.round(Math.random() * 10000);
            //line.set({'elementID': myid});
            this.addWbCanvasObj(line);
            return;
        }
        if (this.wbCurrentTool == "circle") {
            this.wbCurrentPoint = this.wbCanvas.getPointer(e);
            var ellipse = new fabric.Ellipse({
                top: this.wbCurrentPoint.y,
                left: this.wbCurrentPoint.x,
                rx: 0,
                ry: 0,
                fill: this.wbFillColor,
                strokeWidth: this.wbCanvas.freeDrawingBrush.width,
                stroke: this.wbCanvas.freeDrawingBrush.color,
            });
            ellipse.selectable = false;
            ellipse.hasBorders = false;
            ellipse.hasControls = false;
            //let myid='ellipse'+ Math.round(Math.random() * 10000);
            //ellipse.set({'elementID': myid});
            this.addWbCanvasObj(ellipse);
            return;
        }
        if (this.wbCurrentTool == "rect") {
            this.wbCurrentPoint = this.wbCanvas.getPointer(e);
            var rect = new fabric.Rect({
                top: this.wbCurrentPoint.y,
                left: this.wbCurrentPoint.x,
                width: 1,
                height: 1,
                fill: this.wbFillColor,
                stroke: this.wbCanvas.freeDrawingBrush.color,
                strokeWidth: this.wbCanvas.freeDrawingBrush.width,
            });
            rect.selectable = false;
            rect.hasBorders = false;
            rect.hasControls = false;
            //let myid='rect'+ Math.round(Math.random() * 10000);
            //rect.set({'elementID': myid});
            this.addWbCanvasObj(rect);
            return;
        }

        this.wbIsDrawing = true;
        if (this.wbCurrentTool == "eraser" && e.target) {
            // send the delete command also via socket
            // to pair the other partecipants
            this.wbTransmitDelete(e.target.elementID);
            this.wbCanvas.remove(e.target);
            return;
        }
    }

    mouseUp() {
        //console.log(this.wbCurrentTool);
        if(this.wbCurrentTool == "none" || this.wbCurrentTool == "pointer")
            return;

        if (this.wbCurrentTool == "rect" || this.wbCurrentTool == "circle" || this.wbCurrentTool == "line")
        {
            var wbCurrentObject = this.wbCanvas.getActiveObject();
            wbCurrentObject.selectable = true;
            wbCurrentObject.hasBorders = true;
            wbCurrentObject.hasControls = true;
            this.wbCanvas.discardActiveObject();
        }
        this.wbIsDrawing = false;
        if (this.wbSocketFunction != null)
        {
            this.wbCanvas.remove(this.pointerObject);
            this.wbSocketFunction();
        }
            
    }

    mouseMove(e) {
        var wbCurrentObject = this.wbCanvas.getActiveObject();
        
        // in case of pointer tool we move the virtual
        // cursor by using mouse pointer values
        if (this.wbCurrentTool == "pointer"){
            
            // change the cursor to crosshair, but
            // we should hide it instead.. TODO
            this.wbCanvas.hoverCursor = 'crosshair';
            
            // read the cursor coordinates
            const pointer = this.wbCanvas.getPointer(e);
                
            // move the cursor pointer object
            this.movePointer(pointer.x,pointer.y)

            // finallyt, if the export function exists 
            // then send cursor data every sendRate times
            if (this.wbTransmitPointer != null && this.rateCounter == 0)
            {
                this.rateCounter = this.sendRate;
                this.wbTransmitPointer(pointer);
            }                   
            else{
                this.rateCounter--;
            }

            return;
        }
        
        if (this.wbCurrentTool == "line") {
            this.wbCanvas.hoverCursor = 'crosshair';
            if (wbCurrentObject) {
                const pointer = this.wbCanvas.getPointer(e);
                wbCurrentObject.set({
                    x2: pointer.x,
                    y2: pointer.y
                }).setCoords();
            }
            this.wbCanvas.renderAll();
            return;
        }
        if (this.wbCurrentTool == "circle") {
            this.wbCanvas.hoverCursor = 'crosshair';
            if (wbCurrentObject) {
                const pointer = this.wbCanvas.getPointer(e);
                if (this.wbCurrentPoint.x > pointer.x) {
                    wbCurrentObject.set({ left: Math.abs(pointer.x) });
                }
                if (this.wbCurrentPoint.y > pointer.y) {
                    wbCurrentObject.set({ top: Math.abs(pointer.y) });
                }
                wbCurrentObject.set({
                    rx: Math.abs(this.wbCurrentPoint.x - pointer.x) / 2
                });
                wbCurrentObject.set({
                    ry: Math.abs(this.wbCurrentPoint.y - pointer.y) / 2
                });
                wbCurrentObject.setCoords();
            }
            this.wbCanvas.renderAll();
            return;
        }
        if (this.wbCurrentTool == "rect") {
            this.wbCanvas.hoverCursor = 'crosshair';
            if (wbCurrentObject) {
                const pointer = this.wbCanvas.getPointer(e);
                if (this.wbCurrentPoint.x > pointer.x) {
                    wbCurrentObject.set({
                        left: Math.abs(pointer.x)
                    });
                }
                if (this.wbCurrentPoint.y > pointer.y) {
                    wbCurrentObject.set({
                        top: Math.abs(pointer.y)
                    });
                }
                wbCurrentObject.set({
                    width: Math.abs(this.wbCurrentPoint.x - pointer.x)
                });
                wbCurrentObject.set({
                    height: Math.abs(this.wbCurrentPoint.y - pointer.y)
                });
                wbCurrentObject.setCoords();
            }
            this.wbCanvas.renderAll();
            return;
        }
        if (this.wbCurrentTool == "eraser") {
            this.wbCanvas.hoverCursor = 'not-allowed';
            return;
        } else {
            this.wbCanvas.hoverCursor = 'move';
        }
    }

   /*  objectAdded() {
        if (!this.wbIsRedoing) this.wbPop = [];
        this.wbIsRedoing = false;
    } */

    setWhiteBoardObjectsSelectable(selectable) {
        this.wbCanvas._objects.forEach(element => {
            element.selectable = selectable;
        });
    }

    addWbCanvasObj(obj, transmit = false) {
        if (obj) {
            //this.lastObj = obj;
            this.wbCanvas.add(obj).setActiveObject(obj);;
            if (transmit && this.wbSocketFunction != null)
                this.wbSocketFunction();
        }
    }

    createText(myText) {
        this.whiteboardSetDrawingMode("none");
        const text = new fabric.Text(myText, {
            top: 100,
            left: 100,
            fontFamily: 'Comfortaa',
            fill: this.wbCanvas.freeDrawingBrush.color,
            strokeWidth: this.wbCanvas.freeDrawingBrush.width,
            stroke: this.wbCanvas.freeDrawingBrush.color,
        });
        //let myid='text'+ Math.round(Math.random() * 10000);
        //text.set({'elementID':myid});
        this.addWbCanvasObj(text, true);
    }

    createImage(imgObj) {
        let image = new fabric.Image(imgObj);
        //let myid='image'+ Math.round(Math.random() * 10000);  
        image.set({ top: 0, left: 0 }).scale(0.3);
        this.addWbCanvasObj(image, true);
    }

    createDecal(wbCanvasImgURL) {
        var that = this;
        fabric.Image.fromURL(wbCanvasImgURL, function (myImg) {
            myImg.set({ top: 50, left: 50 }).scale(0.5);
            that.addWbCanvasObj(myImg, true);
            that.wbCanvas.requestRenderAll();
        });
    }

    createImageFromURL(wbCanvasImgURL) {
        var that = this;
        fabric.Image.fromURL(wbCanvasImgURL, function (myImg) {
            let scale = Math.min(that.wbCanvas.width / myImg.width, that.wbCanvas.height / myImg.height);
            let shift = (that.wbCanvas.width - (myImg.width * scale)) / 2   
            myImg.set({ top: 0, left: shift }).scale(scale);
            that.addWbCanvasObj(myImg, true);
            that.wbCanvas.discardActiveObject();
            that.wbCanvas.requestRenderAll();
        });
    }

    /* wbCanvasUndo() {
        if (this.wbCanvas._objects.length > 0) {
            this.wbPop.push(this.wbCanvas._objects.pop());
            this.wbCanvas.renderAll();
        }
    }

    wbCanvasRedo() {
        if (this.wbPop.length > 0) {
            this.wbIsRedoing = true;
            this.wbCanvas.add(this.wbPop.pop());
        }
    } */


    updateCanvasState() {
        if ((this.wbUndoStatus == false && this.wbRedoStatus == false)) {
            var jsonData = this.wbCanvas.toJSON();
            var canvasAsJson = JSON.stringify(jsonData);
            if (this.wbCurrentStateIndex < this.wbCanvasState.length - 1) {
                var indexToBeInserted = this.wbCurrentStateIndex + 1;
                this.wbCanvasState[indexToBeInserted] = canvasAsJson;
                var numberOfElementsToRetain = indexToBeInserted + 1;
                this.wbCanvasState = this.wbCanvasState.splice(0, numberOfElementsToRetain);
            } else {
                this.wbCanvasState.push(canvasAsJson);
            }
            this.wbCurrentStateIndex = this.wbCanvasState.length - 1;
            if ((this.wbCurrentStateIndex == this.wbCanvasState.length - 1) && this.wbCurrentStateIndex != -1) {
                //this.redoButton.disabled = "disabled";
            }
        }
    }

    loadFromSingleJSON(data){

        console.log("loadfromsingleJSON"); 
        //console.log(data);
        if(data.includes("image"))
        {
            console.log("image case");
            var imageObject = JSON.parse(data);
            var that = this;
            fabric.Image.fromURL(imageObject.src, function(img) {
                img.set({ left: imageObject.left, top: imageObject.top, scaleX: imageObject.scaleX, scaleY: imageObject.scaleY, elementID: imageObject.elementID});
                that.wbCanvas.add(img);       
            });

            
        }
        else{
            console.log("the rest case");
            var canvasString = "{\"version\":\"5.2.4\",\"objects\":[";        
            canvasString += data;        
            canvasString += "]}";
            var tmpCanvas = new fabric.Canvas();
            tmpCanvas.loadFromJSON(canvasString);
            for(var k in tmpCanvas.getObjects()) {
                //console.log(tmpCanvas._objects[k]);
                this.wbCanvas.add(tmpCanvas._objects[k]);
            }    
        }
        
        this.wbCanvas.renderAll();

        // this is a better way, but it is not tested yet:
        /*var that = this;
        fabric.util.enlivenObjects([data], function(objects) {
            var origRenderOnAddRemove = that.wbCanvas.renderOnAddRemove;
            that.wbCanvas.renderOnAddRemove = false;
          
            objects.forEach(function(o) {
                that.wbCanvas.add(o);
            });
          
            that.wbCanvas.renderOnAddRemove = origRenderOnAddRemove;
            that.wbCanvas.renderAll();
          });
          */



    }

    undo() {
        if (this.wbUndoFinishedStatus) {
            if (this.wbCurrentStateIndex == -1) {
                this.wbUndoStatus = false;
            }
            else {
                if (this.wbCanvasState.length >= 1) {
                    this.wbUndoFinishedStatus = 0;
                    if (this.wbCurrentStateIndex != 0) {
                        this.wbUndoStatus = true;
                        var that = this;
                        this.wbCanvas.loadFromJSON(that.wbCanvasState[that.wbCurrentStateIndex - 1], function () {
                            var jsonData = JSON.parse(that.wbCanvasState[that.wbCurrentStateIndex - 1]);
                            that.wbCanvas.renderAll();
                            that.wbUndoStatus = false;
                            that.wbCurrentStateIndex -= 1;
                            //that.undoButton.removeAttribute("disabled");
                            if (that.wbCurrentStateIndex !== that.wbCanvasState.length - 1) {
                                //that.redoButton.removeAttribute('disabled');
                            }
                            that.wbUndoFinishedStatus = 1;
                        });
                    }
                    else if (this.wbCurrentStateIndex == 0) {
                        this.wbCanvas.clear();
                        this.wbUndoFinishedStatus = 1;
                        //this.undoButton.disabled = "disabled";
                        //this.redoButton.removeAttribute('disabled');
                        this.wbCurrentStateIndex -= 1;
                    }
                }
            }
        }
    }

    redo() {
        if (this.wbRedoFinishedStatus) {
            if ((this.wbCurrentStateIndex == this.wbCanvasState.length - 1) && this.wbCurrentStateIndex != -1) {
                //this.redoButton.disabled = "disabled";
            } else {
                if (this.wbCanvasState.length > this.wbCurrentStateIndex && this.wbCanvasState.length != 0) {
                    this.wbRedoFinishedStatus = 0;
                    this.wbRedoStatus = true;
                    var that = this;
                    this.wbCanvas.loadFromJSON(that.wbCanvasState[that.wbCurrentStateIndex + 1], function () {
                        var jsonData = JSON.parse(that.wbCanvasState[that.wbCurrentStateIndex + 1]);
                        that.wbCanvas.renderAll();
                        that.wbRedoStatus = false;
                        that.wbCurrentStateIndex += 1;
                        if (that.wbCurrentStateIndex != -1) {
                            //that.undoButton.removeAttribute('disabled');
                        }
                        that.wbRedoFinishedStatus = 1;
                        if ((that.wbCurrentStateIndex == that.wbCanvasState.length - 1) && that.wbCurrentStateIndex != -1) {
                            //that.redoButton.disabled = "disabled";
                        }
                    });
                }
            }
        }
    }
}
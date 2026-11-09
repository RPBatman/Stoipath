    OpenSeadragon.WebGLDrawer = class WebGLDrawer extends OpenSeadragon.DrawerBase{
        constructor(options){
           super(options);

            /**
             * The HTML element (canvas) that this drawer uses for drawing
             * @member {Element} canvas
             * @memberof OpenSeadragon.WebGLDrawer#
             */

            /**
             * The parent element of this Drawer instance, passed in when the Drawer was created.
             * The parent of {@link OpenSeadragon.WebGLDrawer#canvas}.
             * @member {Element} container
             * @memberof OpenSeadragon.WebGLDrawer#
             */

            // private members
            this._destroyed = false;
            /**
             * WebGL context manager instance
             * @member {WebglContextManager} _glContext
             * @memberof OpenSeadragon.WebGLDrawer#
             * @private
             */
            this._glContext = null;
            /**
             * Flag to enable/disable automatic WebGL context re-initialization on context loss.
             * When enabled, the drawer will attempt to recover from context exhaustion errors.
             * @member {Boolean} _enableContextRecovery
             * @memberof OpenSeadragon.WebGLDrawer#
             * @private
             */
            this._enableContextRecovery = true;
            this._outputCanvas = null;
            this._outputContext = null;
            this._clippingCanvas = null;
            this._clippingContext = null;
            this._renderingCanvas = null;
            this._backupCanvasDrawer = null;
            this._canvasFallbackAllowed = this.viewer.drawerCandidates && this.viewer.drawerCandidates.includes('canvas');

            this._imageSmoothingEnabled = true; // will be updated by setImageSmoothingEnabled
            this._unpackWithPremultipliedAlpha = !!this.options.unpackWithPremultipliedAlpha;

            // Reject listening for the tile-drawing and tile-drawn events, which this drawer does not fire
            this.viewer.rejectEventHandler("tile-drawn", "The WebGLDrawer does not raise the tile-drawn event");
            this.viewer.rejectEventHandler("tile-drawing", "The WebGLDrawer does not raise the tile-drawing event");

            // this.viewer and this.canvas are part of the public DrawerBase API
            // and are defined by the parent DrawerBase class. Additional setup is done by
            // the private _setupCanvases and _setupRenderer functions.
            this._setupCanvases();
            this._setupRenderer();

            this._supportedFormats = ["context2d", "image"];
            this.context = this._outputContext; // API required by tests
        }

        get defaultOptions() {
            return {
                // use detached cache: our type conversion will not collide (and does not have to preserve CPU data ref)
                usePrivateCache: true,
                preloadCache: false,
                unpackWithPremultipliedAlpha: false,
            };
        }

        getSupportedDataFormats() {
            return this._supportedFormats;
        }

        // Public API required by all Drawer implementations
        /**
        * Clean up the renderer, removing all resources
        */
        destroy(){
            if(this._destroyed){
                return;
            }
            super.destroy();
            // Remove the resize handler to prevent memory leaks
            if (this._resizeHandler) {
                this.viewer.removeHandler("resize", this._resizeHandler);
                this._resizeHandler = null;
            }

            // Destroy WebGL context manager
            if (this._glContext) {
                this._glContext.destroy();
                this._glContext = null;
            }

            // make canvases 1 x 1 px and delete references
            if (this._renderingCanvas) {
                this._renderingCanvas.width = this._renderingCanvas.height = 1;
            }
            if (this._clippingCanvas) {
                this._clippingCanvas.width = this._clippingCanvas.height = 1;
            }
            if (this._outputCanvas) {
                this._outputCanvas.width = this._outputCanvas.height = 1;
            }
            this._renderingCanvas = null;
            this._clippingCanvas = this._clippingContext = null;
            this._outputCanvas = this._outputContext = null;

            if(this._backupCanvasDrawer){
                this._backupCanvasDrawer.destroy();
                this._backupCanvasDrawer = null;
            }

            this.container.removeChild(this.canvas);
            if(this.viewer.drawer === this){
                this.viewer.drawer = null;
            }

            this.destroyInternalCache();

            // set our destroyed flag to true
            this._destroyed = true;
        }

        // Public API required by all Drawer implementations
        /**
        *
        * @returns {Boolean} true
        */
        canRotate(){
            return true;
        }

        // Public API required by all Drawer implementations
        /**
         * Functional test: true if WebGL is supported and the real first-pass shader pipeline
         * can render (same shaders/context path used at runtime). Uses a temp context and
         * WebglContextManager, draws known non-black pixels to an FBO, then readPixels.
         * @param {Object} options - Options for this drawer.
         * @returns {Boolean} true if WebGL is supported and the pipeline renders successfully
         */
        static isSupported(options){
            let contextManager = null;
            let testTexture = null;
            let gl = null;
            try {
                const size = 4;
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                if (!$.isFunction(canvas.getContext)) {
                    return false;
                }
                gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                if (!gl) {
                    return false;
                }
                contextManager = new WebglContextManager({
                    renderingCanvas: canvas,
                    unpackWithPremultipliedAlpha: false,
                    imageSmoothingEnabled: true,
                    initShaderProgram: WebGLDrawer.initShaderProgram
                });
                if (!contextManager.getContext()) {
                    return false;
                }
                contextManager.setupRenderer(size, size);

                const firstPass = contextManager.getFirstPass();
                const glFrameBuffer = contextManager.getFrameBuffer();
                if (!firstPass || !glFrameBuffer) {
                    return false;
                }

                const maxTextures = contextManager.getMaxTextures();
                if (!maxTextures || maxTextures <= 0) {
                    return false;
                }

                const imageData = new ImageData(size, size);
                imageData.data[0] = 255;
                imageData.data[1] = 0;
                imageData.data[2] = 0;
                imageData.data[3] = 255;
                testTexture = contextManager.createTexture(imageData);
                if (!testTexture) {
                    return false;
                }

                const unitQuad = contextManager.makeQuadVertexBuffer(0, 1, 0, 1);
                gl.viewport(0, 0, size, size);
                gl.bindFramebuffer(gl.FRAMEBUFFER, glFrameBuffer);
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.useProgram(firstPass.shaderProgram);

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, testTexture);
                gl.bindBuffer(gl.ARRAY_BUFFER, firstPass.bufferTexturePosition);
                gl.bufferData(gl.ARRAY_BUFFER, unitQuad, gl.DYNAMIC_DRAW);
                const ndcMatrix = new Float32Array([2, 0, 0, 0, 2, 0, -1, -1, 1]);
                gl.uniformMatrix3fv(firstPass.uTransformMatrices[0], false, ndcMatrix);
                gl.uniform1fv(firstPass.uOpacities, new Float32Array([1]));

                gl.bindBuffer(gl.ARRAY_BUFFER, firstPass.bufferOutputPosition);
                gl.vertexAttribPointer(firstPass.aOutputPosition, 2, gl.FLOAT, false, 0, 0);
                gl.bindBuffer(gl.ARRAY_BUFFER, firstPass.bufferTexturePosition);
                gl.vertexAttribPointer(firstPass.aTexturePosition, 2, gl.FLOAT, false, 0, 0);
                gl.bindBuffer(gl.ARRAY_BUFFER, firstPass.bufferIndex);
                gl.vertexAttribPointer(firstPass.aIndex, 1, gl.FLOAT, false, 0, 0);

                gl.drawArrays(gl.TRIANGLES, 0, 6);

                const pixels = new Uint8Array(size * size * 4);
                gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                const hasNonZero = pixels.some(v => v !== 0);
                if (!hasNonZero) {
                    $.console.warn('[WebGLDrawer.isSupported] Functional test failed: no non-zero pixels read back.');
                    return false;
                }
                return true;
            } catch (e) {
                $.console.warn('[WebGLDrawer.isSupported] Functional test failed:', e && e.message ? e.message : e);
                return false;
            } finally {
                try {
                    if (testTexture && contextManager) {
                        contextManager.deleteTexture(testTexture);
                    }
                    if (contextManager) {
                        contextManager.destroy();
                    } else if (gl) {
                        const ext = gl.getExtension('WEBGL_lose_context');
                        if (ext) {
                            ext.loseContext();
                        }
                    }
                } catch (cleanupErr) {
                    // ignore cleanup errors so we preserve the test result
                }
            }
        }

        /**
         *
         * @returns {string} 'webgl'
         */
        getType(){
            return 'webgl';
        }

        /**
         * Check if the drawer is using WebGL2
         * @returns {Boolean} true if WebGL2 is being used, false if WebGL1
         */
        isWebGL2(){
            return this._glContext ? this._glContext.isWebGL2() : false;
        }

        /**
         * Enable or disable automatic WebGL context re-initialization on context loss.
         * When enabled, the drawer will attempt to recover from context exhaustion errors
         * by re-initializing the WebGL context.
         * @param {Boolean} enabled - true to enable recovery, false to disable
         */
        setContextRecoveryEnabled(enabled) {
            this._enableContextRecovery = !!enabled;
        }

        /**
         * Check if context recovery is enabled
         * @returns {Boolean} true if recovery is enabled, false otherwise
         */
        isContextRecoveryEnabled() {
            return this._enableContextRecovery;
        }

        /**
         * @param {TiledImage} tiledImage the tiled image that is calling the function
         * @returns {Boolean} Whether this drawer requires enforcing minimum tile overlap to avoid showing seams.
         * @private
         */
        minimumOverlapRequired(tiledImage) {
            // return true if we cannot render with webgl, since the backup canvas drawer will be used.
            return tiledImage.hasIssue('webgl');
        }

        /**
        * create the HTML element (canvas in this case) that the image will be drawn into
        * @private
        * @returns {Element} the canvas to draw into
        */
        _createDrawingElement(){
            const canvas = $.makeNeutralElement("canvas");
            const viewportSize = this._calculateCanvasSize();
            canvas.width = viewportSize.x;
            canvas.height = viewportSize.y;
            return canvas;
        }

        /**
         * Get the backup renderer (CanvasDrawer) to use if data cannot be used by webgl
         * Lazy loaded
         * @private
         * @returns {CanvasDrawer}
         */
        _getBackupCanvasDrawer(){
            if(!this._backupCanvasDrawer){
                this._backupCanvasDrawer = this.viewer.requestDrawer('canvas', {mainDrawer: false});
                this._backupCanvasDrawer.canvas.style.setProperty('visibility', 'hidden');
                this._backupCanvasDrawer.getSupportedDataFormats = () => this._supportedFormats;
                this._backupCanvasDrawer.getDataToDraw = this.getDataToDraw.bind(this);
            }

            return this._backupCanvasDrawer;
        }

        //
        /**
         * Internal draw method, wrapped in a try/catch within draw()
         * @param {Array} tiledImages Array of TiledImage objects to draw
         * @param {Boolean} [isRetry=false] Internal flag to prevent infinite retry loops
         * @private
         */
        _draw(tiledImages, isRetry = false){
            const gl = this._glContext ? this._glContext.getContext() : null;
            if (!gl) {
                return;
            }
            const firstPass = this._glContext.getFirstPass();
            const secondPass = this._glContext.getSecondPass();
            const glFrameBuffer = this._glContext.getFrameBuffer();
            const renderToTexture = this._glContext.getRenderToTexture();
            const bounds = this.viewport.getBoundsNoRotateWithMargins(true);
            const view = {
                bounds: bounds,
                center: new OpenSeadragon.Point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
                rotation: this.viewport.getRotation(true) * Math.PI / 180
            };

            const flipMultiplier = this.viewport.flipped ? -1 : 1;
            // calculate view matrix for viewer
            const posMatrix = $.Mat3.makeTranslation(-view.center.x, -view.center.y);
            const scaleMatrix = $.Mat3.makeScaling(2 / view.bounds.width * flipMultiplier, -2 / view.bounds.height);
            const rotMatrix = $.Mat3.makeRotation(-view.rotation);
            const viewMatrix = scaleMatrix.multiply(rotMatrix).multiply(posMatrix);

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.clear(gl.COLOR_BUFFER_BIT); // clear the back buffer

            // clear the output canvas
            this._outputContext.clearRect(0, 0, this._outputCanvas.width, this._outputCanvas.height);


            let renderingBufferHasImageData = false;

            //iterate over tiled images and draw each one using a two-pass rendering pipeline if needed
            tiledImages.forEach( (tiledImage, tiledImageIndex) => {

            if(tiledImage.getIssue('webgl')){
                // first, draw any data left in the rendering buffer onto the output canvas
                if(renderingBufferHasImageData){
                    this._outputContext.drawImage(this._renderingCanvas, 0, 0);
                    // clear the buffer
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                    gl.clear(gl.COLOR_BUFFER_BIT); // clear the back buffer
                    renderingBufferHasImageData = false;
                }

                // next, use the backup canvas drawer to draw the tiled image (if allowed)
                if(this._canvasFallbackAllowed){
                    const canvasDrawer = this._getBackupCanvasDrawer();
                    canvasDrawer.draw([tiledImage]);
                    this._outputContext.drawImage(canvasDrawer.canvas, 0, 0);
                }

            } else {
                const tilesToDraw = tiledImage.getTilesToDraw();

                if ( tiledImage.placeholderFillStyle && tiledImage._hasOpaqueTile === false ) {
                    this._drawPlaceholder(tiledImage);
                }

                if(tilesToDraw.length === 0 || tiledImage.getOpacity() === 0){
                    return;
                }
                const firstTile = tilesToDraw[0];

                const useContext2dPipeline = ( tiledImage.compositeOperation ||
                    this.viewer.compositeOperation ||
                    tiledImage._clip ||
                    tiledImage._croppingPolygons ||
                    tiledImage.debugMode
                );

                const useTwoPassRendering = useContext2dPipeline || (tiledImage.opacity < 1) || firstTile.tile.hasTransparency;

                // using the context2d pipeline requires a clean rendering (back) buffer to start
                if(useContext2dPipeline){
                    // if the rendering buffer has image data currently, write it to the output canvas now and clear it

                    if(renderingBufferHasImageData){
                        this._outputContext.drawImage(this._renderingCanvas, 0, 0);
                    }

                    // clear the buffer
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                    gl.clear(gl.COLOR_BUFFER_BIT); // clear the back buffer
                }

                // First rendering pass: compose tiles that make up this tiledImage
                gl.useProgram(firstPass.shaderProgram);

                // bind to the framebuffer for render-to-texture if using two-pass rendering, otherwise back buffer (null)
                if(useTwoPassRendering){
                    gl.bindFramebuffer(gl.FRAMEBUFFER, glFrameBuffer);
                    // clear the buffer to draw a new image
                    gl.clear(gl.COLOR_BUFFER_BIT);
                } else {
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                    // no need to clear, just draw on top of the existing pixels
                }

                let overallMatrix = viewMatrix;

                const imageRotation = tiledImage.getRotation(true);
                // if needed, handle the tiledImage being rotated
                if( imageRotation % 360 !== 0){
                    const imageRotationMatrix = $.Mat3.makeRotation(-imageRotation * Math.PI / 180);
                    const imageCenter = tiledImage.getBoundsNoRotate(true).getCenter();
                    const t1 = $.Mat3.makeTranslation(imageCenter.x, imageCenter.y);
                    const t2 = $.Mat3.makeTranslation(-imageCenter.x, -imageCenter.y);

                    // update the view matrix to account for this image's rotation
                    const localMatrix = t1.multiply(imageRotationMatrix).multiply(t2);
                    overallMatrix = viewMatrix.multiply(localMatrix);
                }

                // Check MAX_TEXTURE_IMAGE_UNITS - throw error if invalid (will be caught by outer try-catch)
                const maxTextures = this._glContext.getMaxTextures();
                if(maxTextures <= 0 || maxTextures === null || maxTextures === undefined){
                    // This can apparently happen on some systems if too many WebGL contexts have been created
                    // in which case maxTextures can be null, leading to out of bounds errors with the array.
                    // For example, when viewers were created and not destroyed in the test suite, this error
                    // occurred in the TravisCI tests, though it did not happen when testing locally either in
                    // a browser or on the command line via grunt test.

                    throw new Error(`WebGL error: bad value for gl parameter MAX_TEXTURE_IMAGE_UNITS (${maxTextures}). This could happen
                    if too many contexts have been created and not released, or there is another problem with the graphics card.`);
                }

                const texturePositionArray = new Float32Array(maxTextures * 12); // 6 vertices (2 triangles) x 2 coordinates per vertex
                const textureDataArray = new Array(maxTextures);
                const matrixArray = new Array(maxTextures);
                const opacityArray = new Array(maxTextures);

                // iterate over tiles and add data for each one to the buffers
                for(let tileIndex = 0; tileIndex < tilesToDraw.length; tileIndex++){
                    const tile = tilesToDraw[tileIndex].tile;
                    const indexInDrawArray = tileIndex % maxTextures;
                    const numTilesToDraw =  indexInDrawArray + 1;
                    const textureInfo = this.getDataToDraw(tile);

                    if (textureInfo && textureInfo.texture) {
                        this._getTileData(tile, tiledImage, textureInfo, overallMatrix, indexInDrawArray, texturePositionArray, textureDataArray, matrixArray, opacityArray);
                    }
                    // else {
                    //   If the texture info is not available, we cannot draw this tile. This is either because
                    //   the tile data is still being processed, or the data was not correct - in that case,
                    //   internalCacheCreate(..) already logged an error.
                    // }

                    if( (numTilesToDraw === maxTextures) || (tileIndex === tilesToDraw.length - 1)){
                        // We've filled up the buffers: time to draw this set of tiles

                        // bind each tile's texture to the appropriate gl.TEXTURE#
                        for(let i = 0; i < numTilesToDraw; i++){
                            gl.activeTexture(gl.TEXTURE0 + i);
                            gl.bindTexture(gl.TEXTURE_2D, textureDataArray[i]);
                        }

                        // set the buffer data for the texture coordinates to use for each tile
                        gl.bindBuffer(gl.ARRAY_BUFFER, firstPass.bufferTexturePosition);
                        gl.bufferData(gl.ARRAY_BUFFER, texturePositionArray, gl.DYNAMIC_DRAW);

                        // set the transform matrix uniform for each tile
                        matrixArray.forEach( (matrix, index) => {
                            gl.uniformMatrix3fv(firstPass.uTransformMatrices[index], false, matrix);
                        });
                        // set the opacity uniform for each tile
                        gl.uniform1fv(firstPass.uOpacities, new Float32Array(opacityArray));

                        // bind vertex buffers and (re)set attributes before calling gl.drawArrays()
                        gl.bindBuffer(gl.ARRAY_BUFFER, firstPass.bufferOutputPosition);
                        gl.vertexAttribPointer(firstPass.aOutputPosition, 2, gl.FLOAT, false, 0, 0);

                        gl.bindBuffer(gl.ARRAY_BUFFER, firstPass.bufferTexturePosition);
                        gl.vertexAttribPointer(firstPass.aTexturePosition, 2, gl.FLOAT, false, 0, 0);

                        gl.bindBuffer(gl.ARRAY_BUFFER, firstPass.bufferIndex);
                        gl.vertexAttribPointer(firstPass.aIndex, 1, gl.FLOAT, false, 0, 0);

                        // Draw! 6 vertices per tile (2 triangles per rectangle)
                        gl.drawArrays(gl.TRIANGLES, 0, 6 * numTilesToDraw );
                    }
                }

                if(useTwoPassRendering){
                    // Second rendering pass: Render the tiled image from the framebuffer into the back buffer
                    gl.useProgram(secondPass.shaderProgram);

                    // set the rendering target to the back buffer (null)
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

                    // bind the rendered texture from the first pass to use during this second pass
                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, renderToTexture);

                    // set opacity to the value for the current tiledImage
                    gl.uniform1f(secondPass.uOpacityMultiplier, tiledImage.opacity);

                    // bind buffers and set attributes before calling gl.drawArrays
                    gl.bindBuffer(gl.ARRAY_BUFFER, secondPass.bufferTexturePosition);
                    gl.vertexAttribPointer(secondPass.aTexturePosition, 2, gl.FLOAT, false, 0, 0);
                    gl.bindBuffer(gl.ARRAY_BUFFER, secondPass.bufferOutputPosition);
                    gl.vertexAttribPointer(secondPass.aOutputPosition, 2, gl.FLOAT, false, 0, 0);

                    // Draw the quad (two triangles)
                    gl.drawArrays(gl.TRIANGLES, 0, 6);

                }

                renderingBufferHasImageData = true;

                if(useContext2dPipeline){
                    // draw from the rendering canvas onto the output canvas, clipping/cropping if needed.
                    this._applyContext2dPipeline(tiledImage, tilesToDraw, tiledImageIndex);
                    renderingBufferHasImageData = false;
                    // clear the buffer
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                    gl.clear(gl.COLOR_BUFFER_BIT); // clear the back buffer
                }

                // after drawing the first TiledImage, fire the tiled-image-drawn event (for testing)
                if(tiledImageIndex === 0){
                    this._raiseTiledImageDrawnEvent(tiledImage, tilesToDraw.map(info=>info.tile));
                }
            }

            });

            if(renderingBufferHasImageData){
                this._outputContext.drawImage(this._renderingCanvas, 0, 0);
            }
        }
        /**
        *
        * @param {Array} tiledImages Array of TiledImage objects to draw
        * @param {Boolean} [isRetry=false] Internal flag to prevent infinite retry loops
        */
        draw(tiledImages, isRetry = false){
            try {
                this._draw(tiledImages, isRetry);
            } catch (error) {
                // Handle WebGL context errors that occur at any point during the draw operation
                if (this._isWebGLContextError(error)) {
                    // Try recovery if enabled and not a retry
                    if (this._enableContextRecovery && !isRetry) {
                        $.console.warn('WebGL context error detected during draw operation, attempting to recreate context...', error);
                        const recreatedDrawer = this._recreateContext();
                        if (recreatedDrawer) {
                            $.console.info('WebGL context recreated successfully, retrying draw operation');
                            // Raise event for successful recovery
                            if (this.viewer) {
                                /**
                                 * Raised when the WebGL drawer successfully recovers from a context loss.
                                 *
                                 * @event webgl-context-recovered
                                 * @memberof OpenSeadragon.Viewer
                                 * @type {object}
                                 * @property {OpenSeadragon.Viewer} eventSource - A reference to the Viewer which raised the event.
                                 * @property {OpenSeadragon.WebGLDrawer} drawer - The drawer instance (same instance, context recreated).
                                 * @property {Error} error - The original error that triggered the recovery.
                                 * @property {?Object} userData - Arbitrary subscriber-defined object.
                                 */
                                this.viewer.raiseEvent('webgl-context-recovered', {
                                    drawer: this,
                                    error: error
                                });
                            }
                            // Retry draw on same instance
                            this.draw(tiledImages, true);
                        } else {
                            // Recovery attempted but failed - fall back to canvas drawer (if allowed)
                            this._fallbackToCanvasDrawer(error, tiledImages);
                        }
                    } else {
                        // Recovery disabled or retry - fall back only when recovery was enabled (retry case)
                        if (this._enableContextRecovery) {
                            this._fallbackToCanvasDrawer(error, tiledImages); // will only happen if canvas fallback is allowed
                        } else {
                            throw error;
                        }
                    }
                } else {
                    // Not a WebGL context error - re-throw
                    throw error;
                }
            }
        }

        // Public API required by all Drawer implementations
        /**
        * Sets whether image smoothing is enabled or disabled
        * @param {Boolean} enabled If true, uses gl.LINEAR as the TEXTURE_MIN_FILTER and TEXTURE_MAX_FILTER, otherwise gl.NEAREST.
        */
        setImageSmoothingEnabled(enabled){
            if( this._imageSmoothingEnabled !== enabled ){
                this._imageSmoothingEnabled = enabled;
                if (this._glContext) {
                    this._glContext.setImageSmoothingEnabled(enabled);
                }
                this.setInternalCacheNeedsRefresh();
                this.viewer.forceRedraw();
            }
        }

        /**
        * Sets whether textures are unpacked with premultiplied alpha
        * @param {Boolean} enabled If true, sets gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL to true.
        */
        setUnpackWithPremultipliedAlpha(enabled){
            if (this._unpackWithPremultipliedAlpha !== enabled){
                this._unpackWithPremultipliedAlpha = enabled;
                if (this._glContext) {
                    this._glContext.setUnpackWithPremultipliedAlpha(enabled);
                }
                this.setInternalCacheNeedsRefresh();
                this.viewer.forceRedraw();
            }
        }

        /**
        * Draw a rect onto the output canvas for debugging purposes
        * @param {OpenSeadragon.Rect} rect
        */
        drawDebuggingRect(rect){
            const context = this._outputContext;
            context.save();
            context.lineWidth = 2 * $.pixelDensityRatio;
            context.strokeStyle = this.debugGridColor[0];
            context.fillStyle = this.debugGridColor[0];

            context.strokeRect(
                rect.x * $.pixelDensityRatio,
                rect.y * $.pixelDensityRatio,
                rect.width * $.pixelDensityRatio,
                rect.height * $.pixelDensityRatio
            );

            context.restore();
        }

        /**
        * Draw data from the rendering canvas onto the output canvas, with clipping,
        * cropping and/or debug info as requested.
        * @private
        * @param {OpenSeadragon.TiledImage} tiledImage - the tiledImage to draw
        * @param {Array} tilesToDraw - array of objects containing tiles that were drawn
        */
        _applyContext2dPipeline(tiledImage, tilesToDraw, tiledImageIndex){
            // composite onto the output canvas, clipping if necessary
            this._outputContext.save();

            // set composite operation; ignore for first image drawn
            this._outputContext.globalCompositeOperation = tiledImageIndex === 0 ? null : tiledImage.compositeOperation || this.viewer.compositeOperation;
            if(tiledImage._croppingPolygons || tiledImage._clip){
                this._renderToClippingCanvas(tiledImage);
                this._outputContext.drawImage(this._clippingCanvas, 0, 0);

            } else {
                this._outputContext.drawImage(this._renderingCanvas, 0, 0);
            }
            this._outputContext.restore();
            if(tiledImage.debugMode){
                const flipped = this.viewer.viewport.getFlip();
                if(flipped){
                    this._flip();
                }
                this._drawDebugInfo(tilesToDraw, tiledImage, flipped);
                if(flipped){
                    this._flip();
                }
            }


        }

        // private
        _getTileData(tile, tiledImage, textureInfo, viewMatrix, index, texturePositionArray, textureDataArray, matrixArray, opacityArray){

            const texture = textureInfo.texture;
            const textureQuad = textureInfo.position;
            const overlapFraction = textureInfo.overlapFraction;

            // set the position of this texture
            texturePositionArray.set(textureQuad, index * 12);

            // compute offsets that account for tile overlap; needed for calculating the transform matrix appropriately
            const xOffset = tile.positionedBounds.width * overlapFraction.x;
            const yOffset = tile.positionedBounds.height * overlapFraction.y;
            const x = tile.positionedBounds.x + (tile.x === 0 ? 0 : xOffset);
            const y = tile.positionedBounds.y + (tile.y === 0 ? 0 : yOffset);
            const right = tile.positionedBounds.x + tile.positionedBounds.width - (tile.isRightMost ? 0 : xOffset);
            const bottom = tile.positionedBounds.y + tile.positionedBounds.height - (tile.isBottomMost ? 0 : yOffset);

            const model = new $.Mat3([
                right - x, 0, 0, // right - x = width
                0, bottom - y, 0, // bottom - y = height
                x, y, 1
            ]);

            if (tile.flipped) {
                // For documentation:
                // // flip the tile around the center of the unit quad
                // let t1 = $.Mat3.makeTranslation(0.5, 0);
                // let t2 = $.Mat3.makeTranslation(-0.5, 0);
                //
                // // update the view matrix to account for this image's rotation
                // let localMatrix = t1.multiply($.Mat3.makeScaling(-1, 1)).multiply(t2);
                // matrix = matrix.multiply(localMatrix);

                //Optimized: this works since matrix only contains main diagonal values & translation
                model.scaleAndTranslateSelf(-1, 1, 1, 0);
            }

            model.scaleAndTranslateOtherSetSelf(viewMatrix);
            opacityArray[index] = tile.opacity;
            textureDataArray[index] = texture;
            matrixArray[index] = model.values;
        }


        // private
        _setupRenderer(){
            if(!this._glContext || !this._glContext.getContext()){
                $.console.error('_setupCanvases must be called before _setupRenderer');
                return;
            }
            this._glContext.setupRenderer(this._renderingCanvas.width, this._renderingCanvas.height);
        }


        // private
        _resizeRenderer(){
            if(!this._glContext){
                return;
            }
            this._glContext.resizeRenderer(this._renderingCanvas.width, this._renderingCanvas.height);
        }

        // private
        _setupCanvases(){
            const _this = this;

            this._outputCanvas = this.canvas; //output canvas
            this._outputContext = this._outputCanvas.getContext('2d');

            this._renderingCanvas = document.createElement('canvas');

            this._clippingCanvas = document.createElement('canvas');
            this._clippingContext = this._clippingCanvas.getContext('2d');
            this._renderingCanvas.width = this._clippingCanvas.width = this._outputCanvas.width;
            this._renderingCanvas.height = this._clippingCanvas.height = this._outputCanvas.height;

            // Create WebGL context manager
            this._glContext = new WebglContextManager({
                renderingCanvas: this._renderingCanvas,
                unpackWithPremultipliedAlpha: this._unpackWithPremultipliedAlpha,
                imageSmoothingEnabled: this._imageSmoothingEnabled,
                initShaderProgram: this.constructor.initShaderProgram
            });

            this._resizeHandler = function(){

                if(_this._outputCanvas !== _this.viewer.drawer.canvas){
                    _this._outputCanvas.style.width = _this.viewer.drawer.canvas.clientWidth + 'px';
                    _this._outputCanvas.style.height = _this.viewer.drawer.canvas.clientHeight + 'px';
                }

                const viewportSize = _this._calculateCanvasSize();
                if( _this._outputCanvas.width !== viewportSize.x ||
                    _this._outputCanvas.height !== viewportSize.y ) {
                    _this._outputCanvas.width = viewportSize.x;
                    _this._outputCanvas.height = viewportSize.y;
                }

                _this._renderingCanvas.style.width = _this._outputCanvas.clientWidth + 'px';
                _this._renderingCanvas.style.height = _this._outputCanvas.clientHeight + 'px';
                _this._renderingCanvas.width = _this._clippingCanvas.width = _this._outputCanvas.width;
                _this._renderingCanvas.height = _this._clippingCanvas.height = _this._outputCanvas.height;

                // important - update the size of the rendering viewport!
                _this._resizeRenderer();
            };

            //make the additional canvas elements mirror size changes to the output canvas
            this.viewer.addHandler("resize", this._resizeHandler);
        }


        /**
         * Check if an error is related to WebGL context issues.
         * @param {Error} error - The error to check
         * @returns {Boolean} true if the error is a WebGL context error, false otherwise
         * @private
         */
        _isWebGLContextError(error) {
            if (!error || !error.message) {
                return false;
            }
            const message = error.message.toLowerCase();
            return message.includes('max_texture_image_units') ||
                   (message.includes('webgl') && ((message.includes('context') || message.includes('lost') || message.includes('invalid'))));
        }

        /**
         * Recreate the WebGL context when it has been lost or exhausted.
         * This method recreates only the WebglContextManager, preserving the drawer instance
         * and all drawer state (canvases, options, cache, etc.).
         * @returns {OpenSeadragon.WebGLDrawer|null} The same drawer instance if successful, null otherwise
         * @private
         */
        _recreateContext() {
            if (this._destroyed) {
                return null;
            }

            try {
                // Store old canvas properties
                const oldCanvas = this._renderingCanvas;
                const oldWidth = oldCanvas.width;
                const oldHeight = oldCanvas.height;
                const oldStyleWidth = oldCanvas.style.width;
                const oldStyleHeight = oldCanvas.style.height;

                // Destroy internal cache FIRST (while old context still exists)
                // This ensures textures are freed using the old context before it's destroyed
                this.destroyInternalCache();

                // Destroy old context manager
                if (this._glContext) {
                    this._glContext.destroy();
                    this._glContext = null;
                }

                // Note: destroyInternalCache() above already properly cleaned up all texture
                // and glContext references via internalCacheFree() callbacks

                // Create new rendering canvas element
                this._renderingCanvas = document.createElement('canvas');
                this._renderingCanvas.width = oldWidth;
                this._renderingCanvas.height = oldHeight;
                if (oldStyleWidth) {
                    this._renderingCanvas.style.width = oldStyleWidth;
                }
                if (oldStyleHeight) {
                    this._renderingCanvas.style.height = oldStyleHeight;
                }

                // Create new context manager with new canvas
                this._glContext = new WebglContextManager({
                    renderingCanvas: this._renderingCanvas,
                    unpackWithPremultipliedAlpha: this._unpackWithPremultipliedAlpha,
                    imageSmoothingEnabled: this._imageSmoothingEnabled,
                    initShaderProgram: this.constructor.initShaderProgram
                });

                // Verify context is valid
                if (!this._glContext.getContext()) {
                    $.console.error('Failed to recreate WebGL context: no GL context');
                    return null;
                }

                // Check if the new context has valid MAX_TEXTURE_IMAGE_UNITS
                try {
                    const maxTextures = this._glContext.getMaxTextures();
                    if (!maxTextures || maxTextures <= 0) {
                        $.console.error('Failed to recreate WebGL context: invalid MAX_TEXTURE_IMAGE_UNITS');
                        return null;
                    }
                } catch (e) {
                    $.console.error('Failed to verify new WebGL context:', e);
                    return null;
                }

                // Reinitialize renderer (shaders, framebuffers)
                this._setupRenderer();

                // Mark cache as needing refresh for future entries
                // (Old entries were already freed above)
                this.setInternalCacheNeedsRefresh();

                return this; // Return same drawer instance
            } catch (e) {
                $.console.error('Failed to recreate WebGL context:', e);
                return null;
            }
        }

        /**
         * Fall back to canvas drawer when WebGL fails (requires viewer.drawerCandidates to include 'canvas').
         * If allowed, switches the viewer to use the canvas drawer, raises the webgl-context-recovery-failed event
         * with the canvas drawer, and draws the current frame.
         * Otherwise, raise the event with canvasDrawer: null and rethrow the error.
         *
         * @param {Error} error - The error that triggered the fallback
         * @param {Array} tiledImages - Array of TiledImage objects to draw with the new drawer
         * @throws {Error} Re-throws the error if canvas is not an allowed fallback or if canvas drawer creation fails
         * @private
         */
        _fallbackToCanvasDrawer(error, tiledImages) {
            const oldWebGLDrawer = this;
            if (!this._canvasFallbackAllowed) {
                oldWebGLDrawer._raiseContextRecoveryFailedEvent(error, null);
                throw error;
            }
            const canvasDrawer = this.viewer.requestDrawer('canvas', {
                mainDrawer: true,
                redrawImmediately: false
            });

            if (canvasDrawer) {
                $.console.error('Failed to recreate WebGL context, switching to canvas drawer');
                oldWebGLDrawer._raiseContextRecoveryFailedEvent(error, canvasDrawer);
                this.viewer.world.requestInvalidate(true);
            } else {
                $.console.error('Failed to create canvas drawer as fallback');
                oldWebGLDrawer._raiseContextRecoveryFailedEvent(error, null);
                throw error;
            }
        }

        /**
         * Raise the webgl-context-recovery-failed event.
         * @param {Error} error - The error that triggered the recovery failure
         * @param {OpenSeadragon.CanvasDrawer} [canvasDrawer=null] - The canvas drawer that was created as a fallback, or null if canvas was not an allowed fallback or creation failed
         * @private
         */
        _raiseContextRecoveryFailedEvent(error, canvasDrawer = null) {
            if (!this.viewer) {
                return;
            }
            /**
             * Raised when the WebGL drawer fails to recover from a context loss. The drawer may fall back to
             * canvas drawer only when canvas is in the viewer's drawer list; otherwise canvasDrawer is null and no switch occurs.
             *
             * @event webgl-context-recovery-failed
             * @memberof OpenSeadragon.Viewer
             * @type {object}
             * @property {OpenSeadragon.Viewer} eventSource - A reference to the Viewer which raised the event.
             * @property {OpenSeadragon.WebGLDrawer} drawer - The WebGL drawer instance that failed to recover (may be destroyed).
             * @property {OpenSeadragon.CanvasDrawer} canvasDrawer - The canvas drawer that was created as a fallback, or null if canvas was not an allowed fallback or creation failed.
             * @property {Error} error - The original error that triggered the recovery attempt.
             * @property {?Object} userData - Arbitrary subscriber-defined object.
             */
            this.viewer.raiseEvent('webgl-context-recovery-failed', {
                drawer: this,
                canvasDrawer: canvasDrawer,
                error: error
            });
        }

        internalCacheCreate(cache, tile) {
            const tiledImage = tile.tiledImage;
            const gl = this._glContext ? this._glContext.getContext() : null;
            if (!gl) {
                $.console.error('WebGL context not available in internalCacheCreate');
                return {};
            }
            let texture;
            let position;

            let data = cache.data;
            let isCanvas = false;
            if (data instanceof CanvasRenderingContext2D || data instanceof OffscreenCanvasRenderingContext2D) {
                data = data.canvas;
                isCanvas = true;
            }

            if (!tiledImage.getIssue('webgl')) {
                if (isCanvas && $.isCanvasTainted(data)){
                    tiledImage.setIssue('webgl', 'WebGL cannot be used to draw this TiledImage because it has tainted data. Does crossOriginPolicy need to be set?');
                    this._raiseDrawerErrorEvent(tiledImage, this._canvasFallbackAllowed ?
                        'Tainted data cannot be used by the WebGLDrawer. Falling back to CanvasDrawer for this TiledImage.' :
                        'Tainted data cannot be used by the WebGLDrawer, and canvas fallback is not enabled.');
                    this.setInternalCacheNeedsRefresh();
                } else {
                    let sourceWidthFraction, sourceHeightFraction;
                    if (tile.sourceBounds) {
                        sourceWidthFraction = Math.min(tile.sourceBounds.width, data.width) / data.width;
                        sourceHeightFraction = Math.min(tile.sourceBounds.height, data.height) / data.height;
                    } else {
                        sourceWidthFraction = 1;
                        sourceHeightFraction = 1;
                    }

                    const overlap = tiledImage.source.tileOverlap;
                    const overlapFraction = this._calculateOverlapFraction(tile, tiledImage);
                    if( overlap > 0){
                        // calculate the normalized position of the rect to actually draw
                        // discarding overlap.
                        const left = (tile.x === 0 ? 0 : overlapFraction.x) * sourceWidthFraction;
                        const top = (tile.y === 0 ? 0 : overlapFraction.y) * sourceHeightFraction;
                        const right = (tile.isRightMost ? 1 : 1 - overlapFraction.x) * sourceWidthFraction;
                        const bottom = (tile.isBottomMost ? 1 : 1 - overlapFraction.y) * sourceHeightFraction;
                        position = this._glContext.makeQuadVertexBuffer(left, right, top, bottom);
                    } else if (sourceWidthFraction === 1 && sourceHeightFraction === 1) {
                        // no overlap and no padding: this texture can use the unit quad as its position data
                        position = this._glContext.getUnitQuad();
                    } else {
                        position = this._glContext.makeQuadVertexBuffer(0, sourceWidthFraction, 0, sourceHeightFraction);
                    }

                    // create a gl Texture for this tile using the manager
                    texture = this._glContext.createTexture(data, {
                        unpackWithPremultipliedAlpha: this._unpackWithPremultipliedAlpha
                    });

                    if (!texture) {
                        tiledImage.setIssue('webgl', 'Error creating texture in WebGL.');
                        const canvasAllowed = this._canvasFallbackAllowed;
                        this._raiseDrawerErrorEvent(tiledImage, canvasAllowed ?
                            'Unknown error when creating texture. Falling back to CanvasDrawer for this TiledImage.' :
                            'Cannot use WebGL for this TiledImage; canvas fallback is not enabled.');
                        this.setInternalCacheNeedsRefresh();
                    } else {
                        // TextureInfo stored in the cache
                        // Store reference to the context that created this texture
                        return {
                            texture: texture,
                            position: position,
                            overlapFraction: overlapFraction,
                            glContext: this._glContext  // Store context reference for safe deletion
                        };
                    }
                }
            }
            if (data instanceof Image) {
                const canvas = document.createElement( 'canvas' );
                canvas.width = data.width;
                canvas.height = data.height;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                context.drawImage( data, 0, 0 );
                data = context;
            }
            if (data instanceof CanvasRenderingContext2D || data instanceof OffscreenCanvasRenderingContext2D ) {
                return data;
            }
            $.console.error("Unsupported data used for WebGL Drawer - probably a bug!");
            return {};
        }

        internalCacheFree(data) {
            if (data && data.texture) {
                // Use the stored context reference if available, otherwise fall back to current context
                const glContext = data.glContext || this._glContext;

                if (glContext && !glContext.isDestroyed()) {
                    try {
                        glContext.deleteTexture(data.texture);
                    } catch (e) {
                        // Context may have been destroyed between check and deletion - safe to ignore
                    }
                }

                // Always nullify references
                data.texture = null;
                data.glContext = null;
            }
        }


        // private
        _calculateOverlapFraction(tile, tiledImage){
            const overlap = tiledImage.source.tileOverlap;
            const nativeWidth = tile.sourceBounds.width; // in pixels
            const nativeHeight = tile.sourceBounds.height; // in pixels
            const overlapWidth  = (tile.x === 0 ? 0 : overlap) + (tile.isRightMost ? 0 : overlap); // in pixels
            const overlapHeight = (tile.y === 0 ? 0 : overlap) + (tile.isBottomMost ? 0 : overlap); // in pixels
            const widthOverlapFraction = overlap / (nativeWidth + overlapWidth); // as a fraction of image including overlap
            const heightOverlapFraction = overlap / (nativeHeight + overlapHeight); // as a fraction of image including overlap
            return {
                x: widthOverlapFraction,
                y: heightOverlapFraction
            };
        }

        _setClip(){
            // no-op: called by _renderToClippingCanvas when tiledImage._clip is truthy
            // so that tests will pass.
        }

        // private
        _renderToClippingCanvas(item){

            this._clippingContext.clearRect(0, 0, this._clippingCanvas.width, this._clippingCanvas.height);
            this._clippingContext.save();
            if(this.viewer.viewport.getFlip()){
                const point = new $.Point(this.canvas.width / 2, this.canvas.height / 2);
                this._clippingContext.translate(point.x, 0);
                this._clippingContext.scale(-1, 1);
                this._clippingContext.translate(-point.x, 0);
            }

            if(item._clip){
                const polygon = [
                    {x: item._clip.x, y: item._clip.y},
                    {x: item._clip.x + item._clip.width, y: item._clip.y},
                    {x: item._clip.x + item._clip.width, y: item._clip.y + item._clip.height},
                    {x: item._clip.x, y: item._clip.y + item._clip.height},
                ];
                const clipPoints = polygon.map(coord => {
                    const point = item.imageToViewportCoordinates(coord.x, coord.y, true)
                        .rotate(this.viewer.viewport.getRotation(true), this.viewer.viewport.getCenter(true));
                    const clipPoint = this.viewportCoordToDrawerCoord(point);
                    return clipPoint;
                });
                this._clippingContext.beginPath();
                clipPoints.forEach( (coord, i) => {
                    this._clippingContext[i === 0 ? 'moveTo' : 'lineTo'](coord.x, coord.y);
                });
                this._clippingContext.clip();
                this._setClip();
            }
            if(item._croppingPolygons){
                const polygons = item._croppingPolygons.map(polygon => {
                    return polygon.map(coord => {
                        const point = item.imageToViewportCoordinates(coord.x, coord.y, true)
                            .rotate(this.viewer.viewport.getRotation(true), this.viewer.viewport.getCenter(true));
                        const clipPoint = this.viewportCoordToDrawerCoord(point);
                        return clipPoint;
                    });
                });
                this._clippingContext.beginPath();
                polygons.forEach((polygon) => {
                    polygon.forEach( (coord, i) => {
                        this._clippingContext[i === 0 ? 'moveTo' : 'lineTo'](coord.x, coord.y);
                    });
                });
                this._clippingContext.clip();
            }

            if(this.viewer.viewport.getFlip()){
                const point = new $.Point(this.canvas.width / 2, this.canvas.height / 2);
                this._clippingContext.translate(point.x, 0);
                this._clippingContext.scale(-1, 1);
                this._clippingContext.translate(-point.x, 0);
            }

            this._clippingContext.drawImage(this._renderingCanvas, 0, 0);

            this._clippingContext.restore();
        }

        /**
         * Set rotations for viewport & tiledImage
         * @private
         * @param {OpenSeadragon.TiledImage} tiledImage
         */
        _setRotations(tiledImage) {
            let saveContext = false;
            if (this.viewport.getRotation(true) % 360 !== 0) {
                this._offsetForRotation({
                    degrees: this.viewport.getRotation(true),
                    saveContext: saveContext
                });
                saveContext = false;
            }
            if (tiledImage.getRotation(true) % 360 !== 0) {
                this._offsetForRotation({
                    degrees: tiledImage.getRotation(true),
                    point: this.viewport.pixelFromPointNoRotate(
                        tiledImage._getRotationPoint(true), true),
                    saveContext: saveContext
                });
            }
        }

        // private
        _offsetForRotation(options) {
            const point = options.point ?
                options.point.times($.pixelDensityRatio) :
                this._getCanvasCenter();

            const context = this._outputContext;
            context.save();

            context.translate(point.x, point.y);
            context.rotate(Math.PI / 180 * options.degrees);
            context.translate(-point.x, -point.y);
        }

        // private
        _flip(options) {
            options = options || {};
            const point = options.point ?
            options.point.times($.pixelDensityRatio) :
            this._getCanvasCenter();
            const context = this._outputContext;

            context.translate(point.x, 0);
            context.scale(-1, 1);
            context.translate(-point.x, 0);
        }

        // private
        _drawDebugInfo( tilesToDraw, tiledImage, flipped ) {

            for ( let i = tilesToDraw.length - 1; i >= 0; i-- ) {
                const tile = tilesToDraw[ i ].tile;
                try {
                    this._drawDebugInfoOnTile(tile, tilesToDraw.length, i, tiledImage, flipped);
                } catch(e) {
                    $.console.error(e);
                }
            }
        }

        // private
        _drawDebugInfoOnTile(tile, count, i, tiledImage, flipped) {

            const colorIndex = this.viewer.world.getIndexOfItem(tiledImage) % this.debugGridColor.length;
            const context = this.context;
            context.save();
            context.lineWidth = 2 * $.pixelDensityRatio;
            context.font = 'small-caps bold ' + (13 * $.pixelDensityRatio) + 'px arial';
            context.strokeStyle = this.debugGridColor[colorIndex];
            context.fillStyle = this.debugGridColor[colorIndex];

            this._setRotations(tiledImage);

            if(flipped){
                this._flip({point: tile.position.plus(tile.size.divide(2))});
            }

            context.strokeRect(
                tile.position.x * $.pixelDensityRatio,
                tile.position.y * $.pixelDensityRatio,
                tile.size.x * $.pixelDensityRatio,
                tile.size.y * $.pixelDensityRatio
            );

            const tileCenterX = (tile.position.x + (tile.size.x / 2)) * $.pixelDensityRatio;
            const tileCenterY = (tile.position.y + (tile.size.y / 2)) * $.pixelDensityRatio;

            // Rotate the text the right way around.
            context.translate( tileCenterX, tileCenterY );
            const angleInDegrees = this.viewport.getRotation(true);
            context.rotate( Math.PI / 180 * -angleInDegrees );
            context.translate( -tileCenterX, -tileCenterY );

            if( tile.x === 0 && tile.y === 0 ){
                context.fillText(
                    "Zoom: " + this.viewport.getZoom(),
                    tile.position.x * $.pixelDensityRatio,
                    (tile.position.y - 30) * $.pixelDensityRatio
                );
                context.fillText(
                    "Pan: " + this.viewport.getBounds().toString(),
                    tile.position.x * $.pixelDensityRatio,
                    (tile.position.y - 20) * $.pixelDensityRatio
                );
            }
            context.fillText(
                "Level: " + tile.level,
                (tile.position.x + 10) * $.pixelDensityRatio,
                (tile.position.y + 20) * $.pixelDensityRatio
            );
            context.fillText(
                "Column: " + tile.x,
                (tile.position.x + 10) * $.pixelDensityRatio,
                (tile.position.y + 30) * $.pixelDensityRatio
            );
            context.fillText(
                "Row: " + tile.y,
                (tile.position.x + 10) * $.pixelDensityRatio,
                (tile.position.y + 40) * $.pixelDensityRatio
            );
            context.fillText(
                "Order: " + i + " of " + count,
                (tile.position.x + 10) * $.pixelDensityRatio,
                (tile.position.y + 50) * $.pixelDensityRatio
            );
            context.fillText(
                "Size: " + tile.size.toString(),
                (tile.position.x + 10) * $.pixelDensityRatio,
                (tile.position.y + 60) * $.pixelDensityRatio
            );
            context.fillText(
                "Position: " + tile.position.toString(),
                (tile.position.x + 10) * $.pixelDensityRatio,
                (tile.position.y + 70) * $.pixelDensityRatio
            );

            if (this.viewport.getRotation(true) % 360 !== 0 ) {
                this._restoreRotationChanges();
            }
            if (tiledImage.getRotation(true) % 360 !== 0) {
                this._restoreRotationChanges();
            }

            context.restore();
        }

        _drawPlaceholder(tiledImage){

            const bounds = tiledImage.getBounds(true);
            const rect = this.viewportToDrawerRectangle(tiledImage.getBounds(true));
            const context = this._outputContext;

            let fillStyle;
            if ( typeof tiledImage.placeholderFillStyle === "function" ) {
                fillStyle = tiledImage.placeholderFillStyle(tiledImage, context);
            }
            else {
                fillStyle = tiledImage.placeholderFillStyle;
            }

            this._offsetForRotation({degrees: this.viewer.viewport.getRotation(true)});
            context.fillStyle = fillStyle;
            context.translate(rect.x, rect.y);
            context.rotate(Math.PI / 180 * bounds.degrees);
            context.translate(-rect.x, -rect.y);
            context.fillRect(rect.x, rect.y, rect.width, rect.height);
            this._restoreRotationChanges();

        }

        /**
         * Get the canvas center
         * @private
         * @returns {OpenSeadragon.Point} The center point of the canvas
         */
        _getCanvasCenter() {
            return new $.Point(this.canvas.width / 2, this.canvas.height / 2);
        }

        // private
        _restoreRotationChanges() {
            const context = this._outputContext;
            context.restore();
        }

        // modified from https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial/Adding_2D_content_to_a_WebGL_context
        static initShaderProgram(gl, vsSource, fsSource) {

            function loadShader(gl, type, source) {
                const shader = gl.createShader(type);

                // Send the source to the shader object

                gl.shaderSource(shader, source);

                // Compile the shader program

                gl.compileShader(shader);

                // See if it compiled successfully

                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                    $.console.error(
                        `An error occurred compiling the shaders: ${gl.getShaderInfoLog(shader)}`
                    );
                    gl.deleteShader(shader);
                    return null;
                }

                return shader;
            }

            const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
            const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

            // Create the shader program

            const shaderProgram = gl.createProgram();
            gl.attachShader(shaderProgram, vertexShader);
            gl.attachShader(shaderProgram, fragmentShader);
            gl.linkProgram(shaderProgram);

            // If creating the shader program failed, alert

            if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
            $.console.error(
                `Unable to initialize the shader program: ${gl.getProgramInfoLog(
                shaderProgram
                )}`
            );
            return null;
            }

            return shaderProgram;
        }
    };


}( OpenSeadragon ));

/*
 * OpenSeadragon - Viewport
 *
 * Copyright (C) 2009 CodePlex Foundation
 * Copyright (C) 2010-2025 OpenSeadragon contributors
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 * - Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * - Redistributions in binary form must reproduce the above copyright
 *   notice, this list of conditions and the following disclaimer in the
 *   documentation and/or other materials provided with the distribution.
 *
 * - Neither the name of CodePlex Foundation nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

(function( $ ){


/**
 * @class Viewport
 * @memberof OpenSeadragon
 * @classdesc Handles coordinate-related functionality (zoom, pan, rotation, etc.)
 * for an {@link OpenSeadragon.Viewer}.
 * @param {Object} options - Options for this Viewport.
 * @param {Object} [options.margins] - See viewportMargins in {@link OpenSeadragon.Options}.
 * @param {Number} [options.springStiffness] - See springStiffness in {@link OpenSeadragon.Options}.
 * @param {Number} [options.animationTime] - See animationTime in {@link OpenSeadragon.Options}.
 * @param {Number} [options.minZoomImageRatio] - See minZoomImageRatio in {@link OpenSeadragon.Options}.
 * @param {Number} [options.maxZoomPixelRatio] - See maxZoomPixelRatio in {@link OpenSeadragon.Options}.
 * @param {Number} [options.visibilityRatio] - See visibilityRatio in {@link OpenSeadragon.Options}.
 * @param {Boolean} [options.wrapHorizontal] - See wrapHorizontal in {@link OpenSeadragon.Options}.
 * @param {Boolean} [options.wrapVertical] - See wrapVertical in {@link OpenSeadragon.Options}.
 * @param {Number} [options.defaultZoomLevel] - See defaultZoomLevel in {@link OpenSeadragon.Options}.
 * @param {Number} [options.minZoomLevel] - See minZoomLevel in {@link OpenSeadragon.Options}.
 * @param {Number} [options.maxZoomLevel] - See maxZoomLevel in {@link OpenSeadragon.Options}.
 * @param {Number} [options.degrees] - See degrees in {@link OpenSeadragon.Options}.
 * @param {Boolean} [options.homeFillsViewer] - See homeFillsViewer in {@link OpenSeadragon.Options}.
 * @param {Boolean} [options.silenceMultiImageWarnings] - See silenceMultiImageWarnings in {@link OpenSeadragon.Options}.
 */
$.Viewport = function( options ) {

    //backward compatibility for positional args while preferring more
    //idiomatic javascript options object as the only argument
    const args = arguments;
    if (args.length && args[0] instanceof $.Point) {
        options = {
            containerSize:  args[0],
            contentSize:    args[1],
            config:         args[2]
        };
    }

    //options.config and the general config argument are deprecated
    //in favor of the more direct specification of optional settings
    //being passed directly on the options object
    if ( options.config ){
        $.extend( true, options, options.config );
        delete options.config;
    }

    this._margins = $.extend({
        left: 0,
        top: 0,
        right: 0,
        bottom: 0
    }, options.margins || {});

    delete options.margins;

    options.initialDegrees = options.degrees;
    delete options.degrees;

    $.extend( true, this, {

        //required settings
        containerSize:      null,
        contentSize:        null,

        //internal state properties
        zoomPoint:          null,
        rotationPivot:      null,
        viewer:             null,

        //configurable options
        springStiffness:            $.DEFAULT_SETTINGS.springStiffness,
        animationTime:              $.DEFAULT_SETTINGS.animationTime,
        minZoomImageRatio:          $.DEFAULT_SETTINGS.minZoomImageRatio,
        maxZoomPixelRatio:          $.DEFAULT_SETTINGS.maxZoomPixelRatio,
        visibilityRatio:            $.DEFAULT_SETTINGS.visibilityRatio,
        wrapHorizontal:             $.DEFAULT_SETTINGS.wrapHorizontal,
        wrapVertical:               $.DEFAULT_SETTINGS.wrapVertical,
        defaultZoomLevel:           $.DEFAULT_SETTINGS.defaultZoomLevel,
        minZoomLevel:               $.DEFAULT_SETTINGS.minZoomLevel,
        maxZoomLevel:               $.DEFAULT_SETTINGS.maxZoomLevel,
        initialDegrees:             $.DEFAULT_SETTINGS.degrees,
        flipped:                    $.DEFAULT_SETTINGS.flipped,
        homeFillsViewer:            $.DEFAULT_SETTINGS.homeFillsViewer,
        silenceMultiImageWarnings:  $.DEFAULT_SETTINGS.silenceMultiImageWarnings

    }, options );

    this._updateContainerInnerSize();

    this.centerSpringX = new $.Spring({
        initial: 0,
        springStiffness: this.springStiffness,
        animationTime:   this.animationTime
    });
    this.centerSpringY = new $.Spring({
        initial: 0,
        springStiffness: this.springStiffness,
        animationTime:   this.animationTime
    });
    this.zoomSpring    = new $.Spring({
        exponential: true,
        initial: 1,
        springStiffness: this.springStiffness,
        animationTime:   this.animationTime
    });

    this.degreesSpring = new $.Spring({
        initial: options.initialDegrees,
        springStiffness: this.springStiffness,
        animationTime: this.animationTime
    });

    this._oldCenterX = this.centerSpringX.current.value;
    this._oldCenterY = this.centerSpringY.current.value;
    this._oldZoom    = this.zoomSpring.current.value;
    this._oldDegrees = this.degreesSpring.current.value;

    this._sizeChanged = false;

    this._setContentBounds(new $.Rect(0, 0, 1, 1), 1);

    this.goHome(true);
    this.update();
};

/** @lends OpenSeadragon.Viewport.prototype */
$.Viewport.prototype = {

    // deprecated
    get degrees () {
        $.console.warn('Accessing [Viewport.degrees] is deprecated. Use viewport.getRotation instead.');
        return this.getRotation();
    },

    // deprecated
    set degrees (degrees) {
        $.console.warn('Setting [Viewport.degrees] is deprecated. Use viewport.rotateTo, viewport.rotateBy, or viewport.setRotation instead.');
        this.rotateTo(degrees);
    },

    /**
     * Updates the viewport's home bounds and constraints for the given content size.
     * @function
     * @param {OpenSeadragon.Point} contentSize - size of the content in content units
     * @returns {OpenSeadragon.Viewport} Chainable.
     * @fires OpenSeadragon.Viewer.event:reset-size
     */
    resetContentSize: function(contentSize) {
        $.console.assert(contentSize, "[Viewport.resetContentSize] contentSize is required");
        $.console.assert(contentSize instanceof $.Point, "[Viewport.resetContentSize] contentSize must be an OpenSeadragon.Point");
        $.console.assert(contentSize.x > 0, "[Viewport.resetContentSize] contentSize.x must be greater than 0");
        $.console.assert(contentSize.y > 0, "[Viewport.resetContentSize] contentSize.y must be greater than 0");

        this._setContentBounds(new $.Rect(0, 0, 1, contentSize.y / contentSize.x), contentSize.x);
        return this;
    },

    // deprecated
    setHomeBounds: function(bounds, contentFactor) {
        $.console.error("[Viewport.setHomeBounds] this function is deprecated; The content bounds should not be set manually.");
        this._setContentBounds(bounds, contentFactor);
    },

    // Set the viewport's content bounds
    // @param {OpenSeadragon.Rect} bounds - the new bounds in viewport coordinates
    // without rotation
    // @param {Number} contentFactor - how many content units per viewport unit
    // @fires OpenSeadragon.Viewer.event:reset-size
    // @private
    _setContentBounds: function(bounds, contentFactor) {
        $.console.assert(bounds, "[Viewport._setContentBounds] bounds is required");
        $.console.assert(bounds instanceof $.Rect, "[Viewport._setContentBounds] bounds must be an OpenSeadragon.Rect");
        $.console.assert(bounds.width > 0, "[Viewport._setContentBounds] bounds.width must be greater than 0");
        $.console.assert(bounds.height > 0, "[Viewport._setContentBounds] bounds.height must be greater than 0");

        this._contentBoundsNoRotate = bounds.clone();
        this._contentSizeNoRotate = this._contentBoundsNoRotate.getSize().times(
            contentFactor);

        this._contentBounds = bounds.rotate(this.getRotation()).getBoundingBox();
        this._contentSize = this._contentBounds.getSize().times(contentFactor);
        this._contentAspectRatio = this._contentSize.x / this._contentSize.y;

        if (this.viewer) {
            /**
             * Raised when the viewer's content size or home bounds are reset
             * (see {@link OpenSeadragon.Viewport#resetContentSize}).
             *
             * @event reset-size
             * @memberof OpenSeadragon.Viewer
             * @type {object}
             * @property {OpenSeadragon.Viewer} eventSource - A reference to the Viewer which raised this event.
             * @property {OpenSeadragon.Point} contentSize
             * @property {OpenSeadragon.Rect} contentBounds - Content bounds.
             * @property {OpenSeadragon.Rect} homeBounds - Content bounds.
             * Deprecated use contentBounds instead.
             * @property {Number} contentFactor
             * @property {?Object} userData - Arbitrary subscriber-defined object.
             */
            this.viewer.raiseEvent('reset-size', {
                contentSize: this._contentSizeNoRotate.clone(),
                contentFactor: contentFactor,
                homeBounds: this._contentBoundsNoRotate.clone(),
                contentBounds: this._contentBounds.clone()
            });
        }
    },

    /**
     * Returns the home zoom in "viewport zoom" value.
     * @function
     * @returns {Number} The home zoom in "viewport zoom".
     */
    getHomeZoom: function() {
        if (this.defaultZoomLevel) {
            return this.defaultZoomLevel;
        }

        const aspectFactor = this._contentAspectRatio / this.getAspectRatio();
        let output;
        if (this.homeFillsViewer) { // fill the viewer and clip the image
            output = aspectFactor >= 1 ? aspectFactor : 1;
        } else {
            output = aspectFactor >= 1 ? 1 : aspectFactor;
        }

        return output / this._contentBounds.width;
    },

    /**
     * Returns the home bounds in viewport coordinates.
     * @function
     * @returns {OpenSeadragon.Rect} The home bounds in vewport coordinates.
     */
    getHomeBounds: function() {
        return this.getHomeBoundsNoRotate().rotate(-this.getRotation());
    },

    /**
     * Returns the home bounds in viewport coordinates.
     * This method ignores the viewport rotation. Use
     * {@link OpenSeadragon.Viewport#getHomeBounds} to take it into account.
     * @function
     * @returns {OpenSeadragon.Rect} The home bounds in vewport coordinates.
     */
    getHomeBoundsNoRotate: function() {
        const center = this._contentBounds.getCenter();
        const width  = 1.0 / this.getHomeZoom();
        const height = width / this.getAspectRatio();


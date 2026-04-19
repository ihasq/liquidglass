/**
 * WebGL2 accelerated displacement map generator - Texture-based LUT
 *
 * Uses texture sampling for LUT lookup instead of array indexing.
 * Benefits:
 * - Hardware bilinear filtering (free interpolation)
 * - Smaller shader code (no embedded LUT arrays)
 * - GPU memory efficiency (shared texture atlas)
 */

import type { CanvasDisplacementOptions, CanvasDisplacementResult } from './canvas-generator';
import { getWebGL2LutTexture, destroyWebGL2LutTexture } from './lut-texture';

// ============================================================================
// GLSL Shaders
// ============================================================================

import UBO_VERTEX_SHADER_SOURCE from '../shaders/gl2/ubo-fullscreen.vert.glsl';
import UBO_FRAGMENT_SHADER_SOURCE from '../shaders/gl2/ubo-displacement-texture.frag.glsl';

// ============================================================================
// WebGL2 Context Management
// ============================================================================

interface WebGL2TextureContext {
    gl: WebGL2RenderingContext;
    program: WebGLProgram;
    ubo: WebGLBuffer;
    uboData: Float32Array;
    vao: WebGLVertexArrayObject;
    canvas: OffscreenCanvas | HTMLCanvasElement;
    maxTextureSize: number;

    // LUT texture
    lutTexture: WebGLTexture;
    lutTextureLocation: WebGLUniformLocation | null;

    // Cached resources
    exportCanvas: HTMLCanvasElement | null;
    cachedPixelBuffer: Uint8Array | null;
    cachedPixelBufferSize: number;
    cachedImageData: ImageData | null;
    cachedImageDataWidth: number;
    cachedImageDataHeight: number;
}

let _gl2Context: WebGL2TextureContext | null = null;
let _gl2Supported: boolean | null = null;
let _gl2Initializing: Promise<WebGL2TextureContext | null> | null = null;
let _gl2ContextLost = false;

function compileShader(
    gl: WebGL2RenderingContext,
    type: number,
    source: string
): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create shader');

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compilation failed: ${info}`);
    }

    return shader;
}

function createProgram(
    gl: WebGL2RenderingContext,
    vertexShader: WebGLShader,
    fragmentShader: WebGLShader
): WebGLProgram {
    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create program');

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`Program linking failed: ${info}`);
    }

    return program;
}

async function initWebGL2Context(): Promise<WebGL2TextureContext | null> {
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(1, 1);
    } else {
        canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
    }

    const gl = canvas.getContext('webgl2', {
        antialias: false,
        depth: false,
        stencil: false,
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
    });

    if (!gl) {
        console.warn('WebGL2 not supported');
        return null;
    }

    // Context loss handler
    const lossHandler = (e: Event) => {
        e.preventDefault();
        _gl2ContextLost = true;
        _gl2Context = null;
        _gl2Supported = false;
        _gl2Initializing = null;
        destroyWebGL2LutTexture();
    };
    if ('addEventListener' in canvas) {
        (canvas as HTMLCanvasElement).addEventListener('webglcontextlost', lossHandler, { once: true });
    }

    try {
        // Compile shaders
        const vertexShader = compileShader(gl, gl.VERTEX_SHADER, UBO_VERTEX_SHADER_SOURCE);
        const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, UBO_FRAGMENT_SHADER_SOURCE);
        const program = createProgram(gl, vertexShader, fragmentShader);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        // Setup UBO
        const ubo = gl.createBuffer();
        if (!ubo) throw new Error('Failed to create UBO');

        gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
        gl.bufferData(gl.UNIFORM_BUFFER, 32, gl.DYNAMIC_DRAW);

        const uboIndex = gl.getUniformBlockIndex(program, 'Params');
        gl.uniformBlockBinding(program, uboIndex, 0);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);

        const uboData = new Float32Array(8);

        // Create VAO
        const vao = gl.createVertexArray();
        if (!vao) throw new Error('Failed to create VAO');

        // Get LUT texture
        const lutTexture = getWebGL2LutTexture(gl);
        const lutTextureLocation = gl.getUniformLocation(program, 'u_lutTexture');

        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

        return {
            gl,
            program,
            ubo,
            uboData,
            vao,
            canvas,
            maxTextureSize,
            lutTexture,
            lutTextureLocation,
            exportCanvas: null,
            cachedPixelBuffer: null,
            cachedPixelBufferSize: 0,
            cachedImageData: null,
            cachedImageDataWidth: 0,
            cachedImageDataHeight: 0,
        };
    } catch (error) {
        console.warn('WebGL2 texture initialization failed:', error);
        return null;
    }
}

async function ensureWebGL2Context(): Promise<WebGL2TextureContext | null> {
    if (_gl2Context !== null) return _gl2Context;
    if (_gl2Supported === false) return null;

    if (_gl2Initializing === null) {
        _gl2Initializing = initWebGL2Context().then((ctx) => {
            _gl2Context = ctx;
            _gl2Supported = ctx !== null;
            return ctx;
        });
    }

    return _gl2Initializing;
}

function getExportCanvas(ctx: WebGL2TextureContext, width: number, height: number): HTMLCanvasElement {
    if (!ctx.exportCanvas) {
        ctx.exportCanvas = document.createElement('canvas');
    }
    if (ctx.exportCanvas.width !== width || ctx.exportCanvas.height !== height) {
        ctx.exportCanvas.width = width;
        ctx.exportCanvas.height = height;
    }
    return ctx.exportCanvas;
}

function getPixelBuffer(ctx: WebGL2TextureContext, size: number): Uint8Array {
    if (!ctx.cachedPixelBuffer || ctx.cachedPixelBufferSize < size) {
        ctx.cachedPixelBuffer = new Uint8Array(size);
        ctx.cachedPixelBufferSize = size;
    }
    return ctx.cachedPixelBuffer;
}

function getImageData(
    ctx: WebGL2TextureContext,
    outputCtx: CanvasRenderingContext2D,
    width: number,
    height: number
): ImageData {
    if (!ctx.cachedImageData ||
        ctx.cachedImageDataWidth !== width ||
        ctx.cachedImageDataHeight !== height) {
        ctx.cachedImageData = outputCtx.createImageData(width, height);
        ctx.cachedImageDataWidth = width;
        ctx.cachedImageDataHeight = height;
    }
    return ctx.cachedImageData;
}

// ============================================================================
// Public API
// ============================================================================

export function isWebGL2TextureSupported(): boolean {
    if (_gl2Supported !== null) return _gl2Supported;
    if (typeof WebGL2RenderingContext === 'undefined') {
        _gl2Supported = false;
        return false;
    }
    if (_gl2ContextLost) {
        _gl2Supported = false;
        return false;
    }
    return true;
}

export function preloadWebGL2Texture(): Promise<boolean> {
    return ensureWebGL2Context().then((ctx) => ctx !== null);
}

export async function generateWebGL2TextureDisplacementMap(
    options: CanvasDisplacementOptions
): Promise<CanvasDisplacementResult | null> {
    const ctx = await ensureWebGL2Context();
    if (!ctx) return null;
    return generateInternal(ctx, options);
}

function generateInternal(
    ctx: WebGL2TextureContext,
    options: CanvasDisplacementOptions
): CanvasDisplacementResult | null {
    const { width, height, borderRadius, edgeWidthRatio = 0.5, profile = 0 } = options;
    const startTime = performance.now();

    const { gl, program, ubo, uboData, vao, canvas, maxTextureSize, lutTexture, lutTextureLocation } = ctx;

    if (gl.isContextLost()) {
        _gl2ContextLost = true;
        _gl2Context = null;
        _gl2Supported = false;
        return null;
    }

    const fullWidth = Math.max(1, Math.min(width | 0, maxTextureSize));
    const fullHeight = Math.max(1, Math.min(height | 0, maxTextureSize));

    // Resize canvas if needed
    if (canvas.width !== fullWidth || canvas.height !== fullHeight) {
        canvas.width = fullWidth;
        canvas.height = fullHeight;
    }

    // Setup rendering
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, fullWidth, fullHeight);
    gl.useProgram(program);

    // Bind LUT texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, lutTexture);
    if (lutTextureLocation !== null) {
        gl.uniform1i(lutTextureLocation, 0);
    }

    // Update UBO data
    uboData[0] = fullWidth;
    uboData[1] = fullHeight;
    uboData[2] = borderRadius;
    uboData[3] = profile;
    uboData[4] = edgeWidthRatio;

    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, uboData);

    // Draw
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    gl.finish();

    // Bounds check
    const fbWidth = gl.drawingBufferWidth;
    const fbHeight = gl.drawingBufferHeight;
    if (fbWidth < fullWidth || fbHeight < fullHeight) {
        return null;
    }

    // Read pixels
    const pixelBufferSize = fullWidth * fullHeight * 4;
    const pixels = getPixelBuffer(ctx, pixelBufferSize);
    gl.readPixels(0, 0, fullWidth, fullHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const glErr = gl.getError();
    if (glErr !== gl.NO_ERROR) {
        return null;
    }

    // Export to canvas (flip Y)
    const exportCanvas = getExportCanvas(ctx, fullWidth, fullHeight);
    const outputCtx = exportCanvas.getContext('2d')!;
    const imageData = getImageData(ctx, outputCtx, fullWidth, fullHeight);

    for (let y = 0; y < fullHeight; y++) {
        const srcRow = (fullHeight - 1 - y) * fullWidth * 4;
        const dstRow = y * fullWidth * 4;
        for (let x = 0; x < fullWidth * 4; x++) {
            imageData.data[dstRow + x] = pixels[srcRow + x];
        }
    }
    outputCtx.putImageData(imageData, 0, 0);

    const generationTime = performance.now() - startTime;

    return {
        canvas: exportCanvas,
        dataUrl: exportCanvas.toDataURL('image/png'),
        generationTime,
    };
}

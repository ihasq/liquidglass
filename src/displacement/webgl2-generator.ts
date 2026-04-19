/**
 * WebGL2 accelerated displacement map generator (UBO SINGLE-PASS)
 *
 * GPU-based implementation using Uniform Buffer Objects for optimal performance.
 * Single-pass rendering with 2-5x speedup over individual uniform calls.
 *
 * RGB encoding (matches WASM):
 * - R channel: X displacement (128 = none, <128 = left, >128 = right)
 * - G channel: Y displacement (128 = none, <128 = up, >128 = down)
 * - B channel: unused (128)
 * - A channel: 255
 */

import type { CanvasDisplacementOptions, CanvasDisplacementResult } from './canvas-generator';

// ============================================================================
// GLSL Shaders (UBO-based single-pass)
// ============================================================================

import UBO_VERTEX_SHADER_SOURCE from '../shaders/gl2/ubo-fullscreen.vert.glsl';
import UBO_FRAGMENT_SHADER_SOURCE from '../shaders/gl2/ubo-displacement.frag.glsl';

// ============================================================================
// WebGL2 Context Management
// ============================================================================

interface WebGL2UBOContext {
    gl: WebGL2RenderingContext;

    // Single-pass UBO program
    program: WebGLProgram;
    ubo: WebGLBuffer;
    uboData: Float32Array;

    // Shared resources
    vao: WebGLVertexArrayObject;
    canvas: OffscreenCanvas | HTMLCanvasElement;
    maxTextureSize: number;

    // Cached export canvas for dataUrl generation (reused to avoid memory leaks)
    exportCanvas: HTMLCanvasElement | null;

    // Cached pixel buffer and ImageData (reused to avoid memory leaks)
    cachedPixelBuffer: Uint8Array | null;
    cachedPixelBufferSize: number;
    cachedImageData: ImageData | null;
    cachedImageDataWidth: number;
    cachedImageDataHeight: number;
}

let _gl2Context: WebGL2UBOContext | null = null;
let _gl2Supported: boolean | null = null;
let _gl2Initializing: Promise<WebGL2UBOContext | null> | null = null;
let _envCheckCached: boolean | null = null;
/** Set true when a context loss event fires; subsequent calls fall back. */
let _gl2ContextLost = false;

// ============================================================================
// Environment detection (avoid GPU process crashes on known-bad platforms)
// ============================================================================
//
// Background:
//   On ChromeOS + Intel Alder Lake-N + Mesa Vulkan 24.x + ANGLE-via-Vulkan,
//   continuous resize triggers a chain:
//     glCopySubTextureCHROMIUM offset overflow  →  SharedImage mailbox dangling
//     →  ProduceSkia on non-existent mailbox    →  Mesa VkImage UAF
//     →  GPU process SIGILL.
//   The renderer process survives but the page freezes / rerenders to white.
//   Affected platforms detected via WEBGL_debug_renderer_info:
//     - "ADL-N" / "Alder Lake-N" + "Mesa"
//     - Other Intel + Mesa combinations exhibiting the same pattern can be
//       added below as discovered.
//
//   Mitigation: declare WebGL2 unsupported on these platforms so the
//   FilterManager auto-fallback chain (gpu → gl2 → wasm) advances to
//   the safer WASM-SIMD path.
//
//   User override: set `globalThis.__lg_force_webgl2 = true` before module
//   load to bypass this check (for debugging).

function isUnsafeWebGL2Environment(): boolean {
  if (_envCheckCached !== null) return _envCheckCached;

  // Manual override
  if ((globalThis as { __lg_force_webgl2?: boolean }).__lg_force_webgl2) {
    _envCheckCached = false;
    return false;
  }
  if ((globalThis as { __lg_disable_webgl2?: boolean }).__lg_disable_webgl2) {
    _envCheckCached = true;
    return true;
  }

  try {
    // Probe the GPU renderer string via a throw-away WebGL context
    const probe = document.createElement('canvas').getContext('webgl');
    if (!probe) {
      _envCheckCached = false;
      return false;
    }
    const ext = probe.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext
      ? probe.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string
      : probe.getParameter(probe.RENDERER) as string;
    // Best-effort cleanup
    const lose = probe.getExtension('WEBGL_lose_context');
    lose?.loseContext();

    if (typeof renderer !== 'string') {
      _envCheckCached = false;
      return false;
    }

    // Known bad combinations
    const isMesa = /Mesa/i.test(renderer);
    const isIntel = /Intel/i.test(renderer);
    const isAdlN = /ADL[\s-]?N|Alder\s*Lake[\s-]?N/i.test(renderer);

    // ChromeOS-specific: Mesa+Intel+ADL-N → known SIGILL trigger via SharedImage
    const unsafe = isMesa && isIntel && isAdlN;
    if (unsafe && typeof console !== 'undefined') {
      console.warn(
        '[LiquidGlass] WebGL2 displacement disabled on this platform ' +
        '(Mesa+Intel+ADL-N triggers GPU process crash during resize). ' +
        'Falling back to WASM-SIMD. Override with __lg_force_webgl2=true.'
      );
    }
    _envCheckCached = unsafe;
    return unsafe;
  } catch {
    _envCheckCached = false;
    return false;
  }
}

function compileShader(
    gl: WebGL2RenderingContext,
    type: number,
    source: string
): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) {
        throw new Error('Failed to create shader');
    }

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
    if (!program) {
        throw new Error('Failed to create program');
    }

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

async function initWebGL2Context(): Promise<WebGL2UBOContext | null> {
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

    // GPU process crash / context loss handler. When the GPU dies (often due
    // to driver bugs during heavy resize), we permanently disable the WebGL2
    // path and let the FilterManager auto-fallback chain advance to wasm.
    // The handler must be on the *canvas* element, not gl.
    const lossHandler = (e: Event) => {
        e.preventDefault();  // Allow restoreContext if browser supports it
        _gl2ContextLost = true;
        _gl2Context = null;
        _gl2Supported = false;
        _gl2Initializing = null;
        if (typeof console !== 'undefined') {
            console.warn(
                '[LiquidGlass] WebGL2 context lost (likely GPU process crash). ' +
                'Permanently switching to WASM-SIMD displacement.'
            );
        }
    };
    if ('addEventListener' in canvas) {
        (canvas as HTMLCanvasElement).addEventListener('webglcontextlost', lossHandler, { once: true });
    }

    try {
        // Compile UBO-based shaders
        const vertexShader = compileShader(gl, gl.VERTEX_SHADER, UBO_VERTEX_SHADER_SOURCE);
        const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, UBO_FRAGMENT_SHADER_SOURCE);
        const program = createProgram(gl, vertexShader, fragmentShader);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        // Create UBO
        const ubo = gl.createBuffer();
        if (!ubo) {
            throw new Error('Failed to create UBO');
        }

        // Setup UBO binding
        // UBO layout (std140): vec4 resRadius (16 bytes), float edge (4 bytes) + padding (12 bytes) = 32 bytes
        gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
        gl.bufferData(gl.UNIFORM_BUFFER, 32, gl.DYNAMIC_DRAW);

        const uboIndex = gl.getUniformBlockIndex(program, 'Params');
        gl.uniformBlockBinding(program, uboIndex, 0);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);

        // Pre-allocate UBO data array
        const uboData = new Float32Array(8); // 32 bytes / 4 bytes per float

        // Create VAO (empty, using gl_VertexID)
        const vao = gl.createVertexArray();
        if (!vao) {
            throw new Error('Failed to create VAO');
        }

        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

        return {
            gl,
            program,
            ubo,
            uboData,
            vao,
            canvas,
            maxTextureSize,
            exportCanvas: null,
            cachedPixelBuffer: null,
            cachedPixelBufferSize: 0,
            cachedImageData: null,
            cachedImageDataWidth: 0,
            cachedImageDataHeight: 0,
        };
    } catch (error) {
        console.warn('WebGL2 initialization failed:', error);
        return null;
    }
}

/**
 * Get or create export canvas for dataUrl generation (reused to avoid memory leaks)
 */
function getExportCanvas(ctx: WebGL2UBOContext, width: number, height: number): HTMLCanvasElement {
    if (!ctx.exportCanvas) {
        ctx.exportCanvas = document.createElement('canvas');
    }

    if (ctx.exportCanvas.width !== width || ctx.exportCanvas.height !== height) {
        ctx.exportCanvas.width = width;
        ctx.exportCanvas.height = height;
    }

    return ctx.exportCanvas;
}

/**
 * Get or create pixel buffer for readPixels (reused to avoid memory leaks)
 */
function getPixelBuffer(ctx: WebGL2UBOContext, size: number): Uint8Array {
    if (!ctx.cachedPixelBuffer || ctx.cachedPixelBufferSize < size) {
        ctx.cachedPixelBuffer = new Uint8Array(size);
        ctx.cachedPixelBufferSize = size;
    }
    return ctx.cachedPixelBuffer;
}

/**
 * Get or create ImageData for putImageData (reused to avoid memory leaks)
 */
function getImageData(ctx: WebGL2UBOContext, outputCtx: CanvasRenderingContext2D, width: number, height: number): ImageData {
    if (!ctx.cachedImageData ||
        ctx.cachedImageDataWidth !== width ||
        ctx.cachedImageDataHeight !== height) {
        ctx.cachedImageData = outputCtx.createImageData(width, height);
        ctx.cachedImageDataWidth = width;
        ctx.cachedImageDataHeight = height;
    }
    return ctx.cachedImageData;
}

async function ensureWebGL2Context(): Promise<WebGL2UBOContext | null> {
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

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if WebGL2 is supported AND safe on this platform.
 *
 * Returns false if:
 *   - The browser lacks WebGL2 entirely
 *   - A previous context was lost (GPU process crash)
 *   - The platform is on the known-unsafe list (e.g. Intel ADL-N + Mesa)
 */
export function isWebGL2Supported(): boolean {
    if (_gl2Supported !== null) return _gl2Supported;

    if (typeof WebGL2RenderingContext === 'undefined') {
        _gl2Supported = false;
        return false;
    }

    // Already lost the context once → don't try again
    if (_gl2ContextLost) {
        _gl2Supported = false;
        return false;
    }

    // Known-bad GPU/driver combinations
    if (isUnsafeWebGL2Environment()) {
        _gl2Supported = false;
        return false;
    }

    return true;
}

/**
 * Preload WebGL2 context (call early to avoid first-use latency)
 */
export function preloadWebGL2(): Promise<boolean> {
    return ensureWebGL2Context().then((ctx) => ctx !== null);
}

/**
 * Generate displacement map using WebGL2 (async)
 *
 * Uses UBO-based single-pass for optimal performance.
 * Returns null if WebGL2 is not supported.
 */
export async function generateWebGL2DisplacementMap(
    options: CanvasDisplacementOptions
): Promise<CanvasDisplacementResult | null> {
    const ctx = await ensureWebGL2Context();
    if (!ctx) return null;

    return generateWebGL2DisplacementMapInternal(ctx, options);
}

function generateWebGL2DisplacementMapInternal(
    ctx: WebGL2UBOContext,
    options: CanvasDisplacementOptions
): CanvasDisplacementResult | null {
    const { width, height, borderRadius, edgeWidthRatio = 0.5 } = options;
    const startTime = performance.now();

    const { gl, program, ubo, uboData, vao, canvas, maxTextureSize } = ctx;

    // Bail out early if context was lost between the call site and now
    if (gl.isContextLost()) {
        _gl2ContextLost = true;
        _gl2Context = null;
        _gl2Supported = false;
        return null;
    }

    // Clamp to max texture size AND validate non-zero dims (prevents
    // glCopySubTextureCHROMIUM offset-overflow in Chromium's SharedImage
    // path when downstream feImage decodes a 0-dim canvas).
    const fullWidth = Math.max(1, Math.min(width | 0, maxTextureSize));
    const fullHeight = Math.max(1, Math.min(height | 0, maxTextureSize));

    // Resize canvas if needed
    if (canvas.width !== fullWidth || canvas.height !== fullHeight) {
        canvas.width = fullWidth;
        canvas.height = fullHeight;
    }

    // =========================================================================
    // Single-pass UBO rendering
    // =========================================================================

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, fullWidth, fullHeight);
    gl.useProgram(program);

    // Update UBO data (std140 layout)
    // vec4 resRadius: xy = resolution, z = borderRadius, w = padding
    // float edge + 12 bytes padding
    uboData[0] = fullWidth;
    uboData[1] = fullHeight;
    uboData[2] = borderRadius;
    uboData[3] = 0; // padding
    uboData[4] = edgeWidthRatio;
    // uboData[5-7] = padding (unused)

    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, uboData);

    // Draw fullscreen triangle
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    // Ensure rendering is complete
    gl.finish();

    // =========================================================================
    // Read pixels to output canvas (reused buffers to avoid memory leaks)
    // =========================================================================

    const exportCanvas = getExportCanvas(ctx, fullWidth, fullHeight);
    const outputCtx = exportCanvas.getContext('2d')!;

    // Read pixels from WebGL (reuse pixel buffer)
    // Bounds check: Chromium's internal glCopySubTextureCHROMIUM (used by
    // putImageData/toDataURL downstream) crashes the GPU process on Mesa+ADL-N
    // when source rect overflows the framebuffer. Verify framebuffer matches
    // expected size before reading.
    const fbWidth = gl.drawingBufferWidth;
    const fbHeight = gl.drawingBufferHeight;
    if (fbWidth < fullWidth || fbHeight < fullHeight) {
        // Drawing buffer is smaller than requested (e.g. due to OOM or context
        // loss recovery). Aborting prevents Chrome from issuing an out-of-bounds
        // copy that would crash the GPU process.
        if (typeof console !== 'undefined') {
            console.warn(
                `[LiquidGlass] WebGL2 drawing buffer (${fbWidth}x${fbHeight}) ` +
                `smaller than requested (${fullWidth}x${fullHeight}). Aborting frame.`
            );
        }
        return null;
    }
    const pixelBufferSize = fullWidth * fullHeight * 4;
    const pixels = getPixelBuffer(ctx, pixelBufferSize);
    gl.readPixels(0, 0, fullWidth, fullHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // Post-readPixels error check: GL_INVALID_VALUE here typically precedes
    // the GPU process SIGILL chain on Intel Mesa drivers.
    const glErr = gl.getError();
    if (glErr !== gl.NO_ERROR) {
        if (typeof console !== 'undefined') {
            console.warn(
                `[LiquidGlass] WebGL2 readPixels error 0x${glErr.toString(16)} ` +
                `at ${fullWidth}x${fullHeight}. Aborting frame.`
            );
        }
        return null;
    }

    // WebGL has Y=0 at bottom, Canvas has Y=0 at top - flip vertically
    // Reuse ImageData to avoid allocation
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


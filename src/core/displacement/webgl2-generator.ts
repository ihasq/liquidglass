/**
 * WebGL2 accelerated displacement map generator (QUADRANT OPTIMIZED)
 *
 * GPU-based implementation with 1/4 computation optimization.
 * Uses a 2-pass rendering approach:
 *
 * Pass 1: Render bottom-right quadrant only to framebuffer texture
 * Pass 2: Composite to full size with channel inversions for each quadrant
 *
 * Quadrant layout (same as WASM quad implementation):
 * ┌────────┬────────┐
 * │   TL   │   TR   │  TL: R'=255-R, G'=255-G (X+Y invert)
 * │(-X,-Y) │(+X,-Y) │  TR: G'=255-G (Y invert only)
 * ├────────┼────────┤
 * │   BL   │   BR   │  BL: R'=255-R (X invert only)
 * │(-X,+Y) │(+X,+Y) │  BR: original quadrant
 * └────────┴────────┘
 *
 * RGB encoding (matches WASM):
 * - R channel: X displacement (128 = none, <128 = left, >128 = right)
 * - G channel: Y displacement (128 = none, <128 = up, >128 = down)
 * - B channel: unused (128)
 * - A channel: 255
 */

import type { CanvasDisplacementOptions, CanvasDisplacementResult } from './canvas-generator';

// ============================================================================
// GLSL Shaders
// ============================================================================

const VERTEX_SHADER_SOURCE = /* glsl */ `#version 300 es
precision highp float;

// Full-screen triangle (no vertex buffer needed)
// Vertex IDs 0,1,2 map to corners covering [-1,1] clip space
void main() {
    // Generate clip-space coordinates from vertex ID
    // 0 -> (-1, -1), 1 -> (3, -1), 2 -> (-1, 3)
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

/**
 * Pass 1: Quadrant displacement computation
 *
 * Renders only the bottom-right quadrant of the displacement map.
 * Coordinates are transformed to compute displacement as if rendering
 * the BR quadrant of the full image.
 */
const QUADRANT_FRAGMENT_SHADER_SOURCE = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 u_quadResolution;   // (quadWidth, quadHeight)
uniform vec2 u_fullResolution;   // (fullWidth, fullHeight)
uniform float u_borderRadius;    // border radius in pixels
uniform float u_edgeWidthRatio;  // edge width as ratio of min dimension

out vec4 fragColor;

// ============================================================================
// Fast exp() approximation matching WASM implementation
// Uses Schraudolph's method with polynomial correction (~0.3% accuracy)
// ============================================================================

const float LOG2E = 1.4426950408889634;
const float LN2 = 0.6931471805599453;

float fastExp(float x) {
    if (x < -87.0) return 0.0;
    if (x > 0.0) return 1.0;

    float k = floor(x * LOG2E);
    float r = x - k * LN2;

    float r2 = r * r;
    float r3 = r2 * r;
    float r4 = r2 * r2;
    float expR = 1.0 + r + r2 * 0.5 + r3 * 0.16666667 + r4 * 0.04166667;

    return expR * exp2(k);
}

// ============================================================================
// Quadrant displacement computation
//
// This shader computes displacement for the BOTTOM-RIGHT quadrant only.
// The pixel position (qx, qy) in quadrant space directly represents the
// distance from center, matching WASM behavior exactly.
//
// SMT-VERIFIED FIX:
// For odd dimensions, abs(centerX + qx - halfW) produces 0.5 offset errors.
// WASM uses qx directly as the distance from center. We must do the same.
//
// Example (99x101, qx=0):
//   WASM: dx = 0
//   OLD GL2: dx = abs(49 + 0 - 49.5) = 0.5 ✗
//   FIXED GL2: dx = qx = 0 ✓
//
// In BR quadrant: signX = 1.0, signY = 1.0 always (positive quadrant)
// ============================================================================

void main() {
    vec2 fragCoord = gl_FragCoord.xy;
    float quadWidth = u_quadResolution.x;
    float quadHeight = u_quadResolution.y;
    float fullWidth = u_fullResolution.x;
    float fullHeight = u_fullResolution.y;

    float halfW = fullWidth * 0.5;
    float halfH = fullHeight * 0.5;
    float minHalf = min(halfW, halfH);
    float edgeWidth = minHalf * u_edgeWidthRatio;
    float r = min(u_borderRadius, minHalf);

    float negThreeOverEdgeWidth = -3.0 / edgeWidth;
    float cornerThresholdX = halfW - r;
    float cornerThresholdY = halfH - r;

    // Quadrant pixel position (0-indexed)
    // In BR quadrant, qx/qy directly represent distance from center
    float qx = fragCoord.x - 0.5;
    float qy = fragCoord.y - 0.5;

    // SMT-VERIFIED: Use qx/qy directly as distance from center
    // This matches WASM behavior exactly for both even and odd dimensions
    float dx = qx;
    float dy = qy;

    // Check if in corner region
    bool inCornerX = dx > cornerThresholdX;
    bool inCornerY = dy > cornerThresholdY;
    bool inCorner = inCornerX && inCornerY;

    float distFromEdge = 0.0;
    float dirX = 0.0;
    float dirY = 0.0;

    if (inCorner) {
        float cornerX = dx - cornerThresholdX;
        float cornerY = dy - cornerThresholdY;
        float cornerDist = sqrt(cornerX * cornerX + cornerY * cornerY);

        distFromEdge = r - cornerDist;

        if (cornerDist > 0.001) {
            float invDist = 1.0 / cornerDist;
            // SMT-VERIFIED: In BR quadrant, signs are always positive
            // Using fx/fy for sign check fails for odd dimensions (e.g., 99x101)
            // because centerX + qx can be < halfW when qx=0 and width is odd.
            // BR quadrant is always the positive quadrant: signX = 1.0, signY = 1.0
            dirX = cornerX * invDist;  // signX = 1.0 implicit
            dirY = cornerY * invDist;  // signY = 1.0 implicit
        }
    } else {
        float distX = halfW - dx;
        float distY = halfH - dy;

        if (distX < distY) {
            distFromEdge = distX;
            // SMT-VERIFIED: BR quadrant always has positive signs
            dirX = 1.0;
        } else {
            distFromEdge = distY;
            dirY = 1.0;
        }
    }

    float clampedDist = max(distFromEdge, 0.0);
    float expArg = clampedDist * negThreeOverEdgeWidth;
    float magnitude = fastExp(expArg);

    float dispX = -dirX * magnitude;
    float dispY = -dirY * magnitude;

    // Encode to RGB (128 = neutral)
    // Use floor() to match WASM truncation behavior
    float rVal = clamp(floor(128.0 + dispX * 127.0), 0.0, 255.0) / 255.0;
    float gVal = clamp(floor(128.0 + dispY * 127.0), 0.0, 255.0) / 255.0;

    fragColor = vec4(rVal, gVal, 128.0 / 255.0, 1.0);
}
`;

/**
 * Pass 2: Quadrant compositing
 *
 * Reads from the quadrant texture and composites to full resolution,
 * applying channel inversions for each quadrant position.
 */
const COMPOSITE_FRAGMENT_SHADER_SOURCE = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D u_quadrantTexture;  // BR quadrant texture
uniform vec2 u_fullResolution;        // (fullWidth, fullHeight)
uniform vec2 u_quadResolution;        // (quadWidth, quadHeight)

out vec4 fragColor;

void main() {
    vec2 fragCoord = gl_FragCoord.xy;
    float fullWidth = u_fullResolution.x;
    float fullHeight = u_fullResolution.y;
    float quadWidth = u_quadResolution.x;
    float quadHeight = u_quadResolution.y;

    // Pixel position (0-indexed)
    float px = fragCoord.x - 0.5;
    float py = fragCoord.y - 0.5;

    // Center position (matches WASM: floor(width/2), floor(height/2))
    float centerX = floor(fullWidth * 0.5);
    float centerY = floor(fullHeight * 0.5);

    // =========================================================================
    // Determine which quadrant this pixel belongs to (in WASM coordinate space)
    //
    // WebGL Y=0 at bottom, readPixels flips Y to match Canvas/WASM coords.
    // After flip: WebGL py → WASM fy = (fullHeight - 1 - py)
    //
    // WASM quadrant definition:
    // - Bottom half: fy >= centerY (BR, BL)
    // - Top half:    fy < centerY (TR, TL)
    //
    // Converting: fy >= centerY ⟺ fullHeight-1-py >= centerY ⟺ py <= fullHeight-1-centerY
    // For symmetric case: py < centerY means bottom half after flip
    // =========================================================================
    bool isRight = px >= centerX;
    bool isBottom = py < centerY;  // After Y-flip, this becomes WASM bottom half

    // Calculate quadrant texture coordinates
    // The quadrant texture stores values for fy = centerY + qy' (WASM coords)
    // We need to map from current position to the appropriate qy' in quadrant
    float qx, qy;
    bool invertR = false;
    bool invertG = false;

    if (isRight && isBottom) {
        // BR quadrant: direct copy
        // WASM fy = fullHeight-1-py, qy' = fy - centerY = fullHeight-1-py-centerY
        // Simplify: qy' = (fullHeight-1-centerY) - py = centerY-1-py (for symmetric)
        // But we need qy in [0, quadHeight-1]
        qx = px - centerX;
        qy = centerY - 1.0 - py;
    } else if (!isRight && isBottom) {
        // BL quadrant: X-mirrored, invert R
        qx = centerX - 1.0 - px;
        qy = centerY - 1.0 - py;
        invertR = true;
    } else if (isRight && !isBottom) {
        // TR quadrant: Y-mirrored, invert G
        // WASM fy = fullHeight-1-py < centerY, so qy' = centerY-1-fy = py-(fullHeight-centerY)
        qx = px - centerX;
        qy = py - centerY;
        invertG = true;
    } else {
        // TL quadrant: X+Y mirrored, invert R and G
        qx = centerX - 1.0 - px;
        qy = py - centerY;
        invertR = true;
        invertG = true;
    }

    // Clamp to valid quadrant range
    qx = clamp(qx, 0.0, quadWidth - 1.0);
    qy = clamp(qy, 0.0, quadHeight - 1.0);

    // Sample quadrant texture (texelFetch for exact pixel access)
    // Add 0.5 for texel center
    vec2 texCoord = (vec2(qx, qy) + 0.5) / u_quadResolution;
    vec4 quadColor = texture(u_quadrantTexture, texCoord);

    // Apply channel inversions
    float r = quadColor.r;
    float g = quadColor.g;

    if (invertR) {
        // Invert R channel: 255 - r (in 0-255 space)
        // In normalized space: 1.0 - r
        r = 1.0 - r;
    }
    if (invertG) {
        // Invert G channel
        g = 1.0 - g;
    }

    fragColor = vec4(r, g, quadColor.b, quadColor.a);
}
`;

// ============================================================================
// WebGL2 Context Management
// ============================================================================

interface WebGL2QuadContext {
    gl: WebGL2RenderingContext;

    // Pass 1: Quadrant rendering
    quadrantProgram: WebGLProgram;
    quadrantUniforms: {
        quadResolution: WebGLUniformLocation;
        fullResolution: WebGLUniformLocation;
        borderRadius: WebGLUniformLocation;
        edgeWidthRatio: WebGLUniformLocation;
    };

    // Pass 2: Compositing
    compositeProgram: WebGLProgram;
    compositeUniforms: {
        quadrantTexture: WebGLUniformLocation;
        fullResolution: WebGLUniformLocation;
        quadResolution: WebGLUniformLocation;
    };

    // Shared resources
    vao: WebGLVertexArrayObject;
    framebuffer: WebGLFramebuffer;
    quadrantTexture: WebGLTexture;

    canvas: OffscreenCanvas | HTMLCanvasElement;
    maxTextureSize: number;

    // Current FBO size (to avoid unnecessary resizes)
    currentQuadWidth: number;
    currentQuadHeight: number;
}

let _gl2Context: WebGL2QuadContext | null = null;
let _gl2Supported: boolean | null = null;
let _gl2Initializing: Promise<WebGL2QuadContext | null> | null = null;

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

async function initWebGL2Context(): Promise<WebGL2QuadContext | null> {
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

    try {
        // Compile vertex shader (shared)
        const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);

        // Compile quadrant fragment shader
        const quadrantFragShader = compileShader(gl, gl.FRAGMENT_SHADER, QUADRANT_FRAGMENT_SHADER_SOURCE);
        const quadrantProgram = createProgram(gl, vertexShader, quadrantFragShader);
        gl.deleteShader(quadrantFragShader);

        // Compile composite fragment shader
        const compositeFragShader = compileShader(gl, gl.FRAGMENT_SHADER, COMPOSITE_FRAGMENT_SHADER_SOURCE);
        const compositeProgram = createProgram(gl, vertexShader, compositeFragShader);
        gl.deleteShader(compositeFragShader);

        // Clean up shared vertex shader
        gl.deleteShader(vertexShader);

        // Get uniform locations for quadrant program
        const quadResolutionLoc = gl.getUniformLocation(quadrantProgram, 'u_quadResolution');
        const fullResolutionLoc1 = gl.getUniformLocation(quadrantProgram, 'u_fullResolution');
        const borderRadiusLoc = gl.getUniformLocation(quadrantProgram, 'u_borderRadius');
        const edgeWidthRatioLoc = gl.getUniformLocation(quadrantProgram, 'u_edgeWidthRatio');

        if (!quadResolutionLoc || !fullResolutionLoc1 || !borderRadiusLoc || !edgeWidthRatioLoc) {
            throw new Error('Failed to get quadrant uniform locations');
        }

        // Get uniform locations for composite program
        const quadrantTextureLoc = gl.getUniformLocation(compositeProgram, 'u_quadrantTexture');
        const fullResolutionLoc2 = gl.getUniformLocation(compositeProgram, 'u_fullResolution');
        const quadResolutionLoc2 = gl.getUniformLocation(compositeProgram, 'u_quadResolution');

        if (!quadrantTextureLoc || !fullResolutionLoc2 || !quadResolutionLoc2) {
            throw new Error('Failed to get composite uniform locations');
        }

        // Create VAO (shared, empty)
        const vao = gl.createVertexArray();
        if (!vao) {
            throw new Error('Failed to create VAO');
        }

        // Create framebuffer for quadrant rendering
        const framebuffer = gl.createFramebuffer();
        if (!framebuffer) {
            throw new Error('Failed to create framebuffer');
        }

        // Create texture for quadrant output
        const quadrantTexture = gl.createTexture();
        if (!quadrantTexture) {
            throw new Error('Failed to create quadrant texture');
        }

        // Initialize texture with minimal size (will be resized as needed)
        gl.bindTexture(gl.TEXTURE_2D, quadrantTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        // Attach texture to framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, quadrantTexture, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);

        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

        return {
            gl,
            quadrantProgram,
            quadrantUniforms: {
                quadResolution: quadResolutionLoc,
                fullResolution: fullResolutionLoc1,
                borderRadius: borderRadiusLoc,
                edgeWidthRatio: edgeWidthRatioLoc,
            },
            compositeProgram,
            compositeUniforms: {
                quadrantTexture: quadrantTextureLoc,
                fullResolution: fullResolutionLoc2,
                quadResolution: quadResolutionLoc2,
            },
            vao,
            framebuffer,
            quadrantTexture,
            canvas,
            maxTextureSize,
            currentQuadWidth: 1,
            currentQuadHeight: 1,
        };
    } catch (error) {
        console.warn('WebGL2 initialization failed:', error);
        return null;
    }
}

async function ensureWebGL2Context(): Promise<WebGL2QuadContext | null> {
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
 * Check if WebGL2 is supported
 */
export function isWebGL2Supported(): boolean {
    if (_gl2Supported !== null) return _gl2Supported;

    if (typeof WebGL2RenderingContext === 'undefined') {
        _gl2Supported = false;
        return false;
    }

    return true;
}

/**
 * Check if WebGL2 context is ready
 */
export function isWebGL2Ready(): boolean {
    return _gl2Context !== null;
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
 * Uses quadrant optimization: renders 1/4 of pixels, composites to full.
 * Returns null if WebGL2 is not supported.
 */
export async function generateWebGL2DisplacementMap(
    options: CanvasDisplacementOptions
): Promise<CanvasDisplacementResult | null> {
    const ctx = await ensureWebGL2Context();
    if (!ctx) return null;

    return generateWebGL2DisplacementMapInternal(ctx, options);
}

/**
 * Generate displacement map using WebGL2 (sync)
 *
 * Returns null if WebGL2 context is not ready.
 * Use async version for guaranteed result.
 */
export function generateWebGL2DisplacementMapSync(
    options: CanvasDisplacementOptions
): CanvasDisplacementResult | null {
    if (!_gl2Context) return null;
    return generateWebGL2DisplacementMapInternal(_gl2Context, options);
}

function generateWebGL2DisplacementMapInternal(
    ctx: WebGL2QuadContext,
    options: CanvasDisplacementOptions
): CanvasDisplacementResult {
    const { width, height, borderRadius, edgeWidthRatio = 0.5 } = options;
    const startTime = performance.now();

    const { gl, quadrantProgram, quadrantUniforms, compositeProgram, compositeUniforms,
            vao, framebuffer, quadrantTexture, canvas, maxTextureSize } = ctx;

    // Clamp to max texture size
    const fullWidth = Math.min(width, maxTextureSize);
    const fullHeight = Math.min(height, maxTextureSize);

    // Calculate quadrant dimensions (ceiling for odd dimensions)
    const quadWidth = Math.ceil(fullWidth / 2);
    const quadHeight = Math.ceil(fullHeight / 2);

    // =========================================================================
    // Pass 1: Render quadrant to framebuffer
    // =========================================================================

    // Resize quadrant texture if needed
    if (ctx.currentQuadWidth !== quadWidth || ctx.currentQuadHeight !== quadHeight) {
        gl.bindTexture(gl.TEXTURE_2D, quadrantTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, quadWidth, quadHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        ctx.currentQuadWidth = quadWidth;
        ctx.currentQuadHeight = quadHeight;
    }

    // Bind framebuffer for quadrant rendering
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, quadWidth, quadHeight);

    // Use quadrant program
    gl.useProgram(quadrantProgram);

    // Set uniforms
    gl.uniform2f(quadrantUniforms.quadResolution, quadWidth, quadHeight);
    gl.uniform2f(quadrantUniforms.fullResolution, fullWidth, fullHeight);
    gl.uniform1f(quadrantUniforms.borderRadius, borderRadius);
    gl.uniform1f(quadrantUniforms.edgeWidthRatio, edgeWidthRatio);

    // Draw quadrant
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // =========================================================================
    // Pass 2: Composite to full resolution
    // =========================================================================

    // Resize canvas if needed
    if (canvas.width !== fullWidth || canvas.height !== fullHeight) {
        canvas.width = fullWidth;
        canvas.height = fullHeight;
    }

    // Unbind framebuffer (render to canvas)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, fullWidth, fullHeight);

    // Use composite program
    gl.useProgram(compositeProgram);

    // Bind quadrant texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, quadrantTexture);
    gl.uniform1i(compositeUniforms.quadrantTexture, 0);

    // Set uniforms
    gl.uniform2f(compositeUniforms.fullResolution, fullWidth, fullHeight);
    gl.uniform2f(compositeUniforms.quadResolution, quadWidth, quadHeight);

    // Draw full-screen composite
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    // Ensure rendering is complete
    gl.finish();

    // =========================================================================
    // Read pixels to output canvas
    // =========================================================================

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = fullWidth;
    outputCanvas.height = fullHeight;
    const outputCtx = outputCanvas.getContext('2d')!;

    // Read pixels from WebGL
    const pixels = new Uint8Array(fullWidth * fullHeight * 4);
    gl.readPixels(0, 0, fullWidth, fullHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // WebGL has Y=0 at bottom, Canvas has Y=0 at top - flip vertically
    const imageData = outputCtx.createImageData(fullWidth, fullHeight);
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
        canvas: outputCanvas,
        dataUrl: outputCanvas.toDataURL('image/png'),
        generationTime,
    };
}

/**
 * Clean up WebGL2 resources
 */
export function destroyWebGL2Context(): void {
    if (_gl2Context) {
        const { gl, quadrantProgram, compositeProgram, vao, framebuffer, quadrantTexture } = _gl2Context;
        gl.deleteTexture(quadrantTexture);
        gl.deleteFramebuffer(framebuffer);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(quadrantProgram);
        gl.deleteProgram(compositeProgram);
        _gl2Context = null;
    }
    _gl2Supported = null;
    _gl2Initializing = null;
}

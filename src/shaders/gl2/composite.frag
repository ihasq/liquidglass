#version 300 es
precision highp float;

uniform sampler2D u_quadrantTexture;  // BR quadrant texture
uniform vec2 u_fullResolution;        // (fullWidth, fullHeight)
uniform vec2 u_quadResolution;        // (quadWidth, quadHeight)

out vec4 fragColor;

// ============================================================================
// Quadrant compositing
//
// Reads from the quadrant texture and composites to full resolution,
// applying channel inversions for each quadrant position.
//
// Quadrant layout:
// +--------+--------+
// |   TL   |   TR   |  TL: R'=1-R, G'=1-G (X+Y invert)
// |(-X,-Y) |(+X,-Y) |  TR: G'=1-G (Y invert only)
// +--------+--------+
// |   BL   |   BR   |  BL: R'=1-R (X invert only)
// |(-X,+Y) |(+X,+Y) |  BR: original quadrant
// +--------+--------+
// ============================================================================

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
    float qx;
    float qy;
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

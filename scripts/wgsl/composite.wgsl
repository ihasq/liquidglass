// Quadrant compositing shader for WebGPU displacement map generation
//
// Reads from the bottom-right quadrant texture and composites to full resolution,
// applying channel inversions for each quadrant position.
//
// Quadrant layout (same as WASM quad implementation):
// +--------+--------+
// |   TL   |   TR   |  TL: R'=1-R, G'=1-G (X+Y invert)
// |(-X,-Y) |(+X,-Y) |  TR: G'=1-G (Y invert only)
// +--------+--------+
// |   BL   |   BR   |  BL: R'=1-R (X invert only)
// |(-X,+Y) |(+X,+Y) |  BR: original quadrant
// +--------+--------+

struct Uniforms {
    u_fullResolution: vec2<f32>,
    u_quadResolution: vec2<f32>,
}

struct FragmentOutput {
    @location(0) fragColor: vec4<f32>,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

@group(0) @binding(1)
var quadrantTexture: texture_2d<f32>;

@group(0) @binding(2)
var quadrantSampler: sampler;

@fragment
fn main(@builtin(position) fragCoord: vec4<f32>) -> FragmentOutput {
    let fullWidth = uniforms.u_fullResolution.x;
    let fullHeight = uniforms.u_fullResolution.y;
    let quadWidth = uniforms.u_quadResolution.x;
    let quadHeight = uniforms.u_quadResolution.y;

    // Pixel position (0-indexed)
    let px = fragCoord.x - 0.5;
    let py = fragCoord.y - 0.5;

    // Center position (matches WASM: floor(width/2), floor(height/2))
    let centerX = floor(fullWidth * 0.5);
    let centerY = floor(fullHeight * 0.5);

    // =========================================================================
    // Determine which quadrant this pixel belongs to (in WASM coordinate space)
    //
    // WebGPU Y=0 at top (same as Canvas/WASM), no flip needed.
    //
    // WASM quadrant definition:
    // - Bottom half: py >= centerY (BR, BL)
    // - Top half:    py < centerY (TR, TL)
    // =========================================================================
    let isRight = px >= centerX;
    let isBottom = py >= centerY;

    // Calculate quadrant texture coordinates
    var qx: f32;
    var qy: f32;
    var invertR = false;
    var invertG = false;

    if (isRight && isBottom) {
        // BR quadrant: direct copy
        qx = px - centerX;
        qy = py - centerY;
    } else if (!isRight && isBottom) {
        // BL quadrant: X-mirrored, invert R
        qx = centerX - 1.0 - px;
        qy = py - centerY;
        invertR = true;
    } else if (isRight && !isBottom) {
        // TR quadrant: Y-mirrored, invert G
        qx = px - centerX;
        qy = centerY - 1.0 - py;
        invertG = true;
    } else {
        // TL quadrant: X+Y mirrored, invert R and G
        qx = centerX - 1.0 - px;
        qy = centerY - 1.0 - py;
        invertR = true;
        invertG = true;
    }

    // Clamp to valid quadrant range
    qx = clamp(qx, 0.0, quadWidth - 1.0);
    qy = clamp(qy, 0.0, quadHeight - 1.0);

    // Sample quadrant texture (add 0.5 for texel center)
    let texCoord = (vec2<f32>(qx, qy) + 0.5) / uniforms.u_quadResolution;
    var quadColor = textureSample(quadrantTexture, quadrantSampler, texCoord);

    // Apply channel inversions
    var r = quadColor.r;
    var g = quadColor.g;

    if (invertR) {
        // Invert R channel: 1.0 - r (in normalized space)
        r = 1.0 - r;
    }
    if (invertG) {
        // Invert G channel
        g = 1.0 - g;
    }

    return FragmentOutput(vec4<f32>(r, g, quadColor.b, quadColor.a));
}

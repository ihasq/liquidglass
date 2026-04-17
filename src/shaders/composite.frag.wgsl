/**
 * Quadrant compositing (Pass 2)
 *
 * Reads from the quadrant texture and composites to full resolution,
 * applying channel inversions for each quadrant position.
 *
 * Coordinate system: Y=0 at top (WebGPU/Vulkan/D3D convention)
 * @webgl2-y-flip - This shader contains Y-axis dependent logic
 *
 * Quadrant layout:
 * +--------+--------+
 * |   TL   |   TR   |  TL: R'=1-R, G'=1-G (X+Y invert)
 * |(-X,-Y) |(+X,-Y) |  TR: G'=1-G (Y invert only)
 * +--------+--------+
 * |   BL   |   BR   |  BL: R'=1-R (X invert only)
 * |(-X,+Y) |(+X,+Y) |  BR: original quadrant
 * +--------+--------+
 */

struct Uniforms {
    u_fullResolution: vec2<f32>,
    u_quadResolution: vec2<f32>,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

@group(0) @binding(1)
var quadrantTexture: texture_2d<f32>;

@group(0) @binding(2)
var quadrantSampler: sampler;

@fragment
fn main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    let fullWidth = uniforms.u_fullResolution.x;
    let fullHeight = uniforms.u_fullResolution.y;
    let quadWidth = uniforms.u_quadResolution.x;
    let quadHeight = uniforms.u_quadResolution.y;

    let px = fragCoord.x - 0.5;
    let py = fragCoord.y - 0.5;

    let centerX = floor(fullWidth * 0.5);
    let centerY = floor(fullHeight * 0.5);

    // Y=0 at top: py >= centerY means bottom half
    let isRight = px >= centerX;
    let isBottom = py >= centerY;

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

    qx = clamp(qx, 0.0, quadWidth - 1.0);
    qy = clamp(qy, 0.0, quadHeight - 1.0);

    let texCoord = (vec2<f32>(qx, qy) + 0.5) / uniforms.u_quadResolution;
    var quadColor = textureSample(quadrantTexture, quadrantSampler, texCoord);

    var r = quadColor.r;
    var g = quadColor.g;

    if (invertR) {
        r = 1.0 - r;
    }
    if (invertG) {
        g = 1.0 - g;
    }

    return vec4<f32>(r, g, quadColor.b, quadColor.a);
}

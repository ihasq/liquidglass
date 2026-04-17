/**
 * Instanced fragment shader for quadrant compositing
 *
 * Samples from the quadrant texture using interpolated localUV,
 * applying UV mirroring and channel inversions based on quadrant ID.
 *
 * Quadrant layout:
 * +--------+--------+
 * |   TL   |   TR   |  TL(0): mirror X+Y, invert R+G
 * |(-X,-Y) |(+X,-Y) |  TR(1): mirror Y, invert G
 * +--------+--------+
 * |   BL   |   BR   |  BL(2): mirror X, invert R
 * |(-X,+Y) |(+X,+Y) |  BR(3): direct copy
 * +--------+--------+
 */

@group(0) @binding(0) var quadrantTexture: texture_2d<f32>;
@group(0) @binding(1) var quadrantSampler: sampler;

@fragment
fn main(
    @location(0) @interpolate(flat) quadrantId: u32,
    @location(1) localUV: vec2<f32>
) -> @location(0) vec4<f32> {
    var uv = localUV;

    // Mirror UV based on quadrant
    // TL(0): mirror X+Y, TR(1): mirror Y, BL(2): mirror X, BR(3): direct
    let mirrorX = (quadrantId & 1u) == 0u;  // TL, BL
    let mirrorY = quadrantId < 2u;           // TL, TR

    if (mirrorX) { uv.x = 1.0 - uv.x; }
    if (mirrorY) { uv.y = 1.0 - uv.y; }

    // Sample quadrant texture
    var color = textureSample(quadrantTexture, quadrantSampler, uv);

    // Invert channels based on quadrant
    let invertR = (quadrantId & 1u) == 0u;  // TL, BL
    let invertG = quadrantId < 2u;           // TL, TR

    if (invertR) { color.r = 1.0 - color.r; }
    if (invertG) { color.g = 1.0 - color.g; }

    return color;
}

/**
 * Quadrant displacement computation (Pass 1) - Texture-based LUT
 *
 * Uses 1D texture sampling for displacement profiles.
 * Hardware bilinear filtering provides smooth interpolation.
 *
 * Profile selection via texture array or atlas:
 * - 6 profiles packed into a single 256x6 texture
 * - Row index selects profile (0-5)
 *
 * RGB encoding:
 * - R channel: X displacement (128 = none, <128 = left, >128 = right)
 * - G channel: Y displacement (128 = none, <128 = up, >128 = down)
 * - B channel: unused (128)
 * - A channel: 255
 */

struct Uniforms {
    u_quadResolution: vec2<f32>,
    u_fullResolution: vec2<f32>,
    u_borderRadius: f32,
    u_edgeWidthRatio: f32,
    u_profile: u32,  // 0=exponential, 1=squircle, 2=circle, 3=parabolic, 4=cosine, 5=linear
    _pad: u32,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

@group(0) @binding(1)
var lutTexture: texture_2d<f32>;

@group(0) @binding(2)
var lutSampler: sampler;

// Sample displacement magnitude from LUT texture
fn getMagnitude(normalizedDist: f32, profile: u32) -> f32 {
    // t: 0 = edge (no displacement), 1 = center (max displacement)
    // LUT is indexed with 1-t so that t=0 maps to LUT[255] (edge) and t=1 maps to LUT[0] (center)
    let t = 1.0 - normalizedDist;

    // UV coordinates: x = sample position, y = profile row
    let u = clamp(t, 0.0, 1.0);
    let v = (f32(profile) + 0.5) / 6.0;  // Center of each row

    return textureSample(lutTexture, lutSampler, vec2<f32>(u, v)).r;
}

@fragment
fn main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    let quadWidth = uniforms.u_quadResolution.x;
    let quadHeight = uniforms.u_quadResolution.y;
    let fullWidth = uniforms.u_fullResolution.x;
    let fullHeight = uniforms.u_fullResolution.y;

    let halfW = fullWidth * 0.5;
    let halfH = fullHeight * 0.5;
    let minHalf = min(halfW, halfH);
    let edgeWidth = minHalf * uniforms.u_edgeWidthRatio;
    let r = min(uniforms.u_borderRadius, minHalf);

    let cornerThresholdX = halfW - r;
    let cornerThresholdY = halfH - r;

    let qx = fragCoord.x - 0.5;
    let qy = fragCoord.y - 0.5;

    let dx = qx;
    let dy = qy;

    let inCornerX = dx > cornerThresholdX;
    let inCornerY = dy > cornerThresholdY;
    let inCorner = inCornerX && inCornerY;

    var distFromEdge: f32 = 0.0;
    var dirX: f32 = 0.0;
    var dirY: f32 = 0.0;

    if (inCorner) {
        let cornerX = dx - cornerThresholdX;
        let cornerY = dy - cornerThresholdY;
        let cornerDist = sqrt(cornerX * cornerX + cornerY * cornerY);

        distFromEdge = r - cornerDist;

        if (cornerDist > 0.001) {
            let invDist = 1.0 / cornerDist;
            dirX = cornerX * invDist;
            dirY = cornerY * invDist;
        }
    } else {
        let distX = halfW - dx;
        let distY = halfH - dy;

        if (distX < distY) {
            distFromEdge = distX;
            dirX = 1.0;
        } else {
            distFromEdge = distY;
            dirY = 1.0;
        }
    }

    let clampedDist = max(distFromEdge, 0.0);
    let normalizedDist = clamp(clampedDist / edgeWidth, 0.0, 1.0);
    let magnitude = getMagnitude(normalizedDist, uniforms.u_profile);

    let dispX = -dirX * magnitude;
    let dispY = -dirY * magnitude;

    let rVal = clamp(floor(128.0 + dispX * 127.0), 0.0, 255.0) / 255.0;
    let gVal = clamp(floor(128.0 + dispY * 127.0), 0.0, 255.0) / 255.0;

    return vec4<f32>(rVal, gVal, 128.0 / 255.0, 1.0);
}

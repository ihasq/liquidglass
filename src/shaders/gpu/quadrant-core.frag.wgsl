/**
 * Quadrant displacement computation (Pass 1) - Core logic
 *
 * This file contains the main shader logic WITHOUT LUT data.
 * LUT data is injected at build time via vite-plugin-lut-inline.
 *
 * Uses pre-computed LUTs for profile functions instead of runtime exp().
 * Profile selection: 0=exponential, 1=squircle, 2=circle, 3=parabolic, 4=cosine, 5=linear
 */

struct Uniforms {
    u_quadResolution: vec2<f32>,
    u_fullResolution: vec2<f32>,
    u_borderRadius: f32,
    u_edgeWidthRatio: f32,
    u_profile: u32,
    _pad: u32,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

// LUT constants are injected here by build process
// Expected: const LUT_SAMPLES, LUT_EXPONENTIAL, LUT_SQUIRCLE, etc.
// See: src/displacement/luts/generated-luts.wgsl

// Get magnitude from selected profile LUT
fn getMagnitude(normalizedDist: f32, profile: u32) -> f32 {
    var lut: array<f32, 256>;
    switch (profile) {
        case 0u: { lut = LUT_EXPONENTIAL; }
        case 1u: { lut = LUT_SQUIRCLE; }
        case 2u: { lut = LUT_CIRCLE; }
        case 3u: { lut = LUT_PARABOLIC; }
        case 4u: { lut = LUT_COSINE; }
        case 5u: { lut = LUT_LINEAR; }
        default: { lut = LUT_EXPONENTIAL; }
    }

    let t = 1.0 - normalizedDist;
    let clampedT = clamp(t, 0.0, 1.0);
    let scaledT = clampedT * 255.0;
    let idx0 = u32(floor(scaledT));
    let idx1 = min(idx0 + 1u, 255u);
    let frac = scaledT - floor(scaledT);
    return mix(lut[idx0], lut[idx1], frac);
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

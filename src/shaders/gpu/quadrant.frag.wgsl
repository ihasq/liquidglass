/**
 * Quadrant displacement computation (Pass 1)
 *
 * Computes displacement for the BOTTOM-RIGHT quadrant only.
 * The quadrant is symmetric, so other quadrants are derived by mirroring.
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
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

const LOG2E: f32 = 1.4426950408889634;
const LN2: f32 = 0.6931471805599453;

fn fastExp(x: f32) -> f32 {
    if (x < -87.0) { return 0.0; }
    if (x > 0.0) { return 1.0; }

    let k = floor(x * LOG2E);
    let r = x - k * LN2;

    let r2 = r * r;
    let r3 = r2 * r;
    let r4 = r2 * r2;
    let expR = 1.0 + r + r2 * 0.5 + r3 * 0.16666667 + r4 * 0.04166667;

    return expR * exp2(k);
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

    let negThreeOverEdgeWidth = -3.0 / edgeWidth;
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
    let expArg = clampedDist * negThreeOverEdgeWidth;
    let magnitude = fastExp(expArg);

    let dispX = -dirX * magnitude;
    let dispY = -dirY * magnitude;

    let rVal = clamp(floor(128.0 + dispX * 127.0), 0.0, 255.0) / 255.0;
    let gVal = clamp(floor(128.0 + dispY * 127.0), 0.0, 255.0) / 255.0;

    return vec4<f32>(rVal, gVal, 128.0 / 255.0, 1.0);
}

#version 300 es
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

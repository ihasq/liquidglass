#version 450
precision highp float;

layout(location = 0) out vec4 fragColor;

layout(set = 0, binding = 0) uniform Uniforms {
    vec2 u_quadResolution;   // (quadWidth, quadHeight)
    vec2 u_fullResolution;   // (fullWidth, fullHeight)
    float u_borderRadius;    // border radius in pixels
    float u_edgeWidthRatio;  // edge width as ratio of min dimension
};

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
    float qx = fragCoord.x - 0.5;
    float qy = fragCoord.y - 0.5;

    // Distance from center (BR quadrant)
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
            dirX = cornerX * invDist;
            dirY = cornerY * invDist;
        }
    } else {
        float distX = halfW - dx;
        float distY = halfH - dy;

        if (distX < distY) {
            distFromEdge = distX;
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
    float rVal = clamp(floor(128.0 + dispX * 127.0), 0.0, 255.0) / 255.0;
    float gVal = clamp(floor(128.0 + dispY * 127.0), 0.0, 255.0) / 255.0;

    fragColor = vec4(rVal, gVal, 128.0 / 255.0, 1.0);
}

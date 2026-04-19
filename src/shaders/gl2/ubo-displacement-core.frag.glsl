#version 300 es
/**
 * UBO-based displacement map fragment shader for WebGL2 - Core logic
 *
 * LUT data is injected via #include directive at build time.
 * Profile selection: 0=exponential, 1=squircle, 2=circle, 3=parabolic, 4=cosine, 5=linear
 */

precision highp float;

layout(std140) uniform Params {
    vec4 resRadius;  // xy = resolution, z = borderRadius, w = profile
    float edge;      // edgeWidthRatio
};

out vec4 fragColor;

// LUT data injected here via #include
#include "../../displacement/luts/generated-luts.glsl"

// Get magnitude from selected profile LUT
float getMagnitude(float normalizedDist, int profile) {
    float t = 1.0 - normalizedDist;
    if (profile == 1) return sampleDisplacementLUT(LUT_SQUIRCLE, t);
    if (profile == 2) return sampleDisplacementLUT(LUT_CIRCLE, t);
    if (profile == 3) return sampleDisplacementLUT(LUT_PARABOLIC, t);
    if (profile == 4) return sampleDisplacementLUT(LUT_COSINE, t);
    if (profile == 5) return sampleDisplacementLUT(LUT_LINEAR, t);
    return sampleDisplacementLUT(LUT_EXPONENTIAL, t);  // default: 0 or unknown
}

void main() {
    float halfW = resRadius.x * 0.5;
    float halfH = resRadius.y * 0.5;
    float minHalf = min(halfW, halfH);
    float r = min(resRadius.z, minHalf);
    float edgeWidth = minHalf * edge;
    float ctX = halfW - r;
    float ctY = halfH - r;
    int profile = int(resRadius.w);

    float px = gl_FragCoord.x - 0.5;
    // Flip Y: WebGL has Y=0 at bottom, canvas has Y=0 at top
    float py = (resRadius.y - gl_FragCoord.y) - 0.5;
    float dx = abs(px - halfW + 0.5);
    float dy = abs(py - halfH + 0.5);
    float sx = px >= halfW ? 1.0 : -1.0;
    float sy = py >= halfH ? 1.0 : -1.0;

    float dist;
    float dirX = 0.0;
    float dirY = 0.0;

    if (dx > ctX && dy > ctY) {
        float cx = dx - ctX;
        float cy = dy - ctY;
        float cd = sqrt(cx * cx + cy * cy);
        dist = r - cd;
        if (cd > 0.001) {
            float inv = 1.0 / cd;
            dirX = cx * inv * sx;
            dirY = cy * inv * sy;
        }
    } else {
        float distX = halfW - dx;
        float distY = halfH - dy;
        if (distX < distY) {
            dist = distX;
            dirX = sx;
        } else {
            dist = distY;
            dirY = sy;
        }
    }

    float normalizedDist = clamp(max(dist, 0.0) / edgeWidth, 0.0, 1.0);
    float mag = getMagnitude(normalizedDist, profile);
    float dispX = -dirX * mag;
    float dispY = -dirY * mag;

    fragColor = vec4(
        clamp(floor(128.0 + dispX * 127.0), 0.0, 255.0) / 255.0,
        clamp(floor(128.0 + dispY * 127.0), 0.0, 255.0) / 255.0,
        0.5,
        1.0
    );
}

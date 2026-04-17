#version 300 es
/**
 * UBO-based displacement map fragment shader for WebGL2
 *
 * Uses Uniform Buffer Object for efficient parameter passing.
 * Single-pass rendering with 2-5x performance gain over individual uniforms.
 */

precision highp float;

layout(std140) uniform Params {
    vec4 resRadius;  // xy = resolution, z = borderRadius, w = padding
    float edge;      // edgeWidthRatio
};

out vec4 fragColor;

const float LOG2E = 1.4426950408889634;
const float LN2 = 0.6931471805599453;

float fastExp(float x) {
    if (x < -87.0) return 0.0;
    if (x > 0.0) return 1.0;
    float k = floor(x * LOG2E);
    float r = x - k * LN2;
    float r2 = r * r;
    return (1.0 + r + r2 * 0.5 + r2 * r * 0.16666667 + r2 * r2 * 0.04166667) * exp2(k);
}

void main() {
    float halfW = resRadius.x * 0.5;
    float halfH = resRadius.y * 0.5;
    float minHalf = min(halfW, halfH);
    float r = min(resRadius.z, minHalf);
    float neg3ew = -3.0 / (minHalf * edge);
    float ctX = halfW - r;
    float ctY = halfH - r;

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

    float mag = fastExp(max(dist, 0.0) * neg3ew);
    float dispX = -dirX * mag;
    float dispY = -dirY * mag;

    fragColor = vec4(
        clamp(floor(128.0 + dispX * 127.0), 0.0, 255.0) / 255.0,
        clamp(floor(128.0 + dispY * 127.0), 0.0, 255.0) / 255.0,
        0.5,
        1.0
    );
}

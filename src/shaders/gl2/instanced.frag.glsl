#version 300 es
/**
 * Instanced fragment shader for WebGL2 quadrant compositing
 *
 * Samples from quadrant texture with UV mirroring and channel inversion.
 */

precision highp float;

uniform sampler2D u_quadrantTexture;

flat in uint v_quadrantId;
in vec2 v_localUV;

out vec4 fragColor;

void main() {
    vec2 uv = v_localUV;

    // Mirror UV based on quadrant
    // TL(0): mirror X+Y, TR(1): mirror Y, BL(2): mirror X, BR(3): direct
    bool mirrorX = (v_quadrantId & 1u) == 0u;
    bool mirrorY = v_quadrantId < 2u;

    if (mirrorX) { uv.x = 1.0 - uv.x; }
    if (mirrorY) { uv.y = 1.0 - uv.y; }

    vec4 color = texture(u_quadrantTexture, uv);

    // Invert channels based on quadrant
    bool invertR = (v_quadrantId & 1u) == 0u;
    bool invertG = v_quadrantId < 2u;

    if (invertR) { color.r = 1.0 - color.r; }
    if (invertG) { color.g = 1.0 - color.g; }

    fragColor = color;
}

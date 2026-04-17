#version 300 es
/**
 * Instanced vertex shader for WebGL2 quadrant compositing (TRIANGLE STRIP)
 *
 * Uses gl_InstanceID for 4 quadrant instances.
 * 4 vertices per instance (triangle strip).
 */

flat out uint v_quadrantId;
out vec2 v_localUV;

void main() {
    int vi = gl_VertexID;
    int ii = gl_InstanceID;

    // Triangle strip: TL, TR, BL, BR (4 vertices)
    vec2 stripVerts[4] = vec2[4](
        vec2(0.0, 0.0),  // TL
        vec2(1.0, 0.0),  // TR
        vec2(0.0, 1.0),  // BL
        vec2(1.0, 1.0)   // BR
    );

    vec2 localPos = stripVerts[vi];

    // Quadrant position: 0=TL, 1=TR, 2=BL, 3=BR
    float quadX = float(ii & 1);
    float quadY = float(ii >> 1);

    // Map to clip space [-1, 1]
    vec2 clipPos;
    clipPos.x = (localPos.x + quadX) - 1.0;
    clipPos.y = 1.0 - (localPos.y + quadY);

    gl_Position = vec4(clipPos, 0.0, 1.0);
    v_quadrantId = uint(ii);
    v_localUV = localPos;
}

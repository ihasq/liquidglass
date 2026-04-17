#version 300 es
/**
 * UBO-based fullscreen vertex shader for WebGL2
 *
 * Uses Uniform Buffer Object for efficient parameter passing.
 * Generates a fullscreen triangle from 3 vertices without VBO.
 */

void main() {
    vec2 pos[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
}

#version 300 es
precision highp float;

// Full-screen triangle (no vertex buffer needed)
// Vertex IDs 0,1,2 map to corners covering [-1,1] clip space
void main() {
    // Generate clip-space coordinates from vertex ID
    // 0 -> (-1, -1), 1 -> (3, -1), 2 -> (-1, 3)
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    gl_Position = vec4(x, y, 0.0, 1.0);
}

#version 450

void main() {
    // Full-screen triangle from vertex ID
    // 0 -> (-1, -1), 1 -> (3, -1), 2 -> (-1, 3)
    float x = float((gl_VertexIndex & 1) << 2) - 1.0;
    float y = float((gl_VertexIndex & 2) << 1) - 1.0;
    gl_Position = vec4(x, y, 0.0, 1.0);
}

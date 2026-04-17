/**
 * Full-screen triangle vertex shader
 *
 * No vertex buffer needed - generates clip-space coordinates from vertex ID.
 * Vertex IDs 0,1,2 map to corners covering [-1,1] clip space.
 */

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
}

@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    // Generate clip-space coordinates from vertex ID
    // 0 -> (-1, -1), 1 -> (3, -1), 2 -> (-1, 3)
    let x = f32((vertexIndex & 1u) << 2u) - 1.0;
    let y = f32((vertexIndex & 2u) << 1u) - 1.0;
    return VertexOutput(vec4<f32>(x, y, 0.0, 1.0));
}

/**
 * Instanced vertex shader for quadrant compositing (TRIANGLE STRIP)
 *
 * Draws 4 instances using 4-vertex triangle strips.
 * 7.37x faster than single-pass at 1024x1024.
 *
 * Instance layout (Y=0 at top in screen space):
 * +--------+--------+
 * |   0    |   1    |  0: TL, 1: TR
 * +--------+--------+
 * |   2    |   3    |  2: BL, 3: BR
 * +--------+--------+
 */

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) @interpolate(flat) quadrantId: u32,
    @location(1) localUV: vec2<f32>,
}

@vertex
fn main(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
    // Triangle strip: TL, TR, BL, BR (4 vertices)
    var stripVerts = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),  // TL
        vec2<f32>(1.0, 0.0),  // TR
        vec2<f32>(0.0, 1.0),  // BL
        vec2<f32>(1.0, 1.0)   // BR
    );

    let localPos = stripVerts[vertexIndex];

    // Quadrant position: 0=TL, 1=TR, 2=BL, 3=BR
    let quadX = f32(instanceIndex & 1u);
    let quadY = f32(instanceIndex >> 1u);

    // Map to clip space [-1, 1]
    var clipPos: vec2<f32>;
    clipPos.x = (localPos.x + quadX) - 1.0;
    clipPos.y = 1.0 - (localPos.y + quadY);

    var output: VertexOutput;
    output.position = vec4<f32>(clipPos, 0.0, 1.0);
    output.quadrantId = instanceIndex;
    output.localUV = localPos;
    return output;
}

struct Uniforms {
    u_quadResolution: vec2<f32>,
    u_fullResolution: vec2<f32>,
    u_borderRadius: f32,
    u_edgeWidthRatio: f32,
}

struct FragmentOutput {
    @location(0) fragColor: vec4<f32>,
}

const LOG2E: f32 = 1.442695f;
const LN2_: f32 = 0.6931472f;

var<private> fragColor: vec4<f32>;
@group(0) @binding(0) 
var<uniform> global: Uniforms;
var<private> gl_FragCoord_1: vec4<f32>;

fn fastExp(x: f32) -> f32 {
    var x_1: f32;
    var k: f32;
    var r: f32;
    var r2_: f32;
    var r3_: f32;
    var r4_: f32;
    var expR: f32;

    x_1 = x;
    let _e13 = x_1;
    if (_e13 < -87f) {
        return 0f;
    }
    let _e18 = x_1;
    if (_e18 > 0f) {
        return 1f;
    }
    let _e22 = x_1;
    k = floor((_e22 * LOG2E));
    let _e26 = x_1;
    let _e27 = k;
    r = (_e26 - (_e27 * LN2_));
    let _e31 = r;
    let _e32 = r;
    r2_ = (_e31 * _e32);
    let _e35 = r2_;
    let _e36 = r;
    r3_ = (_e35 * _e36);
    let _e39 = r2_;
    let _e40 = r2_;
    r4_ = (_e39 * _e40);
    let _e44 = r;
    let _e46 = r2_;
    let _e50 = r3_;
    let _e54 = r4_;
    expR = ((((1f + _e44) + (_e46 * 0.5f)) + (_e50 * 0.16666667f)) + (_e54 * 0.04166667f));
    let _e59 = expR;
    let _e60 = k;
    return (_e59 * exp2(_e60));
}

fn main_1() {
    var fragCoord: vec2<f32>;
    var quadWidth: f32;
    var quadHeight: f32;
    var fullWidth: f32;
    var fullHeight: f32;
    var halfW: f32;
    var halfH: f32;
    var minHalf: f32;
    var edgeWidth: f32;
    var r_1: f32;
    var negThreeOverEdgeWidth: f32;
    var cornerThresholdX: f32;
    var cornerThresholdY: f32;
    var qx: f32;
    var qy: f32;
    var dx: f32;
    var dy: f32;
    var inCornerX: bool;
    var inCornerY: bool;
    var inCorner: bool;
    var distFromEdge: f32 = 0f;
    var dirX: f32 = 0f;
    var dirY: f32 = 0f;
    var cornerX: f32;
    var cornerY: f32;
    var cornerDist: f32;
    var invDist: f32;
    var distX: f32;
    var distY: f32;
    var clampedDist: f32;
    var expArg: f32;
    var magnitude: f32;
    var dispX: f32;
    var dispY: f32;
    var rVal: f32;
    var gVal: f32;

    let _e12 = gl_FragCoord_1;
    fragCoord = _e12.xy;
    let _e15 = global.u_quadResolution;
    quadWidth = _e15.x;
    let _e18 = global.u_quadResolution;
    quadHeight = _e18.y;
    let _e21 = global.u_fullResolution;
    fullWidth = _e21.x;
    let _e24 = global.u_fullResolution;
    fullHeight = _e24.y;
    let _e27 = fullWidth;
    halfW = (_e27 * 0.5f);
    let _e31 = fullHeight;
    halfH = (_e31 * 0.5f);
    let _e35 = halfW;
    let _e36 = halfH;
    minHalf = min(_e35, _e36);
    let _e39 = minHalf;
    let _e40 = global.u_edgeWidthRatio;
    edgeWidth = (_e39 * _e40);
    let _e43 = global.u_borderRadius;
    let _e44 = minHalf;
    r_1 = min(_e43, _e44);
    let _e49 = edgeWidth;
    negThreeOverEdgeWidth = (-3f / _e49);
    let _e52 = halfW;
    let _e53 = r_1;
    cornerThresholdX = (_e52 - _e53);
    let _e56 = halfH;
    let _e57 = r_1;
    cornerThresholdY = (_e56 - _e57);
    let _e60 = fragCoord;
    qx = (_e60.x - 0.5f);
    let _e65 = fragCoord;
    qy = (_e65.y - 0.5f);
    let _e70 = qx;
    dx = _e70;
    let _e72 = qy;
    dy = _e72;
    let _e74 = dx;
    let _e75 = cornerThresholdX;
    inCornerX = (_e74 > _e75);
    let _e78 = dy;
    let _e79 = cornerThresholdY;
    inCornerY = (_e78 > _e79);
    let _e82 = inCornerX;
    let _e83 = inCornerY;
    inCorner = (_e82 && _e83);
    let _e92 = inCorner;
    if _e92 {
        {
            let _e93 = dx;
            let _e94 = cornerThresholdX;
            cornerX = (_e93 - _e94);
            let _e97 = dy;
            let _e98 = cornerThresholdY;
            cornerY = (_e97 - _e98);
            let _e101 = cornerX;
            let _e102 = cornerX;
            let _e104 = cornerY;
            let _e105 = cornerY;
            cornerDist = sqrt(((_e101 * _e102) + (_e104 * _e105)));
            let _e110 = r_1;
            let _e111 = cornerDist;
            distFromEdge = (_e110 - _e111);
            let _e113 = cornerDist;
            if (_e113 > 0.001f) {
                {
                    let _e117 = cornerDist;
                    invDist = (1f / _e117);
                    let _e120 = cornerX;
                    let _e121 = invDist;
                    dirX = (_e120 * _e121);
                    let _e123 = cornerY;
                    let _e124 = invDist;
                    dirY = (_e123 * _e124);
                }
            }
        }
    } else {
        {
            let _e126 = halfW;
            let _e127 = dx;
            distX = (_e126 - _e127);
            let _e130 = halfH;
            let _e131 = dy;
            distY = (_e130 - _e131);
            let _e134 = distX;
            let _e135 = distY;
            if (_e134 < _e135) {
                {
                    let _e137 = distX;
                    distFromEdge = _e137;
                    dirX = 1f;
                }
            } else {
                {
                    let _e139 = distY;
                    distFromEdge = _e139;
                    dirY = 1f;
                }
            }
        }
    }
    let _e141 = distFromEdge;
    clampedDist = max(_e141, 0f);
    let _e145 = clampedDist;
    let _e146 = negThreeOverEdgeWidth;
    expArg = (_e145 * _e146);
    let _e149 = expArg;
    let _e150 = fastExp(_e149);
    magnitude = _e150;
    let _e152 = dirX;
    let _e154 = magnitude;
    dispX = (-(_e152) * _e154);
    let _e157 = dirY;
    let _e159 = magnitude;
    dispY = (-(_e157) * _e159);
    let _e163 = dispX;
    rVal = (clamp(floor((128f + (_e163 * 127f))), 0f, 255f) / 255f);
    let _e175 = dispY;
    gVal = (clamp(floor((128f + (_e175 * 127f))), 0f, 255f) / 255f);
    let _e186 = rVal;
    let _e187 = gVal;
    fragColor = vec4<f32>(_e186, _e187, 0.5019608f, 1f);
    return;
}

@fragment 
fn main(@builtin(position) gl_FragCoord: vec4<f32>) -> FragmentOutput {
    gl_FragCoord_1 = gl_FragCoord;
    main_1();
    let _e17 = fragColor;
    return FragmentOutput(_e17);
}

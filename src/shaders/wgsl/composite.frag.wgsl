struct Uniforms {
    u_fullResolution: vec2<f32>,
    u_quadResolution: vec2<f32>,
}

struct FragmentOutput {
    @location(0) fragColor: vec4<f32>,
}

@group(0) @binding(0) 
var<uniform> global: Uniforms;
@group(0) @binding(1) 
var u_quadrantTexture: texture_2d<f32>;
@group(0) @binding(2) 
var u_quadrantTexture_sampler: sampler;
var<private> fragColor: vec4<f32>;
var<private> gl_FragCoord_1: vec4<f32>;

fn main_1() {
    var fragCoord: vec2<f32>;
    var fullWidth: f32;
    var fullHeight: f32;
    var quadWidth: f32;
    var quadHeight: f32;
    var px: f32;
    var py: f32;
    var centerX: f32;
    var centerY: f32;
    var isRight: bool;
    var isBottom: bool;
    var qx: f32;
    var qy: f32;
    var invertR: bool = false;
    var invertG: bool = false;
    var texCoord: vec2<f32>;
    var quadColor: vec4<f32>;
    var r: f32;
    var g: f32;

    let _e8 = gl_FragCoord_1;
    fragCoord = _e8.xy;
    let _e11 = global.u_fullResolution;
    fullWidth = _e11.x;
    let _e14 = global.u_fullResolution;
    fullHeight = _e14.y;
    let _e17 = global.u_quadResolution;
    quadWidth = _e17.x;
    let _e20 = global.u_quadResolution;
    quadHeight = _e20.y;
    let _e23 = fragCoord;
    px = (_e23.x - 0.5f);
    let _e28 = fragCoord;
    py = (_e28.y - 0.5f);
    let _e33 = fullWidth;
    centerX = floor((_e33 * 0.5f));
    let _e38 = fullHeight;
    centerY = floor((_e38 * 0.5f));
    let _e43 = px;
    let _e44 = centerX;
    isRight = (_e43 >= _e44);
    let _e47 = py;
    let _e48 = centerY;
    isBottom = (_e47 < _e48);
    let _e57 = isRight;
    let _e58 = isBottom;
    if (_e57 && _e58) {
        {
            let _e60 = px;
            let _e61 = centerX;
            qx = (_e60 - _e61);
            let _e63 = centerY;
            let _e66 = py;
            qy = ((_e63 - 1f) - _e66);
        }
    } else {
        let _e68 = isRight;
        let _e70 = isBottom;
        if (!(_e68) && _e70) {
            {
                let _e72 = centerX;
                let _e75 = px;
                qx = ((_e72 - 1f) - _e75);
                let _e77 = centerY;
                let _e80 = py;
                qy = ((_e77 - 1f) - _e80);
                invertR = true;
            }
        } else {
            let _e83 = isRight;
            let _e84 = isBottom;
            if (_e83 && !(_e84)) {
                {
                    let _e87 = px;
                    let _e88 = centerX;
                    qx = (_e87 - _e88);
                    let _e90 = py;
                    let _e91 = centerY;
                    qy = (_e90 - _e91);
                    invertG = true;
                }
            } else {
                {
                    let _e94 = centerX;
                    let _e97 = px;
                    qx = ((_e94 - 1f) - _e97);
                    let _e99 = py;
                    let _e100 = centerY;
                    qy = (_e99 - _e100);
                    invertR = true;
                    invertG = true;
                }
            }
        }
    }
    let _e104 = qx;
    let _e106 = quadWidth;
    qx = clamp(_e104, 0f, (_e106 - 1f));
    let _e110 = qy;
    let _e112 = quadHeight;
    qy = clamp(_e110, 0f, (_e112 - 1f));
    let _e116 = qx;
    let _e117 = qy;
    let _e122 = global.u_quadResolution;
    texCoord = ((vec2<f32>(_e116, _e117) + vec2(0.5f)) / _e122);
    let _e125 = texCoord;
    let _e126 = textureSample(u_quadrantTexture, u_quadrantTexture_sampler, _e125);
    quadColor = _e126;
    let _e128 = quadColor;
    r = _e128.x;
    let _e131 = quadColor;
    g = _e131.y;
    let _e134 = invertR;
    if _e134 {
        {
            let _e136 = r;
            r = (1f - _e136);
        }
    }
    let _e138 = invertG;
    if _e138 {
        {
            let _e140 = g;
            g = (1f - _e140);
        }
    }
    let _e142 = r;
    let _e143 = g;
    let _e144 = quadColor;
    let _e146 = quadColor;
    fragColor = vec4<f32>(_e142, _e143, _e144.z, _e146.w);
    return;
}

@fragment 
fn main(@builtin(position) gl_FragCoord: vec4<f32>) -> FragmentOutput {
    gl_FragCoord_1 = gl_FragCoord;
    main_1();
    let _e13 = fragColor;
    return FragmentOutput(_e13);
}

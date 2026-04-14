const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

const LEFT_BOUNDARY_BY_Y = [140,130,124,119,114,111,107,104,101,98,96,93,91,88,86,84,82,80,78,77,75,73,72,70,68,67,65,64,63,61,60,59,57,56,55,54,52,51,50,49,48,47,46,45,44,43,42,41,40,39,38,37,36,36,35,34,33,32,32,31,30,29,29,28,27,26,26,25,24,24,23,23,22,21,21,20,20,19,18,18,17,17,16,16,15,15,14,14,13,13,13,12,12,11,11,11,10,10,9,9,9,8,8,8,7,7,7,6,6,6,6,5,5,5,4,4,4,4,4,3,3,3,3,3,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0];

// Extract curves at different y values
console.log('Displacement curves (R - 128) at different y values:');
for (let y of [0, 10, 20, 30, 50, 100, 150]) {
  const boundary = LEFT_BOUNDARY_BY_Y[y];
  const curve = [];
  for (let d = 0; d < 50; d++) {
    const x = boundary + d;
    if (x >= width / 2) break;
    curve.push(getPixel(x, y).r - 128);
  }
  console.log(`y=${y.toString().padStart(3)} (boundary=${boundary.toString().padStart(3)}): ${curve.slice(0, 45).join(', ')}`);
}

// Extract a "normalized" curve where we scale by the max value
console.log('\n=== Normalized curves (scaled to max=127) ===');
for (let y of [0, 10, 20, 30, 50, 100, 150]) {
  const boundary = LEFT_BOUNDARY_BY_Y[y];
  const curve = [];
  for (let d = 0; d < 50; d++) {
    const x = boundary + d;
    if (x >= width / 2) break;
    curve.push(getPixel(x, y).r - 128);
  }
  const maxVal = Math.max(...curve);
  const normalized = curve.map(v => maxVal > 0 ? Math.round(v * 127 / maxVal) : 0);
  console.log(`y=${y.toString().padStart(3)} (max=${maxVal.toString().padStart(3)}): ${normalized.slice(0, 20).join(', ')}`);
}

// How many pixels before displacement drops to 0?
console.log('\n=== Curve length (pixels until R=128) ===');
for (let y = 0; y < 150; y += 5) {
  const boundary = LEFT_BOUNDARY_BY_Y[y];
  let curveLen = 0;
  for (let d = 0; d < 50; d++) {
    const x = boundary + d;
    if (x >= width / 2) break;
    if (getPixel(x, y).r === 128) break;
    curveLen = d + 1;
  }
  const maxDisp = getPixel(boundary, y).r - 128;
  console.log(`y=${y}: curveLen=${curveLen}, maxDisp=${maxDisp}`);
}

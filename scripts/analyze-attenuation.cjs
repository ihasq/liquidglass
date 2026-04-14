const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// At center row (y=150), extract displacement at each x
console.log('Center row (y=150) displacement (R - 128):');
const centerCurve = [];
for (let x = 0; x < 50; x++) {
  centerCurve.push(getPixel(x, 150).r - 128);
}
console.log(centerCurve.join(', '));

// At y=0 (corner), extract displacement at each x from boundary
console.log('\nTop row (y=0) displacement from boundary x=140:');
const topCurve = [];
for (let i = 0; i < 20; i++) {
  const x = 140 + i;
  topCurve.push(getPixel(x, 0).r - 128);
}
console.log(topCurve.join(', '));

// Compare: at y=0, the max displacement should be attenuated
console.log('\nAttenuation ratio at y=0 vs y=150 for same effective distance:');
for (let d = 0; d < 15; d++) {
  const centerR = getPixel(d, 150).r - 128;
  const topR = getPixel(140 + d, 0).r - 128;
  const ratio = centerR > 0 ? (topR / centerR).toFixed(3) : 'N/A';
  console.log(`dist=${d}: center=${centerR}, top=${topR}, ratio=${ratio}`);
}

// What's the attenuation factor at y=0?
// minDistTB = min(0, 299) = 0
// The attenuation might be based on this minDistTB value

// Let's check attenuation at different y values
console.log('\n=== Attenuation factor at different y (distance from top/bottom corner) ===');
for (let y = 0; y <= 150; y += 10) {
  const boundary = y < 150 ? [140,130,124,119,114,111,107,104,101,98,96,93,91,88,86,84,82,80,78,77,75,73,72,70,68,67,65,64,63,61,60,59,57,56,55,54,52,51,50,49,48,47,46,45,44,43,42,41,40,39,38,37,36,36,35,34,33,32,32,31,30,29,29,28,27,26,26,25,24,24,23,23,22,21,21,20,20,19,18,18,17,17,16,16,15,15,14,14,13,13,13,12,12,11,11,11,10,10,9,9,9,8,8,8,7,7,7,6,6,6,6,5,5,5,4,4,4,4,4,3,3,3,3,3,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0][y] : 0;
  
  // Get R at boundary point (effectiveDist=0)
  const rAtBoundary = getPixel(boundary, y).r - 128;
  const rAtCenter = 127; // Max at center
  const attenuation = rAtCenter > 0 ? (rAtBoundary / rAtCenter).toFixed(3) : 'N/A';
  console.log(`y=${y}, minDistTB=${Math.min(y, height - 1 - y)}, boundary=${boundary}, R-128=${rAtBoundary}, attenuation=${attenuation}`);
}

const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// For each minDist from top/bottom (0 to 149), find where R first becomes non-128 on left edge
// We'll use the top half of the image (y=0 to 149) where distTop = y
const boundaries = [];

for (let minDist = 0; minDist < 150; minDist++) {
  // At y=minDist, distTop=minDist, distBottom=299-minDist
  // We want to find where R first becomes non-128 on left edge
  const y = minDist;
  let firstX = -1;
  for (let x = 0; x < width / 2; x++) {
    if (getPixel(x, y).r !== 128) {
      firstX = x;
      break;
    }
  }
  boundaries.push(firstX === -1 ? 0 : firstX);
}

console.log('MIN_DIST_BOUNDARY (where R first becomes non-128 at given minDistTB):');
console.log('const MIN_DIST_BOUNDARY = [');
for (let i = 0; i < boundaries.length; i += 10) {
  const line = boundaries.slice(i, Math.min(i + 10, boundaries.length)).join(', ');
  console.log(`  ${line},`);
}
console.log('];');

// Also verify some key points
console.log('\nVerification:');
console.log(`y=0 (minDist=0): boundary=${boundaries[0]}`);
console.log(`y=30 (minDist=30): boundary=${boundaries[30]}`);
console.log(`y=60 (minDist=60): boundary=${boundaries[60]}`);
console.log(`y=150 center: boundary should be ~0`);

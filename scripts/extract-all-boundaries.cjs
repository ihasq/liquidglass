const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// For all y values in top half, extract where R first becomes non-128 from right edge
const rightBoundaries = [];
for (let y = 0; y < height / 2; y++) {
  let boundary = -1;
  for (let x = width - 1; x >= width / 2; x--) {
    if (getPixel(x, y).r !== 128) {
      boundary = width - 1 - x;
      break;
    }
  }
  rightBoundaries.push(boundary === -1 ? 0 : boundary);
}

// For bottom half (symmetric), use distBottom
const rightBoundariesByMinDist = [];
for (let minDist = 0; minDist < 150; minDist++) {
  // Use top half where minDistTB = distTop = y
  rightBoundariesByMinDist.push(rightBoundaries[minDist]);
}

console.log('RIGHT_EDGE_BOUNDARY (indexed by minDistTB):');
console.log('const RIGHT_BOUNDARY = [');
for (let i = 0; i < rightBoundariesByMinDist.length; i += 10) {
  const line = rightBoundariesByMinDist.slice(i, Math.min(i + 10, rightBoundariesByMinDist.length)).join(', ');
  console.log(`  ${line},`);
}
console.log('];');

// Verify key points
console.log('\nVerification:');
console.log(`minDist=110: boundary=${rightBoundariesByMinDist[110]}`);
console.log(`minDist=66: boundary=${rightBoundariesByMinDist[66]}`);

// Also check: at y=189, what is minDistTB?
// distTop=189, distBottom=299-189=110, min=110
console.log('\nAt y=189: minDistTB=110, right boundary should be', rightBoundariesByMinDist[110]);

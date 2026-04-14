const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Extract G boundary from top edge
const boundariesTop = [];
for (let minDist = 0; minDist < 150; minDist++) {
  const x = minDist;
  let firstY = -1;
  for (let y = 0; y < height / 2; y++) {
    if (getPixel(x, y).g !== 128) {
      firstY = y;
      break;
    }
  }
  boundariesTop.push(firstY === -1 ? 0 : firstY);
}

// Extract G boundary from bottom edge
const boundariesBottom = [];
for (let minDist = 0; minDist < 150; minDist++) {
  const x = minDist;
  let firstDistBottom = -1;
  for (let y = height - 1; y >= height / 2; y--) {
    if (getPixel(x, y).g !== 128) {
      firstDistBottom = height - 1 - y;
      break;
    }
  }
  boundariesBottom.push(firstDistBottom === -1 ? 0 : firstDistBottom);
}

console.log('G Boundary comparison (top vs bottom edge):');
console.log('minDist\tTop\tBottom\tDiff');
for (let i = 20; i < 40; i++) {
  const diff = boundariesTop[i] - boundariesBottom[i];
  console.log(`${i}\t${boundariesTop[i]}\t${boundariesBottom[i]}\t${diff}`);
}

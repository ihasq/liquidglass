const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Extract boundary from right edge (where R first becomes non-128)
const boundariesRight = [];

for (let minDist = 0; minDist < 150; minDist++) {
  const y = minDist;
  let firstDistRight = -1;
  for (let x = width - 1; x >= width / 2; x--) {
    if (getPixel(x, y).r !== 128) {
      firstDistRight = width - 1 - x;
      break;
    }
  }
  boundariesRight.push(firstDistRight === -1 ? 0 : firstDistRight);
}

// Compare with left edge
const boundariesLeft = [];
for (let minDist = 0; minDist < 150; minDist++) {
  const y = minDist;
  let firstX = -1;
  for (let x = 0; x < width / 2; x++) {
    if (getPixel(x, y).r !== 128) {
      firstX = x;
      break;
    }
  }
  boundariesLeft.push(firstX === -1 ? 0 : firstX);
}

console.log('Boundary comparison (left vs right edge):');
console.log('minDist\tLeft\tRight\tDiff');
for (let i = 60; i < 80; i++) {
  const diff = boundariesLeft[i] - boundariesRight[i];
  console.log(`${i}\t${boundariesLeft[i]}\t${boundariesRight[i]}\t${diff}`);
}

// Check specific case y=66
console.log(`\ny=66: left boundary=${boundariesLeft[66]}, right boundary=${boundariesRight[66]}`);

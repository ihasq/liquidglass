// Extract R channel boundary (where R becomes active on right edge)
const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// For each y value, find where R first becomes non-128 on the right edge
// (scanning from right edge inward)
console.log('=== R boundary (right edge, from right) ===');
console.log('y\tfirstActiveX\tdistRight');

const rBoundary = [];
for (let y = 0; y < height; y++) {
  let firstActiveX = -1;
  for (let x = width - 1; x >= width / 2; x--) {
    const p = getPixel(x, y);
    if (p.r !== 128) {
      firstActiveX = x;
      break;
    }
  }
  const distRight = firstActiveX === -1 ? -1 : width - 1 - firstActiveX;
  rBoundary.push(distRight);
  if (y < 80 || y >= height - 20) {
    console.log(`${y}\t${firstActiveX}\t${distRight}`);
  }
}

// Similarly for G boundary (top edge)
console.log('\n=== G boundary (top edge, from top) ===');
console.log('x\tfirstActiveY\tdistTop');

const gBoundary = [];
for (let x = 0; x < width; x++) {
  let firstActiveY = -1;
  for (let yy = 0; yy < height / 2; yy++) {
    const p = getPixel(x, yy);
    if (p.g !== 128) {
      firstActiveY = yy;
      break;
    }
  }
  gBoundary.push(firstActiveY === -1 ? -1 : firstActiveY);
  if (x < 30 || (x >= 130 && x <= 160) || x >= width - 30) {
    console.log(`${x}\t${firstActiveY}\t${firstActiveY}`);
  }
}

// Generate JavaScript array for R boundary
console.log('\n=== R boundary array (distRight where R first active) ===');
let rArr = 'const R_BOUNDARY = [';
for (let y = 0; y < height; y += 10) {
  rArr += '\n  ';
  for (let yy = y; yy < Math.min(y + 10, height); yy++) {
    rArr += `${rBoundary[yy]}, `;
  }
}
rArr += '\n];';
console.log(rArr);

// Check the specific error point
console.log('\n=== Verify error point (394, 66) ===');
const p = getPixel(394, 66);
console.log(`(394, 66): R=${p.r}, G=${p.g}`);
console.log(`R boundary at y=66: distRight=${rBoundary[66]}`);
console.log(`Actual distRight at x=394: ${width - 1 - 394}`);

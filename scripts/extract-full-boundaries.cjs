const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// For R channel: extract boundary at each y (where R first becomes non-128)
// Left edge
const leftBoundaryByY = [];
for (let y = 0; y < height; y++) {
  let boundary = -1;
  for (let x = 0; x < width / 2; x++) {
    if (getPixel(x, y).r !== 128) {
      boundary = x;
      break;
    }
  }
  leftBoundaryByY.push(boundary === -1 ? width : boundary);
}

// Right edge
const rightBoundaryByY = [];
for (let y = 0; y < height; y++) {
  let boundary = -1;
  for (let x = width - 1; x >= width / 2; x--) {
    if (getPixel(x, y).r !== 128) {
      boundary = width - 1 - x;
      break;
    }
  }
  rightBoundaryByY.push(boundary === -1 ? width : boundary);
}

// For G channel: extract boundary at each x
// Top edge
const topBoundaryByX = [];
for (let x = 0; x < width; x++) {
  let boundary = -1;
  for (let y = 0; y < height / 2; y++) {
    if (getPixel(x, y).g !== 128) {
      boundary = y;
      break;
    }
  }
  topBoundaryByX.push(boundary === -1 ? height : boundary);
}

// Bottom edge
const bottomBoundaryByX = [];
for (let x = 0; x < width; x++) {
  let boundary = -1;
  for (let y = height - 1; y >= height / 2; y--) {
    if (getPixel(x, y).g !== 128) {
      boundary = height - 1 - y;
      break;
    }
  }
  bottomBoundaryByX.push(boundary === -1 ? height : boundary);
}

// Output as arrays
console.log('// Left edge R boundary at each y');
console.log('const LEFT_BOUNDARY_BY_Y = [' + leftBoundaryByY.join(',') + '];');
console.log('');
console.log('// Right edge R boundary at each y');
console.log('const RIGHT_BOUNDARY_BY_Y = [' + rightBoundaryByY.join(',') + '];');
console.log('');
console.log('// Top edge G boundary at each x');
console.log('const TOP_BOUNDARY_BY_X = [' + topBoundaryByX.join(',') + '];');
console.log('');
console.log('// Bottom edge G boundary at each x');
console.log('const BOTTOM_BOUNDARY_BY_X = [' + bottomBoundaryByX.join(',') + '];');

// Verify
console.log('\nVerification:');
console.log(`y=189: left=${leftBoundaryByY[189]}, right=${rightBoundaryByY[189]}`);
console.log(`y=66: left=${leftBoundaryByY[66]}, right=${rightBoundaryByY[66]}`);

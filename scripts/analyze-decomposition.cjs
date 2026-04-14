// Analyze if kube's displacement map can be decomposed into:
// 1. A 1D edge gradient (reusable for all edges)
// 2. A corner attenuation mask
// This would allow parameter adjustment without re-encoding

const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Check if the displacement at center row can be used as a universal curve
const centerY = Math.floor(height / 2);
const centerCurve = [];
for (let x = 0; x < 50; x++) {
  centerCurve.push(getPixel(x, centerY).r - 128);
}

console.log('Center row curve (R-128):');
console.log(centerCurve.join(', '));

// Check if other rows are just scaled/shifted versions of center curve
console.log('\n=== Checking if rows are scaled versions of center ===');
console.log('y\tboundary\tmaxDisp\tscaleFactor\tcurveMatch');

for (let y = 0; y <= 150; y += 10) {
  // Find boundary
  let boundary = 0;
  for (let x = 0; x < width / 2; x++) {
    if (getPixel(x, y).r !== 128) { boundary = x; break; }
  }
  
  // Get max displacement at this row
  const maxDisp = getPixel(boundary, y).r - 128;
  const scaleFactor = maxDisp / 127;
  
  // Check if the curve shape matches center curve (normalized)
  let curveMatch = 0;
  let curveCount = 0;
  for (let d = 0; d < 40 && boundary + d < width / 2; d++) {
    const actualDisp = getPixel(boundary + d, y).r - 128;
    const expectedDisp = centerCurve[d] * scaleFactor;
    if (Math.abs(actualDisp - expectedDisp) <= 3) curveMatch++;
    curveCount++;
  }
  
  console.log(`${y}\t${boundary}\t${maxDisp}\t${scaleFactor.toFixed(3)}\t${curveMatch}/${curveCount}`);
}

// Key insight: Can we represent this as:
// displacement(x, y) = edgeCurve(distFromEdge) * cornerAttenuation(minDistFromCorner)

console.log('\n=== Testing: disp = curve(dist) * attenuation(minCornerDist) ===');

// Extract attenuation factor at each y
const attenuations = [];
for (let y = 0; y < height / 2; y++) {
  let boundary = 0;
  for (let x = 0; x < width / 2; x++) {
    if (getPixel(x, y).r !== 128) { boundary = x; break; }
  }
  const maxDisp = boundary < width / 2 ? getPixel(boundary, y).r - 128 : 0;
  attenuations.push(maxDisp / 127);
}

// Can attenuation be expressed as a simple function?
console.log('\nAttenuation vs minDistFromCorner:');
console.log('y\tminDist\tattenuation');
for (let y = 0; y <= 150; y += 10) {
  const minDist = Math.min(y, height - 1 - y);
  console.log(`${y}\t${minDist}\t${attenuations[y].toFixed(3)}`);
}

// Test if attenuation ≈ min(1, minDist / threshold)
console.log('\n=== Testing attenuation formulas ===');
for (let threshold of [80, 90, 100]) {
  let error = 0;
  for (let y = 0; y < height / 2; y++) {
    const minDist = Math.min(y, height - 1 - y);
    const predicted = Math.min(1, minDist / threshold);
    error += Math.abs(predicted - attenuations[y]);
  }
  console.log(`Linear (threshold=${threshold}): error=${error.toFixed(2)}`);
}

for (let threshold of [60, 70, 80]) {
  for (let power of [0.5, 0.7, 1.0]) {
    let error = 0;
    for (let y = 0; y < height / 2; y++) {
      const minDist = Math.min(y, height - 1 - y);
      const predicted = Math.min(1, Math.pow(minDist / threshold, power));
      error += Math.abs(predicted - attenuations[y]);
    }
    if (error < 20) {
      console.log(`Power (threshold=${threshold}, power=${power}): error=${error.toFixed(2)}`);
    }
  }
}

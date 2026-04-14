const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeImg = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeImg;

// Sample along center Y axis
const centerX = 210;
console.log('Kube displacement Y profile (x=210, varying y):');
console.log('y\tG\tdiff_from_128\tdist_from_edge\tedge_factor');

const samples = [];
for (let y = 0; y < 30; y++) {
  const idx = (y * width + centerX) * 4;
  const g = data[idx + 1];
  const diff = g - 128;
  const distFromEdge = y;
  const halfH = height / 2;  // 150
  // edge factor = 1 at edge, 0 at center
  const edgeFactor = distFromEdge < halfH * 0.25 ? 1 - (distFromEdge / (halfH * 0.25)) : 0;
  console.log(`${y}\t${g}\t${diff}\t${distFromEdge}\t${edgeFactor.toFixed(3)}`);
  if (diff !== 0) samples.push({ dist: distFromEdge, diff, edgeFactor });
}

// Try to fit: diff = A * edgeFactor^B
// Using log-linear regression for power
console.log('\nFitting power curve: diff = A * edgeFactor^B');
console.log('For each sample, log(diff) = log(A) + B*log(edgeFactor)');

// Manual fit attempt - let's see what exponent gives best match
for (let exp = 1; exp <= 5; exp += 0.5) {
  let totalError = 0;
  const maxDiff = 127;  // max possible diff at edge
  for (const s of samples) {
    if (s.edgeFactor > 0.001 && s.dist < 20) {
      const predicted = maxDiff * Math.pow(s.edgeFactor, exp);
      const error = Math.abs(predicted - s.diff);
      totalError += error;
    }
  }
  console.log(`exp=${exp.toFixed(1)}: total_error=${totalError.toFixed(1)}`);
}

// Let's also try with different thresholds
console.log('\nTrying different edge thresholds:');
for (let thresh = 0.15; thresh <= 0.35; thresh += 0.05) {
  let totalError = 0;
  const halfH = 150;
  const maxDiff = 127;
  for (let y = 0; y < 30; y++) {
    const idx = (y * width + centerX) * 4;
    const g = data[idx + 1];
    const actualDiff = g - 128;
    const distFromEdge = y;
    const edgeZone = halfH * thresh;
    const edgeFactor = distFromEdge < edgeZone ? 1 - (distFromEdge / edgeZone) : 0;
    const predicted = maxDiff * Math.pow(edgeFactor, 3);  // Using cubic
    const error = Math.abs(predicted - actualDiff);
    totalError += error;
  }
  console.log(`thresh=${thresh.toFixed(2)}: total_error=${totalError.toFixed(1)}`);
}

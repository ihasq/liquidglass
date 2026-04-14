// Extract exact kube.io curve and find the best fitting function

const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeImg = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeImg;

// Extract exact curve from top edge
const centerX = 210;
const kubeValues = [];

for (let dist = 0; dist < 40; dist++) {
  const y = dist;
  const idx = (y * width + centerX) * 4;
  const g = data[idx + 1];
  const gDiff = g - 128;
  kubeValues.push(gDiff);
}

console.log('Kube displacement curve (gDiff values):');
console.log(kubeValues.join(', '));

// The curve shows:
// - dist 0-1: 127 (saturation)
// - dist 2+: decay

// Try to fit: after saturation, use formula f(d) = A * (1 - d/T)^n
// Where d starts from 2, T is threshold from saturation start

const satZone = 2;  // First 2 pixels at max
const maxVal = 127;

// Find best n and T by minimizing error
let bestN = 0, bestT = 0, bestError = Infinity;

for (let T = 30; T <= 50; T += 0.5) {
  for (let n = 1.5; n <= 4; n += 0.1) {
    let error = 0;
    for (let dist = satZone; dist < 40; dist++) {
      const actual = kubeValues[dist];
      const adjustedDist = dist - satZone;
      const adjustedT = T - satZone;
      const t = adjustedDist / adjustedT;
      const predicted = t < 1 ? maxVal * Math.pow(1 - t, n) : 0;
      error += Math.pow(actual - predicted, 2);
    }
    if (error < bestError) {
      bestError = error;
      bestN = n;
      bestT = T;
    }
  }
}

console.log(`\nBest fit: n=${bestN.toFixed(2)}, T=${bestT.toFixed(1)}, error=${bestError.toFixed(1)}`);

// Test the best fit
console.log('\nComparison with best fit:');
console.log('dist\tactual\tpredicted\tdiff');

for (let dist = 0; dist < 40; dist++) {
  const actual = kubeValues[dist];
  let predicted;

  if (dist < satZone) {
    predicted = maxVal;
  } else {
    const adjustedDist = dist - satZone;
    const adjustedT = bestT - satZone;
    const t = adjustedDist / adjustedT;
    predicted = t < 1 ? maxVal * Math.pow(1 - t, bestN) : 0;
  }

  const diff = actual - Math.round(predicted);
  console.log(`${dist}\t${actual}\t${Math.round(predicted)}\t${diff}`);
}

// Also try with different saturation zones
console.log('\n=== Testing different saturation zone sizes ===');
for (let sat = 0; sat <= 3; sat++) {
  let bestN2 = 0, bestT2 = 0, bestError2 = Infinity;

  for (let T = 30; T <= 50; T += 0.5) {
    for (let n = 1.5; n <= 4; n += 0.1) {
      let error = 0;
      for (let dist = sat; dist < 40; dist++) {
        const actual = kubeValues[dist];
        const adjustedDist = dist - sat;
        const adjustedT = T - sat;
        const t = adjustedDist / adjustedT;
        const predicted = t < 1 ? maxVal * Math.pow(1 - t, n) : 0;
        error += Math.pow(actual - predicted, 2);
      }
      if (error < bestError2) {
        bestError2 = error;
        bestN2 = n;
        bestT2 = T;
      }
    }
  }
  console.log(`Saturation=${sat}: best n=${bestN2.toFixed(2)}, T=${bestT2.toFixed(1)}, error=${bestError2.toFixed(1)}`);
}

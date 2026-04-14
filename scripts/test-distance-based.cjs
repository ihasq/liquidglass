// Test: Can D(x,y) be expressed as f(distEdge, distCorner)?
// If so, we can use SVG gradients (linear + radial) combined

const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

console.log('=== Distance-Based Decomposition ===\n');

// For each pixel, compute:
// - distEdge: distance from the nearest edge (relevant for that channel)
// - distCorner: some measure of "cornerness"

// Let's focus on R channel (X displacement) first
// distEdge = min(distLeft, distRight) - but we need to know which edge is active
// For left half: distEdge = distLeft
// For right half: distEdge = distRight

// distCorner options:
// 1. min(distTop, distBottom)
// 2. sqrt(min(distLeft,distRight)^2 + min(distTop,distBottom)^2)
// 3. min(distTop, distBottom, distLeft, distRight)

// Sample the R channel data and analyze
const samples = [];
for (let y = 0; y < height; y += 2) {
  for (let x = 0; x < width / 2; x += 2) {  // Left half only for R
    const r = getPixel(x, y).r;
    if (r !== 128) {
      const distLeft = x;
      const distTop = y;
      const distBottom = height - 1 - y;
      const minDistTB = Math.min(distTop, distBottom);
      
      samples.push({
        x, y,
        distEdge: distLeft,
        distCorner: minDistTB,
        displacement: r - 128
      });
    }
  }
}

console.log(`Collected ${samples.length} samples`);

// Try to find a function f(distEdge, distCorner) that fits
// Hypothesis: displacement = edgeCurve(distEdge) * cornerFactor(distCorner)

// Extract edge curve from center row (distCorner = 149)
const edgeCurve = [];
for (let x = 0; x < width / 2; x++) {
  edgeCurve.push(getPixel(x, 149).r - 128);
}

// For each sample, compute what cornerFactor would need to be
const cornerFactorSamples = new Map();
samples.forEach(s => {
  if (s.distEdge < edgeCurve.length && edgeCurve[s.distEdge] > 0) {
    const factor = s.displacement / edgeCurve[s.distEdge];
    if (!cornerFactorSamples.has(s.distCorner)) {
      cornerFactorSamples.set(s.distCorner, []);
    }
    cornerFactorSamples.get(s.distCorner).push(factor);
  }
});

// Average the corner factors and check consistency
console.log('\nCorner factor by minDistTB:');
console.log('distCorner\tavgFactor\tstdDev\tcount');

const cornerFactors = [];
for (let d = 0; d < 150; d++) {
  const factors = cornerFactorSamples.get(d) || [];
  if (factors.length > 0) {
    const avg = factors.reduce((a, b) => a + b, 0) / factors.length;
    const stdDev = Math.sqrt(factors.reduce((a, b) => a + (b - avg) ** 2, 0) / factors.length);
    cornerFactors.push(avg);
    if (d % 10 === 0) {
      console.log(`${d}\t\t${avg.toFixed(3)}\t\t${stdDev.toFixed(3)}\t${factors.length}`);
    }
  } else {
    cornerFactors.push(0);
  }
}

// Now test: can cornerFactor be approximated by a simple function?
console.log('\n=== Testing Corner Factor Functions ===');

// Test: cornerFactor = min(1, (distCorner / threshold)^power)
let bestError = Infinity;
let bestParams = null;

for (let threshold = 40; threshold <= 120; threshold += 10) {
  for (let power = 0.3; power <= 2.0; power += 0.1) {
    let error = 0;
    let count = 0;
    for (let d = 0; d < cornerFactors.length; d++) {
      if (cornerFactors[d] > 0) {
        const predicted = Math.min(1, Math.pow(d / threshold, power));
        error += Math.abs(cornerFactors[d] - predicted);
        count++;
      }
    }
    const avgError = error / count;
    if (avgError < bestError) {
      bestError = avgError;
      bestParams = { threshold, power };
    }
  }
}

console.log(`Best fit: threshold=${bestParams.threshold}, power=${bestParams.power.toFixed(1)}`);
console.log(`Average error: ${bestError.toFixed(4)}`);

// Generate map using this function
console.log('\n=== Generating Map with Best-Fit Function ===');

function cornerFactor(distCorner, threshold, power) {
  return Math.min(1, Math.pow(distCorner / threshold, power));
}

const testMap = new PNG({ width, height });
const { threshold, power } = bestParams;

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    
    const distLeft = x;
    const distRight = width - 1 - x;
    const distTop = y;
    const distBottom = height - 1 - y;
    const minDistTB = Math.min(distTop, distBottom);
    const minDistLR = Math.min(distLeft, distRight);
    
    // R channel
    let r = 128;
    const cfR = cornerFactor(minDistTB, threshold, power);
    if (distLeft < edgeCurve.length && edgeCurve[distLeft] > 0) {
      r = Math.round(128 + edgeCurve[distLeft] * cfR);
    } else if (distRight < edgeCurve.length && edgeCurve[distRight] > 0) {
      r = Math.round(128 - edgeCurve[distRight] * cfR);
    }
    r = Math.max(0, Math.min(255, r));
    
    // G channel (same logic, rotated)
    let g = 128;
    const cfG = cornerFactor(minDistLR, threshold, power);
    if (distTop < edgeCurve.length && edgeCurve[distTop] > 0) {
      g = Math.round(128 + edgeCurve[distTop] * cfG);
    } else if (distBottom < edgeCurve.length && edgeCurve[distBottom] > 0) {
      g = Math.round(128 - edgeCurve[distBottom] * cfG);
    }
    g = Math.max(0, Math.min(255, g));
    
    testMap.data[idx] = r;
    testMap.data[idx + 1] = g;
    testMap.data[idx + 2] = 0;
    testMap.data[idx + 3] = 255;
  }
}

// Compare
const totalPixels = width * height;
console.log('\nMatch results:');
for (let tolerance of [0, 1, 2, 3, 5, 10, 15, 20]) {
  let match = 0;
  for (let i = 0; i < totalPixels * 4; i += 4) {
    const rErr = Math.abs(kubeMap.data[i] - testMap.data[i]);
    const gErr = Math.abs(kubeMap.data[i + 1] - testMap.data[i + 1]);
    if (rErr <= tolerance && gErr <= tolerance) match++;
  }
  const pct = (match / totalPixels * 100).toFixed(2);
  console.log(`Tolerance ≤${tolerance}: ${pct}%`);
  if (parseFloat(pct) >= 99.9) break;
}

fs.writeFileSync('e2e/debug/dispmap-compare/distance-based.png', PNG.sync.write(testMap));

// Key insight for SVG implementation:
console.log('\n=== SVG Implementation Strategy ===');
console.log('Components needed:');
console.log('1. Edge gradient strip (1D): stores edgeCurve values');
console.log('2. Corner mask: implements cornerFactor = min(1, (dist/threshold)^power)');
console.log('');
console.log('SVG operations:');
console.log('- feImage: load edge strip, scale to element size');
console.log('- feComponentTransfer with feFuncR/G: apply power curve (gamma)');
console.log('- Radial gradient or second texture for corner mask');
console.log('- feComposite: multiply edge gradient × corner mask');

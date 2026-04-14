// Use Z3 to find if kube's displacement map can be decomposed into
// a simple texture + SVG-adjustable transformation
import { init } from 'z3-solver';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

console.log('=== Analyzing displacement map structure ===\n');

// Hypothesis 1: D(x,y) = EdgeGradient(distFromEdge) × CornerMask(x,y)
// Where EdgeGradient is 1D and CornerMask is a simple function

// Extract the center row curve as the "ideal" edge gradient
const edgeGradient = [];
for (let x = 0; x < 50; x++) {
  edgeGradient.push((getPixel(x, 150).r - 128) / 127); // Normalize to 0-1
}

console.log('Hypothesis 1: D = EdgeGradient(dist) × CornerMask(minCornerDist)');
console.log('Testing if CornerMask can be a simple function...\n');

// For each pixel, compute what CornerMask would need to be
const cornerMaskSamples = [];
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width / 2; x++) {
    const actualR = getPixel(x, y).r;
    const actualDisp = (actualR - 128) / 127; // -1 to 1

    const distLeft = x;
    const minCornerDist = Math.min(y, height - 1 - y);

    if (distLeft < edgeGradient.length && edgeGradient[distLeft] > 0.01) {
      const requiredMask = actualDisp / edgeGradient[distLeft];
      cornerMaskSamples.push({
        x, y,
        minCornerDist,
        distLeft,
        requiredMask
      });
    }
  }
}

// Group by minCornerDist and check consistency
const maskByCornerDist = new Map();
cornerMaskSamples.forEach(s => {
  if (!maskByCornerDist.has(s.minCornerDist)) {
    maskByCornerDist.set(s.minCornerDist, []);
  }
  maskByCornerDist.get(s.minCornerDist).push(s.requiredMask);
});

console.log('Required CornerMask by minCornerDist:');
console.log('minDist\tavgMask\tstdDev\tsamples');
let totalVariance = 0;
let totalSamples = 0;
for (let d = 0; d <= 150; d += 10) {
  const masks = maskByCornerDist.get(d) || [];
  if (masks.length > 0) {
    const avg = masks.reduce((a, b) => a + b, 0) / masks.length;
    const variance = masks.reduce((a, b) => a + (b - avg) ** 2, 0) / masks.length;
    const stdDev = Math.sqrt(variance);
    console.log(`${d}\t${avg.toFixed(3)}\t${stdDev.toFixed(3)}\t${masks.length}`);
    totalVariance += variance * masks.length;
    totalSamples += masks.length;
  }
}
console.log(`\nOverall std dev: ${Math.sqrt(totalVariance / totalSamples).toFixed(4)}`);

// Hypothesis 2: D(x,y) = BaseTexture(x,y)^γ × scale + offset
// Where BaseTexture is a simple radial/linear combination
console.log('\n=== Hypothesis 2: D = (BaseTexture)^γ × scale + offset ===');
console.log('Testing if a radial gradient base works...\n');

// Try: BaseTexture = distance from nearest edge, normalized
function computeBaseTexture(x, y, type) {
  const distLeft = x;
  const distRight = width - 1 - x;
  const distTop = y;
  const distBottom = height - 1 - y;

  if (type === 'minEdge') {
    return Math.min(distLeft, distRight, distTop, distBottom) / 150;
  } else if (type === 'cornerDist') {
    const minX = Math.min(distLeft, distRight);
    const minY = Math.min(distTop, distBottom);
    return Math.sqrt(minX * minX + minY * minY) / 150;
  } else if (type === 'product') {
    const minX = Math.min(distLeft, distRight) / 210;
    const minY = Math.min(distTop, distBottom) / 150;
    return minX * minY;
  }
  return 0;
}

// For each base texture type, find best γ and scale
for (const textureType of ['minEdge', 'cornerDist', 'product']) {
  let bestError = Infinity;
  let bestParams = null;

  for (let gamma = 0.3; gamma <= 3; gamma += 0.1) {
    for (let scale = 50; scale <= 150; scale += 10) {
      let error = 0;
      let count = 0;

      for (let y = 0; y < height; y += 5) {
        for (let x = 0; x < width; x += 5) {
          const actual = getPixel(x, y).r;
          const base = computeBaseTexture(x, y, textureType);
          const predicted = 128 + Math.pow(base, gamma) * scale;
          error += Math.abs(actual - predicted);
          count++;
        }
      }

      const avgError = error / count;
      if (avgError < bestError) {
        bestError = avgError;
        bestParams = { gamma, scale };
      }
    }
  }

  console.log(`${textureType}: bestError=${bestError.toFixed(2)}, γ=${bestParams.gamma.toFixed(1)}, scale=${bestParams.scale}`);
}

// Hypothesis 3: Separable - D(x,y) = Fx(x) × Fy(y)
console.log('\n=== Hypothesis 3: D(x,y) = Fx(x) × Fy(y) (separable) ===');

// Extract Fx from center row, Fy from center column
const Fx = [];
for (let x = 0; x < width; x++) {
  Fx.push(getPixel(x, 150).r - 128);
}
const Fy = [];
for (let y = 0; y < height; y++) {
  Fy.push(getPixel(210, y).g - 128);
}

// Normalize
const maxFx = Math.max(...Fx.map(Math.abs));
const maxFy = Math.max(...Fy.map(Math.abs));
const FxNorm = Fx.map(v => v / maxFx);
const FyNorm = Fy.map(v => v / maxFy);

// Test separability error
let sepError = 0;
let sepCount = 0;
for (let y = 0; y < height; y += 3) {
  for (let x = 0; x < width; x += 3) {
    const actual = getPixel(x, y).r - 128;
    const predicted = FxNorm[x] * FyNorm[y] * maxFx;
    sepError += Math.abs(actual - predicted);
    sepCount++;
  }
}
console.log(`Separability error (R channel): ${(sepError / sepCount).toFixed(2)}`);

// Hypothesis 4: D = EdgeStrip ⊗ CornerMask (tensor product with different masks)
console.log('\n=== Hypothesis 4: Minimal WebP assets needed ===');
console.log('Checking what pre-computed assets could work with SVG adjustments...\n');

// What if we use:
// 1. A single 1D edge gradient strip (horizontal)
// 2. Apply it to all 4 edges via feImage positioning
// 3. Use feComponentTransfer with gamma to adjust intensity
// 4. The corner attenuation could come from feGaussianBlur edge falloff

// This would require the corner attenuation to be achievable via blur
// Let's check if corner attenuation ≈ some blur-based falloff

console.log('Can corner attenuation be approximated by distance-based falloff?');
console.log('Testing: attenuation = 1 - exp(-minDist/λ)');

for (let lambda of [30, 50, 70, 90]) {
  let error = 0;
  for (let y = 0; y < height / 2; y++) {
    const minDist = y;
    // Find actual attenuation
    let boundary = 0;
    for (let x = 0; x < width / 2; x++) {
      if (getPixel(x, y).r !== 128) { boundary = x; break; }
    }
    const actualMax = boundary < width / 2 ? (getPixel(boundary, y).r - 128) / 127 : 0;
    const predicted = 1 - Math.exp(-minDist / lambda);
    error += Math.abs(actualMax - predicted);
  }
  console.log(`  λ=${lambda}: error=${error.toFixed(2)}`);
}

console.log('\nTesting: attenuation = (minDist/threshold)^power clamped to 1');
for (let threshold of [50, 70, 90]) {
  for (let power of [0.5, 0.7, 1.0, 1.5]) {
    let error = 0;
    for (let y = 0; y < height / 2; y++) {
      const minDist = y;
      let boundary = 0;
      for (let x = 0; x < width / 2; x++) {
        if (getPixel(x, y).r !== 128) { boundary = x; break; }
      }
      const actualMax = boundary < width / 2 ? (getPixel(boundary, y).r - 128) / 127 : 0;
      const predicted = Math.min(1, Math.pow(minDist / threshold, power));
      error += Math.abs(actualMax - predicted);
    }
    if (error < 15) {
      console.log(`  threshold=${threshold}, power=${power}: error=${error.toFixed(2)}`);
    }
  }
}

// Test: Can a single 1D edge strip, transformed 4 times, recreate the displacement map?
// SVG can: rotate, scale, position each instance

const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

console.log('=== Single 1D Strip × 4 Transforms Approach ===\n');

// Extract the edge profile from center row (this is our 1D strip)
// This strip goes from edge (max displacement) to center (zero displacement)
const edgeStrip = [];
for (let x = 0; x < width / 2; x++) {
  edgeStrip.push(getPixel(x, Math.floor(height / 2)).r - 128);
}
console.log('Edge strip length:', edgeStrip.length);
console.log('Edge strip (first 20):', edgeStrip.slice(0, 20).join(', '));

// Now simulate placing this strip on all 4 edges:
// Left edge: strip as-is, R channel positive
// Right edge: strip mirrored, R channel negative  
// Top edge: strip rotated 90°, G channel positive
// Bottom edge: strip rotated 90° + mirrored, G channel negative

// The key insight: at corners, the strips OVERLAP
// The final value should be: left + right (for R) and top + bottom (for G)
// But we also need corner attenuation...

// Let's test WITHOUT corner attenuation first
const testMap = new PNG({ width, height });

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    
    const distLeft = x;
    const distRight = width - 1 - x;
    const distTop = y;
    const distBottom = height - 1 - y;
    
    // R channel: left strip + right strip (inverted)
    let r = 128;
    if (distLeft < edgeStrip.length) {
      r += edgeStrip[distLeft];
    }
    if (distRight < edgeStrip.length) {
      r -= edgeStrip[distRight];
    }
    r = Math.max(0, Math.min(255, r));
    
    // G channel: top strip + bottom strip (inverted)
    let g = 128;
    if (distTop < edgeStrip.length) {
      g += edgeStrip[distTop];
    }
    if (distBottom < edgeStrip.length) {
      g -= edgeStrip[distBottom];
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
console.log('\n=== Without Corner Attenuation ===');
for (let tolerance of [0, 1, 2, 3, 5, 10, 20]) {
  let match = 0;
  for (let i = 0; i < totalPixels * 4; i += 4) {
    const rErr = Math.abs(kubeMap.data[i] - testMap.data[i]);
    const gErr = Math.abs(kubeMap.data[i + 1] - testMap.data[i + 1]);
    if (rErr <= tolerance && gErr <= tolerance) match++;
  }
  console.log(`Tolerance ≤${tolerance}: ${(match / totalPixels * 100).toFixed(2)}%`);
}

fs.writeFileSync('e2e/debug/dispmap-compare/strip-no-atten.png', PNG.sync.write(testMap));

// Now let's add corner attenuation
// At corners, the displacement should be reduced
// Attenuation factor = f(min(distTop, distBottom), min(distLeft, distRight))

console.log('\n=== With Corner Attenuation ===');

// Extract the attenuation curve from kube's map
// At y=0, x=140 is boundary, displacement is 7 (vs 127 at center)
// This gives attenuation ≈ 7/127 ≈ 0.055 at corner

// The attenuation seems to depend on min(distFromVerticalEdge, distFromHorizontalEdge)
// Let's extract it empirically

const attenuationByMinDist = [];
for (let minDist = 0; minDist <= 150; minDist++) {
  // Sample at y = minDist (top half) where distTop = minDist
  let boundary = 0;
  for (let x = 0; x < width / 2; x++) {
    if (getPixel(x, minDist).r !== 128) { boundary = x; break; }
  }
  const maxDisp = boundary < width / 2 ? (getPixel(boundary, minDist).r - 128) : 0;
  attenuationByMinDist.push(maxDisp / 127);
}

console.log('Attenuation curve (first 30):', 
  attenuationByMinDist.slice(0, 30).map(v => v.toFixed(2)).join(', '));

// Apply attenuation
const testMap2 = new PNG({ width, height });

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    
    const distLeft = x;
    const distRight = width - 1 - x;
    const distTop = y;
    const distBottom = height - 1 - y;
    
    // Corner distance for attenuation
    const minDistTB = Math.min(distTop, distBottom);
    const minDistLR = Math.min(distLeft, distRight);
    
    // Get attenuation factors
    const attenR = minDistTB < attenuationByMinDist.length ? attenuationByMinDist[minDistTB] : 1;
    const attenG = minDistLR < attenuationByMinDist.length ? attenuationByMinDist[minDistLR] : 1;
    
    // R channel with attenuation
    let rDisp = 0;
    if (distLeft < edgeStrip.length) {
      rDisp += edgeStrip[distLeft];
    }
    if (distRight < edgeStrip.length) {
      rDisp -= edgeStrip[distRight];
    }
    let r = Math.round(128 + rDisp * attenR);
    r = Math.max(0, Math.min(255, r));
    
    // G channel with attenuation
    let gDisp = 0;
    if (distTop < edgeStrip.length) {
      gDisp += edgeStrip[distTop];
    }
    if (distBottom < edgeStrip.length) {
      gDisp -= edgeStrip[distBottom];
    }
    let g = Math.round(128 + gDisp * attenG);
    g = Math.max(0, Math.min(255, g));
    
    testMap2.data[idx] = r;
    testMap2.data[idx + 1] = g;
    testMap2.data[idx + 2] = 0;
    testMap2.data[idx + 3] = 255;
  }
}

// Compare
for (let tolerance of [0, 1, 2, 3, 5, 10]) {
  let match = 0;
  for (let i = 0; i < totalPixels * 4; i += 4) {
    const rErr = Math.abs(kubeMap.data[i] - testMap2.data[i]);
    const gErr = Math.abs(kubeMap.data[i + 1] - testMap2.data[i + 1]);
    if (rErr <= tolerance && gErr <= tolerance) match++;
  }
  console.log(`Tolerance ≤${tolerance}: ${(match / totalPixels * 100).toFixed(2)}%`);
}

fs.writeFileSync('e2e/debug/dispmap-compare/strip-with-atten.png', PNG.sync.write(testMap2));

// The question: can the attenuation be achieved via SVG operations?
// Options:
// 1. Second WebP for attenuation mask (multiplied via feComposite)
// 2. feGaussianBlur to create soft edges
// 3. Radial gradient in SVG

console.log('\n=== SVG-Based Attenuation Options ===');
console.log('The attenuation curve shape determines what SVG ops can achieve it:');
console.log('');

// Check if attenuation ≈ distance-based falloff (achievable via radial gradient)
let linearError = 0;
let sqrtError = 0;
for (let d = 0; d < 100; d++) {
  const actual = attenuationByMinDist[d];
  const linearPred = Math.min(1, d / 90);
  const sqrtPred = Math.min(1, Math.sqrt(d / 90));
  linearError += Math.abs(actual - linearPred);
  sqrtError += Math.abs(actual - sqrtPred);
}
console.log(`Linear falloff (d/90) error: ${linearError.toFixed(2)}`);
console.log(`Sqrt falloff (√(d/90)) error: ${sqrtError.toFixed(2)}`);

// Test if D(x,y) = Fx(x) × Fy(y) can achieve 99.9% match
// This would allow using just 2 WebP strips + SVG multiplication

const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

console.log('=== Testing Separable Approach ===\n');

// Extract Fx (horizontal profile) from center row for R channel
// And similar for Y displacement from center column for G channel
const centerY = Math.floor(height / 2);
const centerX = Math.floor(width / 2);

// For R channel (X displacement): profile along X at center Y
const Fx_R = [];
for (let x = 0; x < width; x++) {
  Fx_R.push(getPixel(x, centerY).r);
}

// For G channel (Y displacement): profile along Y at center X
const Fy_G = [];
for (let y = 0; y < height; y++) {
  Fy_G.push(getPixel(centerX, y).g);
}

// For the attenuation (corner mask), we need profiles along Y for R, and X for G
// Fy_R: how R varies along Y at left edge
const Fy_R = [];
for (let y = 0; y < height; y++) {
  // Find the max R displacement at this y
  let maxR = 128;
  for (let x = 0; x < width / 2; x++) {
    const r = getPixel(x, y).r;
    if (Math.abs(r - 128) > Math.abs(maxR - 128)) {
      maxR = r;
    }
  }
  // Normalize: maxR at center should be 255, so factor = maxR / 255
  Fy_R.push(maxR);
}

// Fx_G: how G varies along X at top edge
const Fx_G = [];
for (let x = 0; x < width; x++) {
  let maxG = 128;
  for (let y = 0; y < height / 2; y++) {
    const g = getPixel(x, y).g;
    if (Math.abs(g - 128) > Math.abs(maxG - 128)) {
      maxG = g;
    }
  }
  Fx_G.push(maxG);
}

// Now try: R(x,y) = Fx_R[x] * (Fy_R[y] - 128) / 127 normalized
// This is getting complex. Let me try a simpler model:
// R(x,y) = 128 + (Fx_R[x] - 128) * factor_y
// where factor_y = (Fy_R[y] - 128) / (Fy_R[centerY] - 128)

console.log('Approach 1: R(x,y) = 128 + (Fx_R[x] - 128) * factorY');

// Calculate factorY for each row
const factorY_R = [];
const centerFyR = Fy_R[centerY] - 128;
for (let y = 0; y < height; y++) {
  factorY_R.push(centerFyR !== 0 ? (Fy_R[y] - 128) / centerFyR : 0);
}

const factorX_G = [];
const centerFxG = Fx_G[centerX] - 128;
for (let x = 0; x < width; x++) {
  factorX_G.push(centerFxG !== 0 ? (Fx_G[x] - 128) / centerFxG : 0);
}

// Generate predicted map
const ourMap = new PNG({ width, height });

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    
    // R channel
    const baseR = Fx_R[x] - 128;
    const factY = factorY_R[y];
    let r = Math.round(128 + baseR * Math.abs(factY));
    r = Math.max(0, Math.min(255, r));
    
    // G channel
    const baseG = Fy_G[y] - 128;
    const factX = factorX_G[x];
    let g = Math.round(128 + baseG * Math.abs(factX));
    g = Math.max(0, Math.min(255, g));
    
    ourMap.data[idx] = r;
    ourMap.data[idx + 1] = g;
    ourMap.data[idx + 2] = 0;
    ourMap.data[idx + 3] = 255;
  }
}

// Compare
const totalPixels = width * height;
for (let tolerance = 0; tolerance <= 10; tolerance++) {
  let match = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const rErr = Math.abs(kubeMap.data[idx] - ourMap.data[idx]);
      const gErr = Math.abs(kubeMap.data[idx + 1] - ourMap.data[idx + 1]);
      if (rErr <= tolerance && gErr <= tolerance) match++;
    }
  }
  const percent = (match / totalPixels * 100).toFixed(2);
  console.log(`Tolerance ≤${tolerance}: ${percent}%`);
  if (parseFloat(percent) >= 99.9) {
    console.log(`\n✓ 99.9% achieved at tolerance ${tolerance}`);
    break;
  }
}

// Save for visual inspection
fs.writeFileSync('e2e/debug/dispmap-compare/separable-test.png', PNG.sync.write(ourMap));

// Output the 1D profiles for WebP generation
console.log('\n=== 1D Profiles for WebP Generation ===');
console.log('Fx_R (first 50):', Fx_R.slice(0, 50).join(','));
console.log('Fy_G (first 50):', Fy_G.slice(0, 50).join(','));
console.log('factorY_R:', factorY_R.slice(0, 30).map(v => v.toFixed(3)).join(','));
console.log('factorX_G:', factorX_G.slice(0, 30).map(v => v.toFixed(3)).join(','));

// Find the neutral center zone of kube's displacement map

const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

console.log('=== Finding Neutral Center Zone ===\n');
console.log(`Image size: ${width}x${height}`);
console.log(`Center: (${width/2}, ${height/2})`);

// Check where R and G become exactly 128 (neutral)
console.log('\nR channel (X displacement):');
console.log('Checking from left edge toward center...');
const centerY = Math.floor(height / 2);
for (let x = 0; x < width / 2; x++) {
  const { r } = getPixel(x, centerY);
  if (r === 128) {
    console.log(`First R=128 at x=${x} (distLeft=${x})`);
    break;
  }
}

console.log('\nChecking from right edge toward center...');
for (let x = width - 1; x >= width / 2; x--) {
  const { r } = getPixel(x, centerY);
  if (r === 128) {
    console.log(`First R=128 at x=${x} (distRight=${width - 1 - x})`);
    break;
  }
}

console.log('\nG channel (Y displacement):');
console.log('Checking from top edge toward center...');
const centerX = Math.floor(width / 2);
for (let y = 0; y < height / 2; y++) {
  const { g } = getPixel(centerX, y);
  if (g === 128) {
    console.log(`First G=128 at y=${y} (distTop=${y})`);
    break;
  }
}

console.log('\nChecking from bottom edge toward center...');
for (let y = height - 1; y >= height / 2; y--) {
  const { g } = getPixel(centerX, y);
  if (g === 128) {
    console.log(`First G=128 at y=${y} (distBottom=${height - 1 - y})`);
    break;
  }
}

// The edge zone width (where displacement is active)
const edgeZone = 41;  // From previous analysis, curve goes to ~40 pixels

console.log(`\n=== Edge Zone Analysis ===`);
console.log(`Edge zone width: ${edgeZone} pixels`);
console.log(`This means:`);
console.log(`  - Left ${edgeZone}px and right ${edgeZone}px have X displacement`);
console.log(`  - Top ${edgeZone}px and bottom ${edgeZone}px have Y displacement`);
console.log(`  - Center zone is neutral`);

// The corner "blend" zone - where both X and Y are active
console.log(`\nCorner zones (both R and G non-neutral):`);

// Find the extent of the corner zone
let maxCornerX = 0, maxCornerY = 0;
for (let y = 0; y < height / 2; y++) {
  for (let x = 0; x < width / 2; x++) {
    const { r, g } = getPixel(x, y);
    if (r !== 128 && g !== 128) {
      maxCornerX = Math.max(maxCornerX, x);
      maxCornerY = Math.max(maxCornerY, y);
    }
  }
}
console.log(`Corner zone extends to: x=${maxCornerX}, y=${maxCornerY}`);

// With this understanding, what's the minimal tile set?
console.log(`\n=== Minimal WebP Asset Strategy ===`);
console.log(`Option 1: Single 1D edge strip (${edgeZone}x1 pixels)`);
console.log(`  - Apply to all 4 edges via SVG transform`);
console.log(`  - Corner attenuation via additional mask or feGaussianBlur`);

console.log(`\nOption 2: Corner tile + edge strip`);
console.log(`  - One corner tile (${maxCornerX}x${maxCornerY})`);
console.log(`  - One edge strip (${edgeZone}x1)`);
console.log(`  - SVG combines them with transforms`);

console.log(`\nOption 3: Full 2D map as single WebP`);
console.log(`  - Size: ${width}x${height} (${(width * height * 4 / 1024).toFixed(1)} KB raw)`);
console.log(`  - SVG scales via feImage width/height`);
console.log(`  - Intensity via feDisplacementMap scale`);

// Key question: Does the edge strip approach work without corner attenuation?
console.log(`\n=== Testing Pure Edge Strip (no corner attenuation) ===`);

// Extract the edge curve
const edgeCurve = [];
for (let d = 0; d < edgeZone; d++) {
  edgeCurve.push(getPixel(d, centerY).r - 128);
}
console.log(`Edge curve: ${edgeCurve.slice(0, 15).join(', ')}...`);

// Generate map with edge strips only (no attenuation)
const testMap = new PNG({ width, height });

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    
    const distLeft = x;
    const distRight = width - 1 - x;
    const distTop = y;
    const distBottom = height - 1 - y;
    
    // R: left edge contributes positive, right edge contributes negative
    let r = 128;
    if (distLeft < edgeCurve.length) r += edgeCurve[distLeft];
    else if (distRight < edgeCurve.length) r -= edgeCurve[distRight];
    r = Math.max(0, Math.min(255, r));
    
    // G: top edge contributes positive, bottom edge contributes negative
    let g = 128;
    if (distTop < edgeCurve.length) g += edgeCurve[distTop];
    else if (distBottom < edgeCurve.length) g -= edgeCurve[distBottom];
    g = Math.max(0, Math.min(255, g));
    
    testMap.data[idx] = r;
    testMap.data[idx + 1] = g;
    testMap.data[idx + 2] = 0;
    testMap.data[idx + 3] = 255;
  }
}

// Compare
const totalPixels = width * height;
let exactMatch = 0;
for (let i = 0; i < totalPixels * 4; i += 4) {
  const rErr = Math.abs(kubeMap.data[i] - testMap.data[i]);
  const gErr = Math.abs(kubeMap.data[i + 1] - testMap.data[i + 1]);
  if (rErr === 0 && gErr === 0) exactMatch++;
}
console.log(`\nPure edge strip approach: ${(exactMatch / totalPixels * 100).toFixed(2)}% exact match`);

// The corners will have errors - let's quantify
let cornerErrorCount = 0;
let edgeErrorCount = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const rErr = Math.abs(kubeMap.data[idx] - testMap.data[idx]);
    const gErr = Math.abs(kubeMap.data[idx + 1] - testMap.data[idx + 1]);
    if (rErr > 0 || gErr > 0) {
      const distFromCorner = Math.min(
        Math.min(x, width - 1 - x),
        Math.min(y, height - 1 - y)
      );
      if (distFromCorner < 50) cornerErrorCount++;
      else edgeErrorCount++;
    }
  }
}
console.log(`Errors in corners (dist < 50): ${cornerErrorCount}`);
console.log(`Errors in edges/center: ${edgeErrorCount}`);

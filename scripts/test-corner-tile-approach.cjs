// Test: Use a single corner tile (top-left) and mirror it for all 4 corners
// This should work if kube's map is symmetric

const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

console.log('=== Corner Tile + Mirroring Approach ===\n');

// First, verify symmetry of kube's map
console.log('Checking symmetry...');

let symErrorLR = 0, symErrorTB = 0, symErrorDiag = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width / 2; x++) {
    const left = getPixel(x, y);
    const right = getPixel(width - 1 - x, y);
    
    // Left-right symmetry: R should be mirrored (R_left = 256 - R_right)
    const expectedR = 256 - right.r;
    if (Math.abs(left.r - expectedR) > 1) symErrorLR++;
    
    // G should be identical
    if (Math.abs(left.g - right.g) > 1) symErrorLR++;
  }
}

for (let y = 0; y < height / 2; y++) {
  for (let x = 0; x < width; x++) {
    const top = getPixel(x, y);
    const bottom = getPixel(x, height - 1 - y);
    
    // Top-bottom symmetry: G should be mirrored
    const expectedG = 256 - bottom.g;
    if (Math.abs(top.g - expectedG) > 1) symErrorTB++;
    
    // R should be identical
    if (Math.abs(top.r - bottom.r) > 1) symErrorTB++;
  }
}

console.log(`Left-right symmetry errors: ${symErrorLR}`);
console.log(`Top-bottom symmetry errors: ${symErrorTB}`);

// Extract corner tile
const cornerW = 150;  // Slightly more than 149 for safety
const cornerH = 150;

console.log(`\nExtracting corner tile: ${cornerW}x${cornerH}`);

// Generate full map from corner tile using mirroring
const testMap = new PNG({ width, height });

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    
    // Determine which quadrant and map to corner tile coordinates
    let srcX, srcY;
    let flipR = false, flipG = false;
    
    if (x < cornerW && y < cornerH) {
      // Top-left: use directly
      srcX = x;
      srcY = y;
    } else if (x >= width - cornerW && y < cornerH) {
      // Top-right: mirror X, flip R sign
      srcX = width - 1 - x;
      srcY = y;
      flipR = true;
    } else if (x < cornerW && y >= height - cornerH) {
      // Bottom-left: mirror Y, flip G sign
      srcX = x;
      srcY = height - 1 - y;
      flipG = true;
    } else if (x >= width - cornerW && y >= height - cornerH) {
      // Bottom-right: mirror both, flip both
      srcX = width - 1 - x;
      srcY = height - 1 - y;
      flipR = true;
      flipG = true;
    } else if (y < cornerH) {
      // Top edge (between corners): use edge value from corner
      srcX = Math.min(x, cornerW - 1);
      srcX = Math.min(srcX, width - 1 - x);  // Use closer edge
      srcY = y;
      if (x >= width / 2) flipR = true;
    } else if (y >= height - cornerH) {
      // Bottom edge
      srcX = Math.min(x, cornerW - 1);
      srcX = Math.min(srcX, width - 1 - x);
      srcY = height - 1 - y;
      flipG = true;
      if (x >= width / 2) flipR = true;
    } else if (x < cornerW) {
      // Left edge
      srcX = x;
      srcY = Math.min(y, cornerH - 1);
      srcY = Math.min(srcY, height - 1 - y);
      if (y >= height / 2) flipG = true;
    } else if (x >= width - cornerW) {
      // Right edge
      srcX = width - 1 - x;
      srcY = Math.min(y, cornerH - 1);
      srcY = Math.min(srcY, height - 1 - y);
      flipR = true;
      if (y >= height / 2) flipG = true;
    } else {
      // Center: neutral
      testMap.data[idx] = 128;
      testMap.data[idx + 1] = 128;
      testMap.data[idx + 2] = 0;
      testMap.data[idx + 3] = 255;
      continue;
    }
    
    // Get source pixel from kube's map
    const src = getPixel(srcX, srcY);
    
    // Apply flipping
    let r = src.r;
    let g = src.g;
    if (flipR) r = 256 - r;
    if (flipG) g = 256 - g;
    
    testMap.data[idx] = Math.max(0, Math.min(255, r));
    testMap.data[idx + 1] = Math.max(0, Math.min(255, g));
    testMap.data[idx + 2] = 0;
    testMap.data[idx + 3] = 255;
  }
}

// Compare
const totalPixels = width * height;
console.log('\nMatch results:');
for (let tolerance of [0, 1, 2, 3, 5]) {
  let match = 0;
  for (let i = 0; i < totalPixels * 4; i += 4) {
    const rErr = Math.abs(kubeMap.data[i] - testMap.data[i]);
    const gErr = Math.abs(kubeMap.data[i + 1] - testMap.data[i + 1]);
    if (rErr <= tolerance && gErr <= tolerance) match++;
  }
  console.log(`Tolerance ≤${tolerance}: ${(match / totalPixels * 100).toFixed(2)}%`);
}

fs.writeFileSync('e2e/debug/dispmap-compare/corner-mirrored.png', PNG.sync.write(testMap));

// Now the key question: can we use SVG to do this mirroring?
console.log('\n=== SVG Implementation ===');
console.log('Required SVG operations:');
console.log('1. feImage to load corner tile');
console.log('2. Multiple feImage instances with transform="scale(-1,1)" etc.');
console.log('3. feComposite to combine them');
console.log('4. OR use a pattern with patternTransform');

// Save the corner tile as a separate PNG
const cornerTile = new PNG({ width: cornerW, height: cornerH });
for (let y = 0; y < cornerH; y++) {
  for (let x = 0; x < cornerW; x++) {
    const src = getPixel(x, y);
    const dstIdx = (y * cornerW + x) * 4;
    cornerTile.data[dstIdx] = src.r;
    cornerTile.data[dstIdx + 1] = src.g;
    cornerTile.data[dstIdx + 2] = 0;
    cornerTile.data[dstIdx + 3] = 255;
  }
}
fs.writeFileSync('e2e/debug/dispmap-compare/corner-tile-150.png', PNG.sync.write(cornerTile));
console.log(`\nSaved corner tile: e2e/debug/dispmap-compare/corner-tile-150.png`);

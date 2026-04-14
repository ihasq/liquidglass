// Test: 9-slice scaling approach
// Create a displacement map where:
// - 4 corners are fixed size (contain the curved displacement)
// - 4 edges stretch (simple gradients)
// - Center is neutral (128, 128)

const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

console.log('=== 9-Slice Analysis ===\n');
console.log(`Original size: ${width}x${height}`);

// Analyze where the "active" displacement zones are
// Find the extent of non-neutral pixels

let maxActiveX = 0, maxActiveY = 0;
for (let y = 0; y < height / 2; y++) {
  for (let x = 0; x < width / 2; x++) {
    const { r, g } = getPixel(x, y);
    if (r !== 128 || g !== 128) {
      maxActiveX = Math.max(maxActiveX, x);
      maxActiveY = Math.max(maxActiveY, y);
    }
  }
}

console.log(`Active zone extends to x=${maxActiveX}, y=${maxActiveY}`);
console.log(`This suggests corner slices of ~${maxActiveX}x${maxActiveY} each`);

// The 9-slice would be:
// [TL corner] [Top edge] [TR corner]
// [Left edge] [Center  ] [Right edge]
// [BL corner] [Bot edge] [BR corner]

const cornerW = maxActiveX + 10;  // Add some margin
const cornerH = maxActiveY + 10;

console.log(`\nProposed slice sizes:`);
console.log(`Corner: ${cornerW}x${cornerH}`);
console.log(`Center: ${width - 2*cornerW}x${height - 2*cornerH}`);

// Extract just the top-left corner as a test
console.log('\n=== Extracting Corner Tile ===');

const cornerTile = new PNG({ width: cornerW, height: cornerH });
for (let y = 0; y < cornerH; y++) {
  for (let x = 0; x < cornerW; x++) {
    const srcIdx = (y * width + x) * 4;
    const dstIdx = (y * cornerW + x) * 4;
    cornerTile.data[dstIdx] = kubeMap.data[srcIdx];
    cornerTile.data[dstIdx + 1] = kubeMap.data[srcIdx + 1];
    cornerTile.data[dstIdx + 2] = 0;
    cornerTile.data[dstIdx + 3] = 255;
  }
}

fs.writeFileSync('e2e/debug/dispmap-compare/corner-tl.png', PNG.sync.write(cornerTile));
console.log(`Saved corner tile: ${cornerW}x${cornerH}`);

// Now test: can we reconstruct the full map from 9 slices?
// For this test, use the exact slices from kube's map

console.log('\n=== Reconstructing from 9 Slices ===');

const testMap = new PNG({ width, height });

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    
    // Determine which slice this pixel belongs to
    let srcX, srcY;
    
    // X coordinate mapping
    if (x < cornerW) {
      srcX = x;  // Left side
    } else if (x >= width - cornerW) {
      srcX = width - (width - x);  // Right side (mirror from right edge)
    } else {
      srcX = cornerW;  // Center (use edge value)
    }
    
    // Y coordinate mapping
    if (y < cornerH) {
      srcY = y;  // Top side
    } else if (y >= height - cornerH) {
      srcY = height - (height - y);  // Bottom side
    } else {
      srcY = cornerH;  // Center
    }
    
    // Get the source pixel
    const srcIdx = (srcY * width + srcX) * 4;
    testMap.data[idx] = kubeMap.data[srcIdx];
    testMap.data[idx + 1] = kubeMap.data[srcIdx + 1];
    testMap.data[idx + 2] = 0;
    testMap.data[idx + 3] = 255;
  }
}

// Compare
const totalPixels = width * height;
console.log('\nMatch with 9-slice reconstruction:');
for (let tolerance of [0, 1, 2, 3, 5, 10]) {
  let match = 0;
  for (let i = 0; i < totalPixels * 4; i += 4) {
    const rErr = Math.abs(kubeMap.data[i] - testMap.data[i]);
    const gErr = Math.abs(kubeMap.data[i + 1] - testMap.data[i + 1]);
    if (rErr <= tolerance && gErr <= tolerance) match++;
  }
  console.log(`Tolerance ≤${tolerance}: ${(match / totalPixels * 100).toFixed(2)}%`);
}

// The issue: edges aren't simple gradients, they have the curve shape
// Let's check if the edge slices are uniform (same value repeated)

console.log('\n=== Analyzing Edge Uniformity ===');

// Check top edge (y = cornerH, x varies from cornerW to width-cornerW)
const topEdgeY = cornerH;
let topEdgeUniform = true;
const refR = getPixel(cornerW, topEdgeY).r;
const refG = getPixel(cornerW, topEdgeY).g;
for (let x = cornerW; x < width - cornerW; x++) {
  const { r, g } = getPixel(x, topEdgeY);
  if (r !== refR || g !== refG) {
    topEdgeUniform = false;
    break;
  }
}
console.log(`Top edge uniform: ${topEdgeUniform}`);
console.log(`Top edge value at y=${topEdgeY}: R=${refR}, G=${refG}`);

// The edges aren't uniform because the displacement curve continues
// This means 9-slice won't work directly

// Alternative: What if we use a CONTINUOUS edge strip that can be stretched?
console.log('\n=== Continuous Edge Strip Approach ===');

// For the left edge, the R channel varies only with X (not Y, except near corners)
// Let's verify this by checking variance along Y at different X positions

console.log('Variance of R along Y at different X positions:');
for (let x of [5, 10, 20, 30, 40]) {
  const values = [];
  for (let y = cornerH; y < height - cornerH; y++) {
    values.push(getPixel(x, y).r);
  }
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length;
  console.log(`  x=${x}: avg=${avg.toFixed(1)}, variance=${variance.toFixed(2)}`);
}

// If variance is low, the edge strip approach can work!

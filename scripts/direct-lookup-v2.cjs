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

// Direct boundary lookups (exact from kube)
const LEFT_BOUNDARY = [];
const RIGHT_BOUNDARY = [];
for (let y = 0; y < height; y++) {
  // Left
  let leftB = width;
  for (let x = 0; x < width / 2; x++) {
    if (getPixel(x, y).r !== 128) { leftB = x; break; }
  }
  LEFT_BOUNDARY.push(leftB);
  
  // Right
  let rightB = width;
  for (let x = width - 1; x >= width / 2; x--) {
    if (getPixel(x, y).r !== 128) { rightB = width - 1 - x; break; }
  }
  RIGHT_BOUNDARY.push(rightB);
}

const TOP_BOUNDARY = [];
const BOTTOM_BOUNDARY = [];
for (let x = 0; x < width; x++) {
  // Top
  let topB = height;
  for (let y = 0; y < height / 2; y++) {
    if (getPixel(x, y).g !== 128) { topB = y; break; }
  }
  TOP_BOUNDARY.push(topB);
  
  // Bottom
  let bottomB = height;
  for (let y = height - 1; y >= height / 2; y--) {
    if (getPixel(x, y).g !== 128) { bottomB = height - 1 - y; break; }
  }
  BOTTOM_BOUNDARY.push(bottomB);
}

// Extract actual displacement curve + attenuation at each Y
// For each Y, extract the curve from the left edge
const CURVES_BY_Y = [];
for (let y = 0; y < height; y++) {
  const boundary = LEFT_BOUNDARY[y];
  const curve = [];
  for (let d = 0; d < 50; d++) {
    const x = boundary + d;
    if (x >= width / 2) break;
    curve.push(getPixel(x, y).r - 128);
  }
  // Pad with zeros
  while (curve.length < 50) curve.push(0);
  CURVES_BY_Y.push(curve);
}

// Similarly for X (G channel)
const CURVES_BY_X = [];
for (let x = 0; x < width; x++) {
  const boundary = TOP_BOUNDARY[x];
  const curve = [];
  for (let d = 0; d < 50; d++) {
    const yy = boundary + d;
    if (yy >= height / 2) break;
    curve.push(getPixel(x, yy).g - 128);
  }
  while (curve.length < 50) curve.push(0);
  CURVES_BY_X.push(curve);
}

// Generate map using extracted curves
const ourMap = new PNG({ width, height });

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    
    const distLeft = x;
    const distRight = width - 1 - x;
    const distTop = y;
    const distBottom = height - 1 - y;
    
    // R channel
    const leftB = LEFT_BOUNDARY[y];
    const rightB = RIGHT_BOUNDARY[y];
    // Use curve from corresponding y position
    const rCurve = CURVES_BY_Y[y];
    
    let r = 128;
    if (distLeft >= leftB && leftB < width) {
      const effectiveDist = distLeft - leftB;
      if (effectiveDist < rCurve.length && rCurve[effectiveDist] > 0) {
        r = 128 + rCurve[effectiveDist];
      }
    }
    if (r === 128 && distRight >= rightB && rightB < width) {
      const effectiveDist = distRight - rightB;
      // For right edge, use the same curve but flip the sign
      if (effectiveDist < rCurve.length && rCurve[effectiveDist] > 0) {
        r = 128 - rCurve[effectiveDist];
      }
    }
    
    // G channel
    const topB = TOP_BOUNDARY[x];
    const bottomB = BOTTOM_BOUNDARY[x];
    const gCurve = CURVES_BY_X[x];
    
    let g = 128;
    if (distTop >= topB && topB < height) {
      const effectiveDist = distTop - topB;
      if (effectiveDist < gCurve.length && gCurve[effectiveDist] > 0) {
        g = 128 + gCurve[effectiveDist];
      }
    }
    if (g === 128 && distBottom >= bottomB && bottomB < height) {
      const effectiveDist = distBottom - bottomB;
      if (effectiveDist < gCurve.length && gCurve[effectiveDist] > 0) {
        g = 128 - gCurve[effectiveDist];
      }
    }
    
    ourMap.data[idx] = r;
    ourMap.data[idx + 1] = g;
    ourMap.data[idx + 2] = 0;
    ourMap.data[idx + 3] = 255;
  }
}

// Compare
const diff = new PNG({ width, height });
const numDiffPixels = pixelmatch(
  kubeMap.data, ourMap.data, diff.data,
  width, height,
  { threshold: 0.01 }
);

const totalPixels = width * height;
const matchPercent = ((totalPixels - numDiffPixels) / totalPixels * 100).toFixed(4);

console.log(`Match: ${matchPercent}%`);
console.log(`Different pixels: ${numDiffPixels}`);

// Find max error
let maxRError = 0, maxGError = 0;
let maxRPos = null, maxGPos = null;
let avgRError = 0, avgGError = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const rErr = Math.abs(kubeMap.data[idx] - ourMap.data[idx]);
    const gErr = Math.abs(kubeMap.data[idx + 1] - ourMap.data[idx + 1]);
    avgRError += rErr;
    avgGError += gErr;
    if (rErr > maxRError) { maxRError = rErr; maxRPos = { x, y }; }
    if (gErr > maxGError) { maxGError = gErr; maxGPos = { x, y }; }
  }
}
console.log(`Avg R error: ${(avgRError / totalPixels).toFixed(4)}`);
console.log(`Avg G error: ${(avgGError / totalPixels).toFixed(4)}`);
console.log(`Max R error: ${maxRError} at (${maxRPos?.x}, ${maxRPos?.y})`);
console.log(`Max G error: ${maxGError} at (${maxGPos?.x}, ${maxGPos?.y})`);

fs.writeFileSync('e2e/debug/dispmap-compare/direct-v2.png', PNG.sync.write(ourMap));

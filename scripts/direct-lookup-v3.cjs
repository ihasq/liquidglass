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

// Extract curves for ALL FOUR edges separately
// Left edge R curves (indexed by y)
const LEFT_R_CURVES = [];
for (let y = 0; y < height; y++) {
  const curve = [];
  for (let x = 0; x < width / 2; x++) {
    const r = getPixel(x, y).r;
    if (r === 128) break;
    curve.push(r - 128);  // positive displacement
  }
  LEFT_R_CURVES.push(curve);
}

// Right edge R curves (indexed by y)
const RIGHT_R_CURVES = [];
for (let y = 0; y < height; y++) {
  const curve = [];
  for (let x = width - 1; x >= width / 2; x--) {
    const r = getPixel(x, y).r;
    if (r === 128) break;
    curve.push(128 - r);  // positive displacement magnitude
  }
  RIGHT_R_CURVES.push(curve);
}

// Top edge G curves (indexed by x)
const TOP_G_CURVES = [];
for (let x = 0; x < width; x++) {
  const curve = [];
  for (let y = 0; y < height / 2; y++) {
    const g = getPixel(x, y).g;
    if (g === 128) break;
    curve.push(g - 128);  // positive displacement
  }
  TOP_G_CURVES.push(curve);
}

// Bottom edge G curves (indexed by x)
const BOTTOM_G_CURVES = [];
for (let x = 0; x < width; x++) {
  const curve = [];
  for (let y = height - 1; y >= height / 2; y--) {
    const g = getPixel(x, y).g;
    if (g === 128) break;
    curve.push(128 - g);  // positive displacement magnitude
  }
  BOTTOM_G_CURVES.push(curve);
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
    const leftCurve = LEFT_R_CURVES[y];
    const rightCurve = RIGHT_R_CURVES[y];
    
    let r = 128;
    // Left edge
    if (distLeft < leftCurve.length) {
      r = 128 + leftCurve[distLeft];
    }
    // Right edge (only if left didn't apply)
    if (r === 128 && distRight < rightCurve.length) {
      r = 128 - rightCurve[distRight];
    }
    
    // G channel
    const topCurve = TOP_G_CURVES[x];
    const bottomCurve = BOTTOM_G_CURVES[x];
    
    let g = 128;
    // Top edge
    if (distTop < topCurve.length) {
      g = 128 + topCurve[distTop];
    }
    // Bottom edge (only if top didn't apply)
    if (g === 128 && distBottom < bottomCurve.length) {
      g = 128 - bottomCurve[distBottom];
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

fs.writeFileSync('e2e/debug/dispmap-compare/direct-v3.png', PNG.sync.write(ourMap));

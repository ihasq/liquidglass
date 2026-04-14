const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatchModule = require('pixelmatch'); const pixelmatch = pixelmatchModule.default || pixelmatchModule;
const path = require('path');

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Polynomial formula for boundary (degree 4 fit)
// boundary = 0.000001*m^4 - 0.000291*m^3 + 0.042638*m^2 - 3.316189*m + 127.665908
// where m = minDistTB
function boundaryFormula(minDist) {
  const m = minDist;
  return Math.max(0, 
    0.000001 * m * m * m * m 
    - 0.000291 * m * m * m 
    + 0.042638 * m * m 
    - 3.316189 * m 
    + 127.665908
  );
}

// Displacement curve: 127 * (1 - x/40)^3.93
// But first 2 pixels are saturated at 127
function displacementCurve(effectiveDist) {
  if (effectiveDist < 0) return 0;
  if (effectiveDist < 2) return 127;
  const t = effectiveDist / 40;
  if (t >= 1) return 0;
  return Math.round(127 * Math.pow(1 - t, 3.93));
}

// Attenuation based on minDistTB
// Looking at the data, attenuation ≈ sqrt(minDistTB / 90) capped at 1
function attenuationFactor(minDist) {
  if (minDist >= 90) return 1;
  return Math.sqrt(minDist / 90);
}

// Generate our displacement map
const ourMap = new PNG({ width, height });

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
    const rBoundary = boundaryFormula(minDistTB);
    const rAttenuation = attenuationFactor(minDistTB);
    
    let r = 128;
    if (distLeft >= rBoundary) {
      const effectiveDist = distLeft - rBoundary;
      const baseDisp = displacementCurve(effectiveDist);
      const disp = Math.round(baseDisp * rAttenuation);
      if (disp > 0) r = 128 + disp;
    }
    if (r === 128 && distRight >= rBoundary) {
      const effectiveDist = distRight - rBoundary;
      const baseDisp = displacementCurve(effectiveDist);
      const disp = Math.round(baseDisp * rAttenuation);
      if (disp > 0) r = 128 - disp;
    }
    
    // G channel
    const gBoundary = boundaryFormula(minDistLR);
    const gAttenuation = attenuationFactor(minDistLR);
    
    let g = 128;
    if (distTop >= gBoundary) {
      const effectiveDist = distTop - gBoundary;
      const baseDisp = displacementCurve(effectiveDist);
      const disp = Math.round(baseDisp * gAttenuation);
      if (disp > 0) g = 128 + disp;
    }
    if (g === 128 && distBottom >= gBoundary) {
      const effectiveDist = distBottom - gBoundary;
      const baseDisp = displacementCurve(effectiveDist);
      const disp = Math.round(baseDisp * gAttenuation);
      if (disp > 0) g = 128 - disp;
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
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const rErr = Math.abs(kubeMap.data[idx] - ourMap.data[idx]);
    const gErr = Math.abs(kubeMap.data[idx + 1] - ourMap.data[idx + 1]);
    if (rErr > maxRError) { maxRError = rErr; maxRPos = { x, y }; }
    if (gErr > maxGError) { maxGError = gErr; maxGPos = { x, y }; }
  }
}
console.log(`Max R error: ${maxRError} at (${maxRPos.x}, ${maxRPos.y})`);
console.log(`Max G error: ${maxGError} at (${maxGPos.x}, ${maxGPos.y})`);

// Save
fs.writeFileSync('e2e/debug/dispmap-compare/formula-based.png', PNG.sync.write(ourMap));
fs.writeFileSync('e2e/debug/dispmap-compare/formula-diff.png', PNG.sync.write(diff));

// Analyze error point
console.log('\n=== Analyzing max R error point ===');
const kubeR = getPixel(maxRPos.x, maxRPos.y).r;
const ourR = ourMap.data[(maxRPos.y * width + maxRPos.x) * 4];
console.log(`Kube: ${kubeR}, Ours: ${ourR}`);
console.log(`distLeft: ${maxRPos.x}, minDistTB: ${Math.min(maxRPos.y, height - 1 - maxRPos.y)}`);

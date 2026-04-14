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

// For LEFT edge at each Y: find boundary and extract curve
const LEFT_DATA = [];
for (let y = 0; y < height; y++) {
  let boundary = width;
  for (let x = 0; x < width / 2; x++) {
    if (getPixel(x, y).r !== 128) { boundary = x; break; }
  }
  const curve = [];
  for (let d = 0; d < 50; d++) {
    const x = boundary + d;
    if (x >= width / 2) break;
    curve.push(getPixel(x, y).r - 128);
  }
  LEFT_DATA.push({ boundary, curve });
}

// For RIGHT edge at each Y: find boundary and extract curve
const RIGHT_DATA = [];
for (let y = 0; y < height; y++) {
  let boundary = width;
  for (let x = width - 1; x >= width / 2; x--) {
    if (getPixel(x, y).r !== 128) { boundary = width - 1 - x; break; }
  }
  const curve = [];
  for (let d = 0; d < 50; d++) {
    const xFromRight = width - 1 - boundary - d;
    if (xFromRight < width / 2) break;
    curve.push(128 - getPixel(xFromRight, y).r);  // Store as positive magnitude
  }
  RIGHT_DATA.push({ boundary, curve });
}

// For TOP edge at each X
const TOP_DATA = [];
for (let x = 0; x < width; x++) {
  let boundary = height;
  for (let y = 0; y < height / 2; y++) {
    if (getPixel(x, y).g !== 128) { boundary = y; break; }
  }
  const curve = [];
  for (let d = 0; d < 50; d++) {
    const yy = boundary + d;
    if (yy >= height / 2) break;
    curve.push(getPixel(x, yy).g - 128);
  }
  TOP_DATA.push({ boundary, curve });
}

// For BOTTOM edge at each X
const BOTTOM_DATA = [];
for (let x = 0; x < width; x++) {
  let boundary = height;
  for (let y = height - 1; y >= height / 2; y--) {
    if (getPixel(x, y).g !== 128) { boundary = height - 1 - y; break; }
  }
  const curve = [];
  for (let d = 0; d < 50; d++) {
    const yFromBottom = height - 1 - boundary - d;
    if (yFromBottom < height / 2) break;
    curve.push(128 - getPixel(x, yFromBottom).g);
  }
  BOTTOM_DATA.push({ boundary, curve });
}

// Generate map
const ourMap = new PNG({ width, height });

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    
    const distLeft = x;
    const distRight = width - 1 - x;
    const distTop = y;
    const distBottom = height - 1 - y;
    
    // R channel
    const leftD = LEFT_DATA[y];
    const rightD = RIGHT_DATA[y];
    
    let r = 128;
    // Left edge
    if (distLeft >= leftD.boundary && leftD.boundary < width) {
      const effectiveDist = distLeft - leftD.boundary;
      if (effectiveDist < leftD.curve.length && leftD.curve[effectiveDist] > 0) {
        r = 128 + leftD.curve[effectiveDist];
      }
    }
    // Right edge (only if left didn't apply)
    if (r === 128 && distRight >= rightD.boundary && rightD.boundary < width) {
      const effectiveDist = distRight - rightD.boundary;
      if (effectiveDist < rightD.curve.length && rightD.curve[effectiveDist] > 0) {
        r = 128 - rightD.curve[effectiveDist];
      }
    }
    
    // G channel
    const topD = TOP_DATA[x];
    const bottomD = BOTTOM_DATA[x];
    
    let g = 128;
    // Top edge
    if (distTop >= topD.boundary && topD.boundary < height) {
      const effectiveDist = distTop - topD.boundary;
      if (effectiveDist < topD.curve.length && topD.curve[effectiveDist] > 0) {
        g = 128 + topD.curve[effectiveDist];
      }
    }
    // Bottom edge (only if top didn't apply)
    if (g === 128 && distBottom >= bottomD.boundary && bottomD.boundary < height) {
      const effectiveDist = distBottom - bottomD.boundary;
      if (effectiveDist < bottomD.curve.length && bottomD.curve[effectiveDist] > 0) {
        g = 128 - bottomD.curve[effectiveDist];
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

fs.writeFileSync('e2e/debug/dispmap-compare/direct-v4.png', PNG.sync.write(ourMap));

// Verify a specific point
console.log('\n=== Verify (419, 140) ===');
const rightD = RIGHT_DATA[140];
console.log(`y=140 right boundary: ${rightD.boundary}`);
console.log(`y=140 right curve: ${rightD.curve.slice(0, 10)}`);
console.log(`distRight at x=419: ${width - 1 - 419}`);

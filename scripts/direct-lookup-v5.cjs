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
// Key change: don't stop at 128, extract the full range
const LEFT_DATA = [];
for (let y = 0; y < height; y++) {
  let boundary = width;
  for (let x = 0; x < width / 2; x++) {
    if (getPixel(x, y).r !== 128) { boundary = x; break; }
  }
  const curve = [];
  // Extend extraction until we hit 128 OR go past center
  for (let d = 0; d < 60; d++) {
    const x = boundary + d;
    if (x >= width / 2) break;
    const disp = getPixel(x, y).r - 128;
    curve.push(disp);
    // Stop if we've had several 0s in a row (we're past the curve)
    if (d >= 5 && curve.slice(-5).every(v => v === 0)) break;
  }
  LEFT_DATA.push({ boundary, curve });
}

// For RIGHT edge at each Y
const RIGHT_DATA = [];
for (let y = 0; y < height; y++) {
  let boundary = width;
  for (let x = width - 1; x >= width / 2; x--) {
    if (getPixel(x, y).r !== 128) { boundary = width - 1 - x; break; }
  }
  const curve = [];
  for (let d = 0; d < 60; d++) {
    const xFromRight = width - 1 - boundary - d;
    if (xFromRight < width / 2) break;
    const disp = 128 - getPixel(xFromRight, y).r;
    curve.push(disp);
    if (d >= 5 && curve.slice(-5).every(v => v === 0)) break;
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
  for (let d = 0; d < 60; d++) {
    const yy = boundary + d;
    if (yy >= height / 2) break;
    const disp = getPixel(x, yy).g - 128;
    curve.push(disp);
    if (d >= 5 && curve.slice(-5).every(v => v === 0)) break;
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
  for (let d = 0; d < 60; d++) {
    const yFromBottom = height - 1 - boundary - d;
    if (yFromBottom < height / 2) break;
    const disp = 128 - getPixel(x, yFromBottom).g;
    curve.push(disp);
    if (d >= 5 && curve.slice(-5).every(v => v === 0)) break;
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
      if (effectiveDist < leftD.curve.length) {
        const disp = leftD.curve[effectiveDist];
        if (disp > 0) r = 128 + disp;
      }
    }
    // Right edge (only if left didn't apply)
    if (r === 128 && distRight >= rightD.boundary && rightD.boundary < width) {
      const effectiveDist = distRight - rightD.boundary;
      if (effectiveDist < rightD.curve.length) {
        const disp = rightD.curve[effectiveDist];
        if (disp > 0) r = 128 - disp;
      }
    }
    
    // G channel
    const topD = TOP_DATA[x];
    const bottomD = BOTTOM_DATA[x];
    
    let g = 128;
    // Top edge
    if (distTop >= topD.boundary && topD.boundary < height) {
      const effectiveDist = distTop - topD.boundary;
      if (effectiveDist < topD.curve.length) {
        const disp = topD.curve[effectiveDist];
        if (disp > 0) g = 128 + disp;
      }
    }
    // Bottom edge (only if top didn't apply)
    if (g === 128 && distBottom >= bottomD.boundary && bottomD.boundary < height) {
      const effectiveDist = distBottom - bottomD.boundary;
      if (effectiveDist < bottomD.curve.length) {
        const disp = bottomD.curve[effectiveDist];
        if (disp > 0) g = 128 - disp;
      }
    }
    
    ourMap.data[idx] = r;
    ourMap.data[idx + 1] = g;
    ourMap.data[idx + 2] = 0;
    ourMap.data[idx + 3] = 255;
  }
}

// Calculate match by tolerance
const totalPixels = width * height;
for (let tolerance = 0; tolerance <= 3; tolerance++) {
  let match = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const rErr = Math.abs(kubeMap.data[idx] - ourMap.data[idx]);
      const gErr = Math.abs(kubeMap.data[idx + 1] - ourMap.data[idx + 1]);
      if (rErr <= tolerance && gErr <= tolerance) match++;
    }
  }
  console.log(`Tolerance ≤${tolerance}: ${match}/${totalPixels} = ${(match/totalPixels*100).toFixed(4)}%`);
}

fs.writeFileSync('e2e/debug/dispmap-compare/direct-v5.png', PNG.sync.write(ourMap));

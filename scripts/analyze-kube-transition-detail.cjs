// Detailed analysis of kube.io transition zones
const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  if (x < 0 || x >= width || y < 0 || y >= height) return { r: 128, g: 128 };
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Analyze the top edge at different Y positions
console.log('=== Top edge G values at different Y positions ===');
for (let y = 0; y <= 5; y++) {
  let firstActive = -1;
  let lastActive = -1;
  for (let x = 0; x < width; x++) {
    const p = getPixel(x, y);
    if (p.g !== 128) {
      if (firstActive === -1) firstActive = x;
      lastActive = x;
    }
  }
  console.log(`y=${y}: active G from x=${firstActive} to x=${lastActive}`);
}

// Analyze left edge R values at different X positions
console.log('\n=== Left edge R values at different X positions ===');
for (let x = 0; x <= 5; x++) {
  let firstActive = -1;
  let lastActive = -1;
  for (let y = 0; y < height; y++) {
    const p = getPixel(x, y);
    if (p.r !== 128) {
      if (firstActive === -1) firstActive = y;
      lastActive = y;
    }
  }
  console.log(`x=${x}: active R from y=${firstActive} to y=${lastActive}`);
}

// Check the specific point with max error (394, 66)
console.log('\n=== Analysis of error region (394, 66) ===');
for (let x = 390; x <= 400; x++) {
  for (let y = 60; y <= 70; y++) {
    const p = getPixel(x, y);
    if (p.r !== 128 || p.g !== 128) {
      console.log(`(${x}, ${y}): R=${p.r}, G=${p.g}`);
    }
  }
}

// Map out the corner transition shape
console.log('\n=== Corner shape: where does G become active on each row? ===');
for (let y = 0; y < 50; y++) {
  let firstActiveX = -1;
  for (let x = 0; x < width / 2; x++) {
    if (getPixel(x, y).g !== 128) {
      firstActiveX = x;
      break;
    }
  }
  if (firstActiveX > 0) {
    console.log(`y=${y}: G starts at x=${firstActiveX}`);
  }
}

// Check if the corner mask follows a circular/elliptical pattern
console.log('\n=== Corner radius analysis (distance from TL corner where activity starts) ===');
for (let y = 0; y < 50; y++) {
  for (let x = 0; x < width / 2; x++) {
    const p = getPixel(x, y);
    if (p.r !== 128 || p.g !== 128) {
      const dist = Math.sqrt(x * x + y * y);
      console.log(`First active at (${x}, ${y}), dist from corner: ${dist.toFixed(1)}`);
      break;
    }
  }
}

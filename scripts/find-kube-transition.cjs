// Find where kube.io displacement transitions from neutral to active
const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  if (x < 0 || x >= width || y < 0 || y >= height) return { r: 128, g: 128 };
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Find first non-128 G value along top edge (y=0)
console.log('=== Top edge (y=0): Finding first G != 128 ===');
for (let x = 0; x < width; x++) {
  const p = getPixel(x, 0);
  if (p.g !== 128) {
    console.log(`First non-128 G at x=${x}: G=${p.g}`);
    // Show surrounding values
    for (let dx = -5; dx <= 5; dx++) {
      const px = getPixel(x + dx, 0);
      console.log(`  (${x+dx}, 0): G=${px.g}`);
    }
    break;
  }
}

// Find first non-128 R value along left edge (x=0)
console.log('\n=== Left edge (x=0): Finding first R != 128 ===');
for (let y = 0; y < height; y++) {
  const p = getPixel(0, y);
  if (p.r !== 128) {
    console.log(`First non-128 R at y=${y}: R=${p.r}`);
    for (let dy = -5; dy <= 5; dy++) {
      const py = getPixel(0, y + dy);
      console.log(`  (0, ${y+dy}): R=${py.r}`);
    }
    break;
  }
}

// Check the pattern more systematically - scan from center outward
console.log('\n=== Scan from top-center downward ===');
const cx = Math.floor(width / 2);
for (let y = 0; y < 50; y++) {
  const p = getPixel(cx, y);
  console.log(`(${cx}, ${y}): R=${p.r}, G=${p.g}`);
}

console.log('\n=== Scan from left-center rightward ===');
const cy = Math.floor(height / 2);
for (let x = 0; x < 50; x++) {
  const p = getPixel(x, cy);
  console.log(`(${x}, ${cy}): R=${p.r}, G=${p.g}`);
}

// Check corner radius - find where displacement starts on diagonal from corner
console.log('\n=== Diagonal from corner: Finding active zone ===');
// Move along x at y=50 (well inside the rectangle)
console.log('At y=50:');
for (let x = 0; x < 60; x++) {
  const p = getPixel(x, 50);
  if (p.r !== 128 || p.g !== 128) {
    console.log(`First non-neutral at (${x}, 50): R=${p.r}, G=${p.g}`);
    break;
  }
}

// Move along y at x=50
console.log('At x=50:');
for (let y = 0; y < 60; y++) {
  const p = getPixel(50, y);
  if (p.r !== 128 || p.g !== 128) {
    console.log(`First non-neutral at (50, ${y}): R=${p.r}, G=${p.g}`);
    break;
  }
}

// Summary: find the "active zone" bounds
console.log('\n=== Active Zone Analysis ===');

// Find leftmost active X at center Y
let leftBound = 0;
for (let x = 0; x < width; x++) {
  if (getPixel(x, cy).r !== 128) {
    leftBound = x;
    break;
  }
}

// Find rightmost active X at center Y
let rightBound = width - 1;
for (let x = width - 1; x >= 0; x--) {
  if (getPixel(x, cy).r !== 128) {
    rightBound = x;
    break;
  }
}

// Find topmost active Y at center X
let topBound = 0;
for (let y = 0; y < height; y++) {
  if (getPixel(cx, y).g !== 128) {
    topBound = y;
    break;
  }
}

// Find bottommost active Y at center X
let bottomBound = height - 1;
for (let y = height - 1; y >= 0; y--) {
  if (getPixel(cx, y).g !== 128) {
    bottomBound = y;
    break;
  }
}

console.log(`Active R zone: x=${leftBound} to x=${rightBound}`);
console.log(`Active G zone: y=${topBound} to y=${bottomBound}`);
console.log(`Inactive corner radius: ~${leftBound} pixels (approximately)`);

// Analyze kube.io displacement map corners and edges in detail
const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

console.log(`Kube map: ${width}x${height}\n`);

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
}

// Corners
console.log('=== Corners ===');
console.log(`Top-Left     (0,0):       R=${getPixel(0,0).r}, G=${getPixel(0,0).g}`);
console.log(`Top-Right    (${width-1},0):     R=${getPixel(width-1,0).r}, G=${getPixel(width-1,0).g}`);
console.log(`Bottom-Left  (0,${height-1}):     R=${getPixel(0,height-1).r}, G=${getPixel(0,height-1).g}`);
console.log(`Bottom-Right (${width-1},${height-1}): R=${getPixel(width-1,height-1).r}, G=${getPixel(width-1,height-1).g}`);

// Near corners (5 pixels in)
console.log('\n=== Near Corners (5px in) ===');
console.log(`Near TL (5,5):   R=${getPixel(5,5).r}, G=${getPixel(5,5).g}`);
console.log(`Near TR (${width-6},5): R=${getPixel(width-6,5).r}, G=${getPixel(width-6,5).g}`);
console.log(`Near BL (5,${height-6}): R=${getPixel(5,height-6).r}, G=${getPixel(5,height-6).g}`);
console.log(`Near BR (${width-6},${height-6}): R=${getPixel(width-6,height-6).r}, G=${getPixel(width-6,height-6).g}`);

// Edge centers
console.log('\n=== Edge Centers ===');
const cx = Math.floor(width / 2);
const cy = Math.floor(height / 2);
console.log(`Top center    (${cx},0):   R=${getPixel(cx,0).r}, G=${getPixel(cx,0).g}`);
console.log(`Bottom center (${cx},${height-1}): R=${getPixel(cx,height-1).r}, G=${getPixel(cx,height-1).g}`);
console.log(`Left center   (0,${cy}):   R=${getPixel(0,cy).r}, G=${getPixel(0,cy).g}`);
console.log(`Right center  (${width-1},${cy}): R=${getPixel(width-1,cy).r}, G=${getPixel(width-1,cy).g}`);

// Center
console.log('\n=== Center ===');
console.log(`Center (${cx},${cy}): R=${getPixel(cx,cy).r}, G=${getPixel(cx,cy).g}`);

// Diagonal from corner
console.log('\n=== Diagonal from Top-Left ===');
for (let d = 0; d < 20; d++) {
  const p = getPixel(d, d);
  console.log(`(${d},${d}): R=${p.r}, G=${p.g}`);
}

// Check if R is always 128 on top/bottom edges (away from corners)
console.log('\n=== Top Edge (y=0), X from 40 to 60 ===');
for (let x = 40; x <= 60; x++) {
  const p = getPixel(x, 0);
  console.log(`(${x},0): R=${p.r}, G=${p.g}`);
}

// Check corner zone size
console.log('\n=== Finding corner zone size ===');
console.log('Checking where top edge starts having G=255...');
for (let x = 0; x < 50; x++) {
  const p = getPixel(x, 0);
  if (p.g === 255) {
    console.log(`First G=255 at x=${x} on top edge`);
    break;
  }
  console.log(`(${x},0): G=${p.g}`);
}

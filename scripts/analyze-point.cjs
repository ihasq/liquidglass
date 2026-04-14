const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Analyze (129, 0)
const x = 129, y = 0;
const p = getPixel(x, y);
console.log(`Point (${x}, ${y}): R=${p.r}, G=${p.g}`);

const distLeft = x;
const distRight = width - 1 - x;
const distTop = y;
const distBottom = height - 1 - y;
console.log(`Distances: L=${distLeft}, R=${distRight}, T=${distTop}, B=${distBottom}`);

// Sample top edge at y=0
console.log('\nTop edge (y=0) R and G values:');
let line1 = 'R: ';
let line2 = 'G: ';
for (let xx = 0; xx <= 20; xx++) {
  line1 += `${getPixel(xx, 0).r} `;
  line2 += `${getPixel(xx, 0).g} `;
}
console.log(line1);
console.log(line2);

// Check center rows
console.log('\nCenter row (y=150) first 20 pixels R:');
let centerLine = '';
for (let xx = 0; xx < 20; xx++) {
  centerLine += `${getPixel(xx, 150).r} `;
}
console.log(centerLine);

// Compare: at y=0 (corner), where does R become active?
// At y=150 (center), where does R become active?
console.log('\nWhere R first becomes non-128:');
for (let yy = 0; yy <= 150; yy += 30) {
  let firstX = -1;
  for (let xx = 0; xx < width / 2; xx++) {
    if (getPixel(xx, yy).r !== 128) {
      firstX = xx;
      break;
    }
  }
  console.log(`y=${yy}: first non-128 R at x=${firstX} (distLeft=${firstX})`);
}

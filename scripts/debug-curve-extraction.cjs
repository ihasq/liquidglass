const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Check y=17 specifically (where error occurs at x=140)
const y = 17;
console.log(`=== Y=${y} ===`);

// Find left boundary
let leftB = width;
for (let x = 0; x < width / 2; x++) {
  if (getPixel(x, y).r !== 128) { leftB = x; break; }
}
console.log(`Left boundary: ${leftB}`);

// Extract R values from boundary onward
console.log('R values from boundary:');
for (let d = 0; d < 10; d++) {
  const x = leftB + d;
  const r = getPixel(x, y).r;
  const disp = r - 128;
  console.log(`  x=${x} (dist=${d}): R=${r}, disp=${disp}`);
}

// What does kube have at x=140?
console.log(`\nKube at x=140: R=${getPixel(140, y).r}`);
console.log(`distLeft at x=140: ${140}`);
console.log(`effectiveDist: ${140 - leftB}`);

// Check the error - kube has R=130 at x=140, y=17
// Our code would need effectiveDist = 140 - leftB to fall in the curve range

const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Check (140, 0) and surrounding
console.log('Around (140, 0):');
for (let x = 138; x <= 145; x++) {
  const p = getPixel(x, 0);
  console.log(`x=${x}, y=0: R=${p.r}, G=${p.g}`);
}

// Check the first few rows at x=140
console.log('\nAt x=140, varying y:');
for (let y = 0; y < 10; y++) {
  const p = getPixel(140, y);
  console.log(`x=140, y=${y}: R=${p.r}, G=${p.g}`);
}

// Also check what our code produces
console.log('\n=== What our code produces ===');
const KUBE_CURVE = [
  127, 127, 111, 99, 84, 75, 65, 59, 51, 45,
  41, 36, 33, 29, 27, 24, 22, 19, 17, 16,
  14, 12, 11, 10, 9, 7, 7, 6, 5, 4,
  4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 0
];
const LEFT_BOUNDARY_Y0 = 140;

// At (140, 0): distLeft=140, boundary=140
console.log(`distLeft=140, boundary=${LEFT_BOUNDARY_Y0}`);
console.log(`effectiveDist = 140 - 140 = 0`);
console.log(`disp = KUBE_CURVE[0] = ${KUBE_CURVE[0]}`);
console.log(`r = 128 + ${KUBE_CURVE[0]} = ${128 + KUBE_CURVE[0]}`);
console.log(`Kube has: R=${getPixel(140, 0).r}`);

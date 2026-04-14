// Analyze specific error point
const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Analyze point (394, 66)
const x = 394, y = 66;
const p = getPixel(x, y);
console.log(`Point (${x}, ${y}): R=${p.r}, G=${p.g}`);

// Distances
const distLeft = x;
const distRight = width - 1 - x;
const distTop = y;
const distBottom = height - 1 - y;
console.log(`Distances: left=${distLeft}, right=${distRight}, top=${distTop}, bottom=${distBottom}`);

// Corner boundary lookup
const CORNER_BOUNDARY = [
  140, 130, 124, 119, 114, 111, 107, 104, 101, 98,
  96, 93, 91, 88, 86, 84, 82, 80, 78, 77,
  75, 73, 72, 70, 68, 67, 65, 64, 63, 61,
  60, 59, 57, 56, 55, 54, 52, 51, 50, 49,
  48, 47, 46, 45, 44, 43, 42, 41, 40, 39,
  38, 37, 36, 36, 35, 34, 33, 32, 32, 31,
  30, 29, 29, 28, 27, 26, 26, 25, 24, 24
];

function getCornerBoundary(dist) {
  if (dist >= CORNER_BOUNDARY.length) return 0;
  return CORNER_BOUNDARY[dist];
}

const minDistFromTB = Math.min(distTop, distBottom);
const minDistFromLR = Math.min(distLeft, distRight);
console.log(`Min dist from T/B: ${minDistFromTB}, from L/R: ${minDistFromLR}`);

const cornerThresholdForR = getCornerBoundary(minDistFromTB);
const cornerThresholdForG = getCornerBoundary(minDistFromLR);
console.log(`Corner threshold for R (based on T/B): ${cornerThresholdForR}`);
console.log(`Corner threshold for G (based on L/R): ${cornerThresholdForG}`);

// Check what our algorithm would produce
const KUBE_CURVE = [
  255, 255, 239, 227, 212, 203, 193, 187, 179, 173,
  169, 164, 161, 157, 155, 152, 150, 147, 145, 144,
  142, 140, 139, 138, 137, 135, 135, 134, 133, 132,
  132, 131, 131, 130, 130, 130, 129, 129, 129, 129
];

// For R (X displacement)
let ourR = 128;
if (distRight < cornerThresholdForR + KUBE_CURVE.length) {
  const effectiveDist = distRight - cornerThresholdForR;
  console.log(`Right edge: effectiveDist = ${distRight} - ${cornerThresholdForR} = ${effectiveDist}`);
  if (effectiveDist >= 0 && effectiveDist < KUBE_CURVE.length) {
    ourR = 255 - KUBE_CURVE[effectiveDist];
    console.log(`R from curve[${effectiveDist}] = 255 - ${KUBE_CURVE[effectiveDist]} = ${ourR}`);
  }
}

// For G (Y displacement)
let ourG = 128;
if (distTop < cornerThresholdForG + KUBE_CURVE.length) {
  const effectiveDist = distTop - cornerThresholdForG;
  console.log(`Top edge: effectiveDist = ${distTop} - ${cornerThresholdForG} = ${effectiveDist}`);
  if (effectiveDist >= 0 && effectiveDist < KUBE_CURVE.length) {
    ourG = KUBE_CURVE[effectiveDist];
    console.log(`G from curve[${effectiveDist}] = ${KUBE_CURVE[effectiveDist]}`);
  }
}

console.log(`\nKube: R=${p.r}, G=${p.g}`);
console.log(`Ours: R=${ourR}, G=${ourG}`);
console.log(`Diff: R=${Math.abs(p.r - ourR)}, G=${Math.abs(p.g - ourG)}`);

// Sample surrounding area
console.log('\n=== Surrounding area ===');
for (let dy = -3; dy <= 3; dy++) {
  let line = '';
  for (let dx = -3; dx <= 3; dx++) {
    const px = getPixel(x + dx, y + dy);
    line += `(${px.r},${px.g}) `;
  }
  console.log(`y=${y + dy}: ${line}`);
}

// Use Z3 SMT solver to find the mathematical formula for kube.io's displacement map
import { init } from 'z3-solver';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Extract key data points for the solver
const dataPoints = [];

// Sample boundary points (where R first becomes non-128)
for (let y = 0; y < height / 2; y += 5) {
  for (let x = 0; x < width / 2; x++) {
    const p = getPixel(x, y);
    if (p.r !== 128) {
      dataPoints.push({
        type: 'boundary',
        y,
        boundary: x,
        minDistTB: y,
        firstR: p.r - 128
      });
      break;
    }
  }
}

// Sample displacement curve points at center (y=150)
const centerY = 150;
for (let x = 0; x < 45; x++) {
  const p = getPixel(x, centerY);
  if (p.r !== 128) {
    dataPoints.push({
      type: 'curve',
      x,
      displacement: p.r - 128
    });
  }
}

// Sample attenuation at different y values (max R value at boundary)
for (let y = 0; y < 150; y += 10) {
  // Find boundary
  let boundary = 0;
  for (let x = 0; x < width / 2; x++) {
    if (getPixel(x, y).r !== 128) {
      boundary = x;
      break;
    }
  }
  if (boundary > 0) {
    const maxR = getPixel(boundary, y).r - 128;
    dataPoints.push({
      type: 'attenuation',
      y,
      minDistTB: y,
      maxDisplacement: maxR
    });
  }
}

console.log('Data points extracted:', dataPoints.length);

// Initialize Z3
const { Context } = await init();
const Z3 = Context('main');

// We'll try to find a formula of the form:
// boundary(minDist) = a * sqrt(b * (c - minDist)) for minDist < c, else 0
// attenuation(minDist) = min(1, (minDist / d)^e)
// displacement(dist) = f * (1 - dist/g)^h for dist < g, else 0

// Create real variables for parameters
const a = Z3.Real.const('a');  // boundary scale
const b = Z3.Real.const('b');  // boundary inner scale
const c = Z3.Real.const('c');  // boundary max minDist
const d = Z3.Real.const('d');  // attenuation threshold
const e = Z3.Real.const('e');  // attenuation power
const f = Z3.Real.const('f');  // displacement max (should be ~127)
const g = Z3.Real.const('g');  // displacement zone size (should be ~40)
const h = Z3.Real.const('h');  // displacement curve power

const solver = new Z3.Solver();

// Add constraints based on observed data
// First, let's just try to find the boundary formula

// Boundary data: at minDistTB=y, boundary=x
const boundaryData = dataPoints.filter(p => p.type === 'boundary');
console.log('\nBoundary data points:');
boundaryData.forEach(p => console.log(`  minDistTB=${p.minDistTB}, boundary=${p.boundary}`));

// Try hypothesis: boundary = A * sqrt(B - minDistTB) for some A, B
// At minDistTB=0, boundary=140: 140 = A * sqrt(B)
// At minDistTB=140, boundary=0: 0 = A * sqrt(B - 140) => B = 140

// So boundary = A * sqrt(140 - minDistTB)
// At minDistTB=0: 140 = A * sqrt(140) => A = 140/sqrt(140) = sqrt(140) ≈ 11.83

const testA = Math.sqrt(140);
console.log('\nTesting hypothesis: boundary = sqrt(140) * sqrt(140 - minDistTB)');
console.log('= sqrt(140 * (140 - minDistTB))');
console.log('= sqrt(19600 - 140*minDistTB)');

let totalError = 0;
boundaryData.forEach(p => {
  const predicted = Math.sqrt(140 * (140 - p.minDistTB));
  const error = Math.abs(predicted - p.boundary);
  totalError += error;
  console.log(`  minDistTB=${p.minDistTB}: actual=${p.boundary}, predicted=${predicted.toFixed(1)}, error=${error.toFixed(1)}`);
});
console.log(`Total boundary error: ${totalError.toFixed(1)}`);

// Try another form: boundary = A * (B - minDistTB)^C
console.log('\nTrying: boundary = A * (B - minDistTB)^C');

// At minDistTB=0, boundary=140: 140 = A * B^C
// At minDistTB=70, boundary=23: 23 = A * (B-70)^C
// At minDistTB=140, boundary=0: 0 = A * (B-140)^C => B = 140

// So: 140 = A * 140^C and 23 = A * 70^C
// 140/23 = (140/70)^C = 2^C
// log(140/23) / log(2) = C
const C = Math.log(140/23) / Math.log(2);
console.log(`C = log(140/23) / log(2) = ${C.toFixed(4)}`);
// A = 140 / 140^C
const A = 140 / Math.pow(140, C);
console.log(`A = 140 / 140^${C.toFixed(4)} = ${A.toFixed(4)}`);

console.log('\nTesting: boundary = ' + A.toFixed(4) + ' * (140 - minDistTB)^' + C.toFixed(4));
totalError = 0;
boundaryData.forEach(p => {
  const predicted = A * Math.pow(Math.max(0, 140 - p.minDistTB), C);
  const error = Math.abs(predicted - p.boundary);
  totalError += error;
  if (p.minDistTB % 20 === 0) {
    console.log(`  minDistTB=${p.minDistTB}: actual=${p.boundary}, predicted=${predicted.toFixed(1)}, error=${error.toFixed(1)}`);
  }
});
console.log(`Total boundary error: ${totalError.toFixed(1)}`);

// Let's also check the displacement curve
console.log('\n=== Displacement Curve Analysis ===');
const curveData = dataPoints.filter(p => p.type === 'curve');
console.log('Curve data (distance from edge, displacement):');
curveData.slice(0, 15).forEach(p => console.log(`  x=${p.x}: ${p.displacement}`));

// Hypothesis: displacement = 127 * (1 - x/40)^N for x < 40
// At x=0: 127 = 127 * 1^N (ok)
// At x=10: 41 = 127 * (1 - 10/40)^N = 127 * 0.75^N
// 41/127 = 0.75^N
// N = log(41/127) / log(0.75)
const N = Math.log(41/127) / Math.log(0.75);
console.log(`\nTrying: displacement = 127 * (1 - x/40)^N`);
console.log(`N = log(41/127) / log(0.75) = ${N.toFixed(4)}`);

totalError = 0;
curveData.forEach(p => {
  const t = p.x / 40;
  const predicted = t < 1 ? Math.round(127 * Math.pow(1 - t, N)) : 0;
  const error = Math.abs(predicted - p.displacement);
  totalError += error;
});
console.log(`Total curve error with N=${N.toFixed(2)}: ${totalError}`);

// Try different zone sizes
for (let zone = 38; zone <= 42; zone++) {
  for (let n = 3; n <= 4; n += 0.25) {
    let err = 0;
    curveData.forEach(p => {
      const t = p.x / zone;
      const predicted = t < 1 ? Math.round(127 * Math.pow(1 - t, n)) : 0;
      err += Math.abs(predicted - p.displacement);
    });
    if (err < 100) {
      console.log(`zone=${zone}, n=${n}: error=${err}`);
    }
  }
}

// Attenuation analysis
console.log('\n=== Attenuation Analysis ===');
const attenData = dataPoints.filter(p => p.type === 'attenuation');
attenData.forEach(p => {
  const ratio = p.maxDisplacement / 127;
  console.log(`  minDistTB=${p.minDistTB}: maxDisp=${p.maxDisplacement}, ratio=${ratio.toFixed(3)}`);
});

// Try: attenuation = min(1, (minDistTB / threshold)^power)
console.log('\nTrying: attenuation = min(1, (minDistTB / threshold)^power)');
for (let threshold = 60; threshold <= 100; threshold += 10) {
  for (let power = 0.5; power <= 1.5; power += 0.25) {
    let err = 0;
    attenData.forEach(p => {
      const atten = Math.min(1, Math.pow(p.minDistTB / threshold, power));
      const predicted = Math.round(127 * atten);
      err += Math.abs(predicted - p.maxDisplacement);
    });
    if (err < 150) {
      console.log(`  threshold=${threshold}, power=${power}: error=${err}`);
    }
  }
}

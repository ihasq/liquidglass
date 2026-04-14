// Fit the corner boundary curve
const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  if (x < 0 || x >= width || y < 0 || y >= height) return { r: 128, g: 128 };
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Extract the boundary points (where G first becomes non-128 on top edge)
const boundaryPoints = [];
for (let y = 0; y < 70; y++) {
  for (let x = 0; x < width / 2; x++) {
    if (getPixel(x, y).g !== 128) {
      boundaryPoints.push({ x, y });
      break;
    }
  }
}

console.log('Boundary points (x, y):');
boundaryPoints.forEach(p => console.log(`${p.x}, ${p.y}`));

// Try fitting: x = a - b*sqrt(c - y) or similar
// Looking at the data:
// y=0: x=140, y=44: x=44
// Difference: Δx=96 over Δy=44

// Try linear: x = 140 - slope*y
// slope = (140-44)/(44-0) = 96/44 = 2.18
const linearSlope = 96 / 44;
console.log(`\nLinear fit: x = 140 - ${linearSlope.toFixed(3)} * y`);
let linearError = 0;
boundaryPoints.forEach(p => {
  const predicted = 140 - linearSlope * p.y;
  const err = Math.abs(p.x - predicted);
  linearError += err;
});
console.log(`Linear total error: ${linearError.toFixed(1)}`);

// Try quadratic: x = a - b*y - c*y^2
// Use least squares or try parameters
function tryQuadratic(a, b, c) {
  let error = 0;
  boundaryPoints.forEach(p => {
    const predicted = a - b * p.y - c * p.y * p.y;
    error += Math.pow(p.x - predicted, 2);
  });
  return error;
}

// Grid search for best quadratic
let bestQuad = { a: 0, b: 0, c: 0, error: Infinity };
for (let a = 135; a <= 145; a += 1) {
  for (let b = 1; b <= 3; b += 0.1) {
    for (let c = -0.01; c <= 0.05; c += 0.005) {
      const err = tryQuadratic(a, b, c);
      if (err < bestQuad.error) {
        bestQuad = { a, b, c, error: err };
      }
    }
  }
}
console.log(`\nBest quadratic: x = ${bestQuad.a} - ${bestQuad.b.toFixed(3)} * y - ${bestQuad.c.toFixed(5)} * y^2`);
console.log(`Quadratic error: ${bestQuad.error.toFixed(1)}`);

// Try squircle: (x/a)^n + (y/b)^n = 1
// Rearranged: x = a * (1 - (y/b)^n)^(1/n)
function trySquircle(a, b, n) {
  let error = 0;
  boundaryPoints.forEach(p => {
    const yNorm = p.y / b;
    if (yNorm >= 1) {
      error += p.x * p.x;
      return;
    }
    const predicted = a * Math.pow(1 - Math.pow(yNorm, n), 1 / n);
    error += Math.pow(p.x - predicted, 2);
  });
  return error;
}

let bestSquircle = { a: 0, b: 0, n: 0, error: Infinity };
for (let a = 130; a <= 150; a += 1) {
  for (let b = 130; b <= 150; b += 1) {
    for (let n = 1; n <= 4; n += 0.1) {
      const err = trySquircle(a, b, n);
      if (err < bestSquircle.error) {
        bestSquircle = { a, b, n, error: err };
      }
    }
  }
}
console.log(`\nBest squircle: x = ${bestSquircle.a} * (1 - (y/${bestSquircle.b})^${bestSquircle.n.toFixed(1)})^(1/${bestSquircle.n.toFixed(1)})`);
console.log(`Squircle error: ${bestSquircle.error.toFixed(1)}`);

// Print comparison
console.log('\n=== Comparison ===');
console.log('y\tactual\tlinear\tquad\tsquircle');
for (let i = 0; i < Math.min(50, boundaryPoints.length); i += 5) {
  const p = boundaryPoints[i];
  const linear = Math.round(140 - linearSlope * p.y);
  const quad = Math.round(bestQuad.a - bestQuad.b * p.y - bestQuad.c * p.y * p.y);
  const yNorm = p.y / bestSquircle.b;
  const squircle = yNorm < 1 ? Math.round(bestSquircle.a * Math.pow(1 - Math.pow(yNorm, bestSquircle.n), 1 / bestSquircle.n)) : 0;
  console.log(`${p.y}\t${p.x}\t${linear}\t${quad}\t${squircle}`);
}

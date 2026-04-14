// Compare our Snell's law generated curve with kube.io's actual curve
const fs = require('fs');
const PNG = require('pngjs').PNG;

// Load kube map
const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

// Extract kube's curve from left edge center
const kubeCurve = [];
const centerY = Math.floor(height / 2);
for (let x = 0; x < 50; x++) {
  const idx = (centerY * width + x) * 4;
  kubeCurve.push(data[idx] - 128);  // R channel, normalized to -128..127
}

console.log('Kube curve (R - 128):');
console.log(kubeCurve.join(', '));

// Generate our curve using Snell's law
const REFRACTIVE_INDEX = 1.5;
const EDGE_ZONE = 40;

function squircleHeight(normalizedDist) {
  const x = Math.min(1, Math.max(0, normalizedDist));
  const inner = 1 - Math.pow(1 - x, 4);
  return inner > 0 ? Math.pow(inner, 0.25) : 0;
}

function squircleNormal(normalizedDist) {
  const delta = 0.001;
  const y1 = squircleHeight(normalizedDist - delta);
  const y2 = squircleHeight(normalizedDist + delta);
  const derivative = (y2 - y1) / (2 * delta);
  const mag = Math.sqrt(derivative * derivative + 1);
  return { nx: -derivative / mag, ny: 1 / mag };
}

function calculateDisplacement(distFromEdge, edgeZone) {
  if (distFromEdge >= edgeZone) return 0;
  const normalizedDist = distFromEdge / edgeZone;
  const normal = squircleNormal(normalizedDist);
  const incidentAngle = Math.acos(normal.ny);
  const sinTheta2 = Math.sin(incidentAngle) / REFRACTIVE_INDEX;
  if (Math.abs(sinTheta2) >= 1) return 0;
  const refractedAngle = Math.asin(sinTheta2);
  const h = squircleHeight(normalizedDist);
  return h * Math.tan(refractedAngle);
}

const ourCurve = [];
let maxDisp = 0;
for (let d = 0; d < 50; d++) {
  const disp = calculateDisplacement(d, EDGE_ZONE);
  ourCurve.push(disp);
  if (disp > maxDisp) maxDisp = disp;
}

// Normalize to match kube's scale (max 127)
const kubeMax = Math.max(...kubeCurve);
const ourNormalized = ourCurve.map(d => Math.round((d / maxDisp) * kubeMax));

console.log('\nOur curve (normalized to kube scale):');
console.log(ourNormalized.join(', '));

console.log('\nComparison:');
console.log('dist\tkube\tours\tdiff');
for (let d = 0; d < 50; d++) {
  const diff = kubeCurve[d] - ourNormalized[d];
  console.log(`${d}\t${kubeCurve[d]}\t${ourNormalized[d]}\t${diff}`);
}

// Try different edge zone sizes
console.log('\n=== Testing different edge zones ===');
for (let ez = 30; ez <= 50; ez += 5) {
  const testCurve = [];
  let testMax = 0;
  for (let d = 0; d < 50; d++) {
    const disp = calculateDisplacement(d, ez);
    testCurve.push(disp);
    if (disp > testMax) testMax = disp;
  }
  const normalized = testCurve.map(d => Math.round((d / testMax) * kubeMax));

  let totalError = 0;
  for (let d = 0; d < 40; d++) {
    totalError += Math.abs(kubeCurve[d] - normalized[d]);
  }
  console.log(`EdgeZone=${ez}: error=${totalError}`);
}

// Try alternative approaches
console.log('\n=== Alternative: Using surface derivative directly ===');
function surfaceDerivative(normalizedDist) {
  const x = Math.min(1, Math.max(0.001, normalizedDist));
  // d/dx of (1 - (1-x)^4)^(1/4)
  // = 1/4 * (1 - (1-x)^4)^(-3/4) * 4*(1-x)^3
  // = (1-x)^3 / (1 - (1-x)^4)^(3/4)
  const inner = 1 - Math.pow(1 - x, 4);
  if (inner <= 0) return 0;
  return Math.pow(1 - x, 3) / Math.pow(inner, 0.75);
}

const derivCurve = [];
for (let d = 0; d < 50; d++) {
  const normalizedDist = d / 40;
  derivCurve.push(surfaceDerivative(normalizedDist));
}

const derivMax = Math.max(...derivCurve);
const derivNormalized = derivCurve.map(d => Math.round((d / derivMax) * kubeMax));

console.log('Derivative curve (normalized):');
console.log(derivNormalized.join(', '));

let derivError = 0;
for (let d = 0; d < 40; d++) {
  derivError += Math.abs(kubeCurve[d] - derivNormalized[d]);
}
console.log(`Derivative approach error: ${derivError}`);

// Try inverse of normalized distance (1 - x)^n
console.log('\n=== Alternative: Power function (1 - d/zone)^n ===');
for (let n = 1.5; n <= 4; n += 0.5) {
  const powerCurve = [];
  for (let d = 0; d < 50; d++) {
    const t = d / 40;
    powerCurve.push(t < 1 ? Math.pow(1 - t, n) * kubeMax : 0);
  }

  let powerError = 0;
  for (let d = 0; d < 40; d++) {
    powerError += Math.abs(kubeCurve[d] - Math.round(powerCurve[d]));
  }
  console.log(`n=${n}: error=${powerError}`);

  if (n === 3) {
    console.log('  Curve:', powerCurve.slice(0, 20).map(v => Math.round(v)).join(', '));
  }
}

// Try kube's exact formula if we can fit it
console.log('\n=== Fit: saturation zone + power decay ===');
// Kube has: d=0,1 at 127, then decays
for (let satZone = 1; satZone <= 3; satZone++) {
  for (let n = 2; n <= 4; n += 0.25) {
    for (let zone = 35; zone <= 45; zone++) {
      const fitCurve = [];
      for (let d = 0; d < 50; d++) {
        if (d < satZone) {
          fitCurve.push(127);
        } else {
          const t = (d - satZone) / (zone - satZone);
          fitCurve.push(t < 1 ? Math.round(127 * Math.pow(1 - t, n)) : 0);
        }
      }

      let fitError = 0;
      for (let d = 0; d < 40; d++) {
        fitError += Math.abs(kubeCurve[d] - fitCurve[d]);
      }

      if (fitError < 50) {
        console.log(`satZone=${satZone}, n=${n}, zone=${zone}: error=${fitError}`);
        console.log('  Curve:', fitCurve.slice(0, 20).join(', '));
      }
    }
  }
}

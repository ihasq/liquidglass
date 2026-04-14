const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeImg = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/specular-map-w2qrsb.png'));
const ourImg = PNG.sync.read(fs.readFileSync('e2e/debug/our-specular-map.png'));

const { width, height, data } = kubeImg;

console.log(`Specular map: ${width}x${height}`);

const centerX = width / 2;
const centerY = height / 2;
const maxRadius = Math.min(width, height) / 2;

// Analyze radial profile of alpha channel
const radialProfile = new Map();
let maxAlpha = 0;

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];

    if (a > maxAlpha) maxAlpha = a;

    const dx = x - centerX;
    const dy = y - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const rho = dist / maxRadius;

    // Bucket by rho (0.01 increments)
    const bucket = Math.round(rho * 100) / 100;

    if (!radialProfile.has(bucket)) {
      radialProfile.set(bucket, { count: 0, sumR: 0, sumG: 0, sumB: 0, sumA: 0, maxA: 0, minA: 255 });
    }
    const p = radialProfile.get(bucket);
    p.count++;
    p.sumR += r;
    p.sumG += g;
    p.sumB += b;
    p.sumA += a;
    p.maxA = Math.max(p.maxA, a);
    p.minA = Math.min(p.minA, a);
  }
}

console.log('\nMax alpha in image:', maxAlpha);
console.log('\nRadial profile (distance from center -> avg alpha):');
console.log('rho\tavgA\tmaxA\tminA\tavgR\tavgG\tavgB');

const sortedBuckets = Array.from(radialProfile.keys()).sort((a, b) => a - b);
for (const bucket of sortedBuckets) {
  const p = radialProfile.get(bucket);
  const avgA = (p.sumA / p.count).toFixed(1);
  const avgR = (p.sumR / p.count).toFixed(1);
  const avgG = (p.sumG / p.count).toFixed(1);
  const avgB = (p.sumB / p.count).toFixed(1);
  console.log(`${bucket.toFixed(2)}\t${avgA}\t${p.maxA}\t${p.minA}\t${avgR}\t${avgG}\t${avgB}`);
}

// Find where alpha peaks (specular ring location)
let peakRho = 0;
let peakAlpha = 0;
for (const [bucket, p] of radialProfile) {
  const avgA = p.sumA / p.count;
  if (avgA > peakAlpha) {
    peakAlpha = avgA;
    peakRho = bucket;
  }
}

console.log(`\nPeak specular at rho=${peakRho.toFixed(2)} with avgAlpha=${peakAlpha.toFixed(1)}`);

// Analyze angular variation at the peak radius
console.log('\nAngular variation at peak radius (rho ~', peakRho.toFixed(2), '):');
const angularProfile = new Map();
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const a = data[idx + 3];

    const dx = x - centerX;
    const dy = y - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const rho = dist / maxRadius;

    if (Math.abs(rho - peakRho) < 0.05) {
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const bucket = Math.round(angle / 15) * 15;

      if (!angularProfile.has(bucket)) {
        angularProfile.set(bucket, { count: 0, sumA: 0 });
      }
      const p = angularProfile.get(bucket);
      p.count++;
      p.sumA += a;
    }
  }
}

console.log('angle\tavgAlpha');
const sortedAngles = Array.from(angularProfile.keys()).sort((a, b) => a - b);
for (const angle of sortedAngles) {
  const p = angularProfile.get(angle);
  const avgA = (p.sumA / p.count).toFixed(1);
  console.log(`${angle}\t${avgA}`);
}

const fs = require('fs');
const PNG = require('pngjs').PNG;

const img = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = img;

console.log(`Displacement map: ${width}x${height}`);

const centerX = width / 2;
const centerY = height / 2;
const maxRadius = Math.min(width, height) / 2;

// Analyze radial profile of R and G channels (displacement)
const radialProfile = new Map();

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const a = data[idx + 3];

    const dx = x - centerX;
    const dy = y - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const rho = dist / maxRadius;

    const bucket = Math.round(rho * 100) / 100;

    if (!radialProfile.has(bucket)) {
      radialProfile.set(bucket, { count: 0, sumR: 0, sumG: 0, sumRDev: 0, sumGDev: 0 });
    }
    const p = radialProfile.get(bucket);
    p.count++;
    p.sumR += r;
    p.sumG += g;
    p.sumRDev += Math.abs(r - 128);
    p.sumGDev += Math.abs(g - 128);
  }
}

console.log('\nRadial profile (distance from center -> displacement):');
console.log('rho\tavgR\tavgG\tavgRDev\tavgGDev');

const sortedBuckets = Array.from(radialProfile.keys()).sort((a, b) => a - b);
for (const bucket of sortedBuckets) {
  if (bucket > 1.5) break;
  const p = radialProfile.get(bucket);
  const avgR = (p.sumR / p.count).toFixed(1);
  const avgG = (p.sumG / p.count).toFixed(1);
  const avgRDev = (p.sumRDev / p.count).toFixed(1);
  const avgGDev = (p.sumGDev / p.count).toFixed(1);
  console.log(`${bucket.toFixed(2)}\t${avgR}\t${avgG}\t${avgRDev}\t${avgGDev}`);
}

// Find where displacement is non-zero
console.log('\n--- Non-neutral displacement zones ---');
for (const bucket of sortedBuckets) {
  if (bucket > 1.5) break;
  const p = radialProfile.get(bucket);
  const avgRDev = p.sumRDev / p.count;
  const avgGDev = p.sumGDev / p.count;
  if (avgRDev > 5 || avgGDev > 5) {
    console.log(`rho=${bucket.toFixed(2)}: RDev=${avgRDev.toFixed(1)}, GDev=${avgGDev.toFixed(1)}`);
  }
}

// Sample specific edge pixels
console.log('\n--- Edge pixel samples ---');
for (let angle = 0; angle < 360; angle += 45) {
  const rad = angle * Math.PI / 180;
  const x = Math.round(centerX + Math.cos(rad) * (maxRadius - 5));
  const y = Math.round(centerY + Math.sin(rad) * (maxRadius - 5));
  if (x >= 0 && x < width && y >= 0 && y < height) {
    const idx = (y * width + x) * 4;
    console.log(`angle=${angle}: R=${data[idx]}, G=${data[idx+1]} (at x=${x}, y=${y})`);
  }
}

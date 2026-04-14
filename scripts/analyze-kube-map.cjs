const fs = require('fs');
const PNG = require('pngjs').PNG;

const img = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = img;

console.log(`Image size: ${width}x${height}`);

// Analyze a horizontal line through the center
const centerY = Math.floor(height / 2);
const centerX = Math.floor(width / 2);

console.log('\nHorizontal profile (through center):');
console.log('X\tR\tG\tdist\tnormDisp');

for (let x = 0; x < width; x += 10) {
  const idx = (centerY * width + x) * 4;
  const r = data[idx];
  const g = data[idx + 1];
  const dist = x - centerX;
  const normR = (r - 128) / 127;  // Normalized displacement
  console.log(`${x}\t${r}\t${g}\t${dist}\t${normR.toFixed(3)}`);
}

// Analyze displacement magnitude vs radial distance
console.log('\n\nRadial profile (from center):');
console.log('rho\tavgR\tavgG\tnormDisp');

const maxRadius = Math.min(width, height) / 2;
for (let r = 0; r <= maxRadius; r += 5) {
  let sumR = 0, sumG = 0, count = 0;
  // Sample points at this radius
  for (let angle = 0; angle < Math.PI * 2; angle += 0.1) {
    const x = Math.round(centerX + r * Math.cos(angle));
    const y = Math.round(centerY + r * Math.sin(angle));
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = (y * width + x) * 4;
      sumR += data[idx];
      sumG += data[idx + 1];
      count++;
    }
  }
  const avgR = sumR / count;
  const avgG = sumG / count;
  const rho = r / maxRadius;
  const normDisp = (avgR - 128) / 127;
  console.log(`${rho.toFixed(2)}\t${avgR.toFixed(1)}\t${avgG.toFixed(1)}\t${normDisp.toFixed(3)}`);
}

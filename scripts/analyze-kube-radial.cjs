const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeImg = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeImg;

const centerX = width / 2;  // 210
const centerY = height / 2; // 150

console.log(`Kube displacement map: ${width}x${height}`);
console.log(`Center: (${centerX}, ${centerY})`);

// Analyze displacement along radial lines from center
// For each radius, sample multiple angles and compute average displacement magnitude

console.log('\n=== Radial Displacement Profile (from center outward) ===');
console.log('radius\tavgDispMag\tavgR\tavgG\tdirX\tdirY');

const maxRadius = Math.min(centerX, centerY);  // 150

for (let r = 0; r <= maxRadius; r += 5) {
  if (r === 0) {
    const idx = (Math.floor(centerY) * width + Math.floor(centerX)) * 4;
    console.log(`${r}\t0.00\t${data[idx]}\t${data[idx+1]}\t0\t0`);
    continue;
  }

  let sumR = 0, sumG = 0, count = 0;
  let sumDx = 0, sumDy = 0;

  // Sample at multiple angles
  for (let angle = 0; angle < 360; angle += 15) {
    const rad = angle * Math.PI / 180;
    const x = Math.round(centerX + Math.cos(rad) * r);
    const y = Math.round(centerY + Math.sin(rad) * r);

    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = (y * width + x) * 4;
      const rVal = data[idx];
      const gVal = data[idx + 1];

      sumR += rVal;
      sumG += gVal;

      // Displacement direction (from 128 neutral)
      const dx = (rVal - 128) / 127;
      const dy = (gVal - 128) / 127;
      sumDx += dx;
      sumDy += dy;
      count++;
    }
  }

  if (count > 0) {
    const avgR = sumR / count;
    const avgG = sumG / count;
    const avgDx = sumDx / count;
    const avgDy = sumDy / count;
    const avgMag = Math.sqrt(avgDx * avgDx + avgDy * avgDy);
    console.log(`${r}\t${avgMag.toFixed(3)}\t${avgR.toFixed(1)}\t${avgG.toFixed(1)}\t${avgDx.toFixed(3)}\t${avgDy.toFixed(3)}`);
  }
}

// Check if displacement is truly radial (pointing outward from center)
console.log('\n=== Checking Radial Direction ===');
console.log('Testing at radius=140 (near edge):');

for (let angle = 0; angle < 360; angle += 45) {
  const rad = angle * Math.PI / 180;
  const r = 140;
  const x = Math.round(centerX + Math.cos(rad) * r);
  const y = Math.round(centerY + Math.sin(rad) * r);

  if (x >= 0 && x < width && y >= 0 && y < height) {
    const idx = (y * width + x) * 4;
    const rVal = data[idx];
    const gVal = data[idx + 1];

    const dx = (rVal - 128) / 127;
    const dy = (gVal - 128) / 127;
    const dispAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    const expectedAngle = angle;

    console.log(`angle=${angle}: pos=(${x},${y}) R=${rVal} G=${gVal} dispAngle=${dispAngle.toFixed(1)} expected=${expectedAngle}`);
  }
}

// Analyze the squircle surface profile
console.log('\n=== Simulating Squircle Profile ===');
console.log('distFromEdge\tsquircleHeight\tslope\tnormalAngle');

for (let distFromEdge = 0; distFromEdge <= 1; distFromEdge += 0.05) {
  // Squircle: y = (1 - (1-x)^4)^(1/4)
  const t = 1 - distFromEdge;  // t = 1 - distance from edge = distance from center
  const inner = 1 - Math.pow(t, 4);
  const y = inner > 0 ? Math.pow(inner, 0.25) : 0;

  // Derivative for normal
  const delta = 0.001;
  const t1 = t - delta;
  const t2 = t + delta;
  const y1 = Math.pow(Math.max(0, 1 - Math.pow(t1, 4)), 0.25);
  const y2 = Math.pow(Math.max(0, 1 - Math.pow(t2, 4)), 0.25);
  const slope = (y2 - y1) / (2 * delta);

  const normalAngle = Math.atan2(1, -slope) * 180 / Math.PI;

  console.log(`${distFromEdge.toFixed(2)}\t${y.toFixed(4)}\t${slope.toFixed(4)}\t${normalAngle.toFixed(1)}`);
}

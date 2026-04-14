const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeImg = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeImg;

console.log(`Kube displacement map: ${width}x${height}`);

// Analyze Y displacement along vertical center line
console.log('\n=== Y Displacement along vertical center (x=210) ===');
console.log('y\tdistFromTop\tdistFromBottom\tG\tGdiff\tdispY');

const centerX = 210;
for (let y = 0; y < height; y += 2) {
  const idx = (y * width + centerX) * 4;
  const g = data[idx + 1];
  const gDiff = g - 128;
  const dispY = gDiff / 127;
  const distFromTop = y;
  const distFromBottom = height - 1 - y;

  if (gDiff !== 0) {
    console.log(`${y}\t${distFromTop}\t${distFromBottom}\t${g}\t${gDiff}\t${dispY.toFixed(3)}`);
  }
}

// Analyze X displacement along horizontal center line
console.log('\n=== X Displacement along horizontal center (y=150) ===');
console.log('x\tdistFromLeft\tdistFromRight\tR\tRdiff\tdispX');

const centerY = 150;
for (let x = 0; x < width; x += 2) {
  const idx = (centerY * width + x) * 4;
  const r = data[idx];
  const rDiff = r - 128;
  const dispX = rDiff / 127;
  const distFromLeft = x;
  const distFromRight = width - 1 - x;

  if (rDiff !== 0) {
    console.log(`${x}\t${distFromLeft}\t${distFromRight}\t${r}\t${rDiff}\t${dispX.toFixed(3)}`);
  }
}

// Extract the exact displacement curve from top edge
console.log('\n=== Displacement Curve from Top Edge (x=210, first 40 pixels) ===');
console.log('distFromEdge\tG\tGdiff\tnormalized');

const topEdgeDisp = [];
for (let dist = 0; dist < 40; dist++) {
  const y = dist;
  const idx = (y * width + centerX) * 4;
  const g = data[idx + 1];
  const gDiff = g - 128;
  const normalized = gDiff / 127;
  topEdgeDisp.push({ dist, g, gDiff, normalized });
  console.log(`${dist}\t${g}\t${gDiff}\t${normalized.toFixed(4)}`);
}

// Find the maximum displacement
const maxDisp = topEdgeDisp.reduce((max, d) => Math.abs(d.gDiff) > Math.abs(max.gDiff) ? d : max);
console.log(`\nMax displacement: G=${maxDisp.g} at dist=${maxDisp.dist} (Gdiff=${maxDisp.gDiff})`);

// Try to fit the curve to a mathematical function
console.log('\n=== Curve Fitting Analysis ===');
console.log('Trying to match: disp = maxDisp * f(distFromEdge/threshold)');

// Normalize by max displacement
const maxVal = 127; // G=255 would give 127
const threshold = 37.5; // ~25% of 150

for (let dist = 0; dist < 40; dist++) {
  const actual = topEdgeDisp[dist].gDiff;
  const t = dist / threshold;

  // Try different functions
  const linear = maxVal * Math.max(0, 1 - t);
  const quadratic = maxVal * Math.pow(Math.max(0, 1 - t), 2);
  const cubic = maxVal * Math.pow(Math.max(0, 1 - t), 3);
  const squircle = dist < threshold ? maxVal * Math.pow(1 - Math.pow(t, 4), 0.25) : 0;

  console.log(`dist=${dist}: actual=${actual}\tlinear=${linear.toFixed(0)}\tquad=${quadratic.toFixed(0)}\tcubic=${cubic.toFixed(0)}\tsquircle=${squircle.toFixed(0)}`);
}

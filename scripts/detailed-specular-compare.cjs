const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeImg = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/specular-map-w2qrsb.png'));
const ourImg = PNG.sync.read(fs.readFileSync('e2e/debug/our-specular-map.png'));

const w = 420, h = 300;

// Find first 10 rows with non-zero alpha in kube specular (center column)
console.log('Kube specular along top edge (x=210, first 10 rows):');
for (let y = 0; y < 10; y++) {
  const idx = (y * w + 210) * 4;
  console.log(`y=${y}: R=${kubeImg.data[idx]} G=${kubeImg.data[idx+1]} B=${kubeImg.data[idx+2]} A=${kubeImg.data[idx+3]}`);
}

console.log('\nOur specular along top edge (x=210, first 10 rows):');
for (let y = 0; y < 10; y++) {
  const idx = (y * w + 210) * 4;
  console.log(`y=${y}: R=${ourImg.data[idx]} G=${ourImg.data[idx+1]} B=${ourImg.data[idx+2]} A=${ourImg.data[idx+3]}`);
}

// Check where kube specular peaks
console.log('\nFinding kube specular non-zero regions...');
let firstNonZeroY = -1, lastNonZeroY = -1;
for (let y = 0; y < h; y++) {
  const idx = (y * w + 210) * 4;
  if (kubeImg.data[idx + 3] > 0) {
    if (firstNonZeroY < 0) firstNonZeroY = y;
    lastNonZeroY = y;
  }
}
console.log(`Kube specular at x=210: first non-zero y=${firstNonZeroY}, last=${lastNonZeroY}`);

// Check our specular
firstNonZeroY = -1; lastNonZeroY = -1;
for (let y = 0; y < h; y++) {
  const idx = (y * w + 210) * 4;
  if (ourImg.data[idx + 3] > 0) {
    if (firstNonZeroY < 0) firstNonZeroY = y;
    lastNonZeroY = y;
  }
}
console.log(`Our specular at x=210: first non-zero y=${firstNonZeroY}, last=${lastNonZeroY}`);

// Look for kube specular elsewhere
console.log('\nSearching for kube specular locations...');
let maxKubeAlpha = 0, maxKubePos = null;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const idx = (y * w + x) * 4;
    if (kubeImg.data[idx + 3] > maxKubeAlpha) {
      maxKubeAlpha = kubeImg.data[idx + 3];
      maxKubePos = { x, y };
    }
  }
}
console.log(`Kube max alpha: ${maxKubeAlpha} at (${maxKubePos?.x}, ${maxKubePos?.y})`);

// Sample around the max position
if (maxKubePos) {
  console.log(`\nKube specular around max (${maxKubePos.x}, ${maxKubePos.y}):`);
  for (let dy = -2; dy <= 2; dy++) {
    let row = '';
    for (let dx = -5; dx <= 5; dx++) {
      const x = maxKubePos.x + dx;
      const y = maxKubePos.y + dy;
      if (x >= 0 && x < w && y >= 0 && y < h) {
        const idx = (y * w + x) * 4;
        row += kubeImg.data[idx + 3].toString().padStart(4);
      }
    }
    console.log(row);
  }
}

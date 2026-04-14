// Compare raw SVG gradient displacement map with kube.io PNG
const fs = require('fs');
const PNG = require('pngjs').PNG;

// Load kube.io's PNG displacement map
const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data: kubeData } = kubeMap;

console.log(`Kube displacement map: ${width} x ${height}`);

// Analyze kube.io displacement values along edges
console.log('\n=== Kube.io Displacement Map Analysis ===');

console.log('\nTop edge (Y=0 to Y=40), center X:');
console.log('y\tR\tG\tB\t(R-128)\t(G-128)');
const centerX = Math.floor(width / 2);
for (let y = 0; y < 40; y++) {
  const idx = (y * width + centerX) * 4;
  const r = kubeData[idx];
  const g = kubeData[idx + 1];
  const b = kubeData[idx + 2];
  console.log(`${y}\t${r}\t${g}\t${b}\t${r - 128}\t${g - 128}`);
}

console.log('\nLeft edge (X=0 to X=40), center Y:');
console.log('x\tR\tG\tB\t(R-128)\t(G-128)');
const centerY = Math.floor(height / 2);
for (let x = 0; x < 40; x++) {
  const idx = (centerY * width + x) * 4;
  const r = kubeData[idx];
  const g = kubeData[idx + 1];
  const b = kubeData[idx + 2];
  console.log(`${x}\t${r}\t${g}\t${b}\t${r - 128}\t${g - 128}`);
}

// Check if the displacement follows our expected pattern:
// - R channel: X displacement (255=push right, 0=push left, 128=neutral)
// - G channel: Y displacement (255=push down, 0=push up, 128=neutral)
console.log('\n=== Pattern Analysis ===');

// At top edge: should have high G (push down into center)
const topG = kubeData[(0 * width + centerX) * 4 + 1];
console.log(`Top edge G value: ${topG} (expected high, >128)`);

// At left edge: should have high R (push right into center)
const leftR = kubeData[(centerY * width + 0) * 4];
console.log(`Left edge R value: ${leftR} (expected high, >128)`);

// At bottom edge: should have low G (push up into center)
const bottomG = kubeData[((height - 1) * width + centerX) * 4 + 1];
console.log(`Bottom edge G value: ${bottomG} (expected low, <128)`);

// At right edge: should have low R (push left into center)
const rightR = kubeData[(centerY * width + (width - 1)) * 4];
console.log(`Right edge R value: ${rightR} (expected low, <128)`);

// At center: should be neutral (128, 128)
const centerR = kubeData[(centerY * width + centerX) * 4];
const centerG = kubeData[(centerY * width + centerX) * 4 + 1];
console.log(`Center (R, G): (${centerR}, ${centerG}) (expected ~128, ~128)`);

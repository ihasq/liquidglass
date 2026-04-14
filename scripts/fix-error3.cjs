const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const ourMap = PNG.sync.read(fs.readFileSync('e2e/debug/dispmap-compare/direct-v4.png'));
const { width, height } = kubeMap;

function getKube(x, y) {
  const idx = (y * width + x) * 4;
  return { r: kubeMap.data[idx], g: kubeMap.data[idx + 1] };
}

function getOur(x, y) {
  const idx = (y * width + x) * 4;
  return { r: ourMap.data[idx], g: ourMap.data[idx + 1] };
}

// Find all pixels with error = 3
console.log('=== Pixels with R error = 3 ===');
console.log('x\ty\tkubeR\tourR\tdistFromCenter');

let rErr3 = [];
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const k = getKube(x, y);
    const o = getOur(x, y);
    if (Math.abs(k.r - o.r) === 3) {
      const distFromCenterX = Math.abs(x - width / 2);
      rErr3.push({ x, y, kubeR: k.r, ourR: o.r, distFromCenterX });
    }
  }
}

// Show first 20
rErr3.slice(0, 20).forEach(e => {
  console.log(`${e.x}\t${e.y}\t${e.kubeR}\t${e.ourR}\t${e.distFromCenterX}`);
});

// Check pattern
console.log('\n=== Distribution of error=3 pixels ===');
console.log(`Total: ${rErr3.length}`);
console.log(`On left half: ${rErr3.filter(e => e.x < width/2).length}`);
console.log(`On right half: ${rErr3.filter(e => e.x >= width/2).length}`);

// Are they all kube=131, ours=128 or kube=125, ours=128?
const kubeValues = {};
rErr3.forEach(e => {
  const k = `kube=${e.kubeR},ours=${e.ourR}`;
  kubeValues[k] = (kubeValues[k] || 0) + 1;
});
console.log('\nValue pairs:');
Object.entries(kubeValues).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

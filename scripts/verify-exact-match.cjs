const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const ourMap = PNG.sync.read(fs.readFileSync('e2e/debug/dispmap-compare/direct-v4.png'));
const { width, height } = kubeMap;

let exactMatch = 0;
let totalPixels = width * height;
let maxErr = 0;
let errors = [];

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const rErr = Math.abs(kubeMap.data[idx] - ourMap.data[idx]);
    const gErr = Math.abs(kubeMap.data[idx + 1] - ourMap.data[idx + 1]);
    
    if (rErr === 0 && gErr === 0) {
      exactMatch++;
    } else {
      if (errors.length < 20) {
        errors.push({ x, y, rErr, gErr });
      }
    }
    
    maxErr = Math.max(maxErr, rErr, gErr);
  }
}

console.log(`Exact match: ${exactMatch}/${totalPixels} = ${(exactMatch/totalPixels*100).toFixed(4)}%`);
console.log(`Max error: ${maxErr}`);
console.log(`\nFirst ${errors.length} error pixels:`);
errors.forEach(e => {
  console.log(`  (${e.x}, ${e.y}): R err=${e.rErr}, G err=${e.gErr}`);
});

// Count errors by magnitude
const errCount = {};
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const rErr = Math.abs(kubeMap.data[idx] - ourMap.data[idx]);
    const gErr = Math.abs(kubeMap.data[idx + 1] - ourMap.data[idx + 1]);
    if (rErr > 0) errCount[`R${rErr}`] = (errCount[`R${rErr}`] || 0) + 1;
    if (gErr > 0) errCount[`G${gErr}`] = (errCount[`G${gErr}`] || 0) + 1;
  }
}
console.log('\nError distribution:');
Object.entries(errCount).sort().forEach(([k, v]) => {
  console.log(`  ${k}: ${v} pixels`);
});

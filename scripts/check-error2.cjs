const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const ourMap = PNG.sync.read(fs.readFileSync('e2e/debug/dispmap-compare/direct-v5.png'));
const { width, height } = kubeMap;

// Find pixels with error exactly 2
let err2 = [];
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const rErr = Math.abs(kubeMap.data[idx] - ourMap.data[idx]);
    const gErr = Math.abs(kubeMap.data[idx + 1] - ourMap.data[idx + 1]);
    if (rErr === 2 || gErr === 2) {
      err2.push({
        x, y,
        kubeR: kubeMap.data[idx], ourR: ourMap.data[idx],
        kubeG: kubeMap.data[idx + 1], ourG: ourMap.data[idx + 1],
        rErr, gErr
      });
    }
  }
}

console.log(`Total error=2 pixels: ${err2.length}`);
console.log('\nFirst 20:');
console.log('x\ty\tkubeR\tourR\terrR\tkubeG\tourG\terrG');
err2.slice(0, 20).forEach(e => {
  console.log(`${e.x}\t${e.y}\t${e.kubeR}\t${e.ourR}\t${e.rErr}\t${e.kubeG}\t${e.ourG}\t${e.gErr}`);
});

// Pattern analysis
const patterns = {};
err2.forEach(e => {
  const key = `R:${e.kubeR}->${e.ourR},G:${e.kubeG}->${e.ourG}`;
  patterns[key] = (patterns[key] || 0) + 1;
});
console.log('\nValue patterns:');
Object.entries(patterns).slice(0, 10).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

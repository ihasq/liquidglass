const fs = require('fs');
const PNG = require('pngjs').PNG;

const ourImg = PNG.sync.read(fs.readFileSync('e2e/debug/our-displacement-map.png'));
const kubeImg = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));

// Both 420x300 now
const w = 420, h = 300;

console.log('First 10 rows of center column (x=210) - Our vs Kube:');
console.log('y\tOurG\tKubeG\tDiff');
for (let y = 0; y < 10; y++) {
  const ourIdx = (y * w + 210) * 4;
  const kubeIdx = (y * w + 210) * 4;
  const ourG = ourImg.data[ourIdx+1];
  const kubeG = kubeImg.data[kubeIdx+1];
  console.log(`${y}\t${ourG}\t${kubeG}\t${ourG - kubeG}`);
}

console.log('\nFirst 10 cols of center row (y=150) - Our vs Kube:');
console.log('x\tOurR\tKubeR\tDiff');
for (let x = 0; x < 10; x++) {
  const ourIdx = (150 * w + x) * 4;
  const kubeIdx = (150 * w + x) * 4;
  const ourR = ourImg.data[ourIdx];
  const kubeR = kubeImg.data[kubeIdx];
  console.log(`${x}\t${ourR}\t${kubeR}\t${ourR - kubeR}`);
}

const fs = require('fs');
const PNG = require('pngjs').PNG;

const ourImg = PNG.sync.read(fs.readFileSync('e2e/debug/our-displacement-map.png'));
const kubeImg = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));

// Our map: 210x150, Kube: 420x300
// Compare equivalent positions

console.log('Vertical center line comparison (Y=top to bottom along X=center):');
console.log('y\tourG\tkubeG\tdiff');

for (let ourY = 0; ourY < 150; ourY += 5) {
  const kubeY = ourY * 2;
  const ourX = 105;
  const kubeX = 210;

  const ourIdx = (ourY * 210 + ourX) * 4;
  const kubeIdx = (kubeY * 420 + kubeX) * 4;

  const ourG = ourImg.data[ourIdx + 1];
  const kubeG = kubeImg.data[kubeIdx + 1];

  console.log(`${ourY}\t${ourG}\t${kubeG}\t${ourG - kubeG}`);
}

console.log('\nHorizontal center line comparison (X=left to right along Y=center):');
console.log('x\tourR\tkubeR\tdiff');

for (let ourX = 0; ourX < 210; ourX += 10) {
  const kubeX = ourX * 2;
  const ourY = 75;
  const kubeY = 150;

  const ourIdx = (ourY * 210 + ourX) * 4;
  const kubeIdx = (kubeY * 420 + kubeX) * 4;

  const ourR = ourImg.data[ourIdx];
  const kubeR = kubeImg.data[kubeIdx];

  console.log(`${ourX}\t${ourR}\t${kubeR}\t${ourR - kubeR}`);
}

// Count total difference
let totalDiff = 0;
let maxDiff = 0;
let pixelCount = 0;

for (let ourY = 0; ourY < 150; ourY++) {
  for (let ourX = 0; ourX < 210; ourX++) {
    const kubeY = ourY * 2;
    const kubeX = ourX * 2;

    const ourIdx = (ourY * 210 + ourX) * 4;
    const kubeIdx = (kubeY * 420 + kubeX) * 4;

    const diffR = Math.abs(ourImg.data[ourIdx] - kubeImg.data[kubeIdx]);
    const diffG = Math.abs(ourImg.data[ourIdx + 1] - kubeImg.data[kubeIdx + 1]);

    totalDiff += diffR + diffG;
    maxDiff = Math.max(maxDiff, diffR, diffG);
    pixelCount++;
  }
}

console.log(`\nTotal pixels: ${pixelCount}`);
console.log(`Total R+G difference: ${totalDiff}`);
console.log(`Avg diff per pixel: ${(totalDiff / pixelCount).toFixed(2)}`);
console.log(`Max diff: ${maxDiff}`);

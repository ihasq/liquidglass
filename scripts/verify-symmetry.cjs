const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

function findRightBoundary(y) {
  for (let x = width - 1; x >= width / 2; x--) {
    if (getPixel(x, y).r !== 128) {
      return width - 1 - x;
    }
  }
  return 0;
}

// Check y=110 (distTop=110, distBottom=189) 
// vs y=189 (distTop=189, distBottom=110)
console.log('Comparing top-half vs bottom-half:');
console.log('y=110: distTop=110, distBottom=189, boundary=', findRightBoundary(110));
console.log('y=189: distTop=189, distBottom=110, boundary=', findRightBoundary(189));

console.log('\nMore comparisons:');
for (let d = 100; d <= 130; d += 5) {
  const yTop = d;  // distTop=d, distBottom=299-d
  const yBot = 299 - d;  // distTop=299-d, distBottom=d
  console.log(`minDist=${d}: y=${yTop} boundary=${findRightBoundary(yTop)}, y=${yBot} boundary=${findRightBoundary(yBot)}`);
}

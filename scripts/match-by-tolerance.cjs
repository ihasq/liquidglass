const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const ourMap = PNG.sync.read(fs.readFileSync('e2e/debug/dispmap-compare/direct-v4.png'));
const { width, height } = kubeMap;

const totalPixels = width * height;

for (let tolerance = 0; tolerance <= 5; tolerance++) {
  let match = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const rErr = Math.abs(kubeMap.data[idx] - ourMap.data[idx]);
      const gErr = Math.abs(kubeMap.data[idx + 1] - ourMap.data[idx + 1]);
      
      if (rErr <= tolerance && gErr <= tolerance) {
        match++;
      }
    }
  }
  console.log(`Tolerance ≤${tolerance}: ${match}/${totalPixels} = ${(match/totalPixels*100).toFixed(4)}%`);
}

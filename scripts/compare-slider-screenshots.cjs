const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;

const files = [
  'e2e/debug/slider-test-1-initial.png',
  'e2e/debug/slider-test-2-uncheck-disp.png',
  'e2e/debug/slider-test-3-refraction.png',
  'e2e/debug/slider-test-4-scale.png'
];

const images = files.map(f => PNG.sync.read(fs.readFileSync(f)));

console.log('Comparing slider screenshots:\n');

for (let i = 1; i < images.length; i++) {
  const img1 = images[0];
  const img2 = images[i];
  const diff = new PNG({ width: img1.width, height: img1.height });
  
  const numDiff = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, { threshold: 0.1 });
  const pct = ((img1.width * img1.height - numDiff) / (img1.width * img1.height) * 100).toFixed(2);
  
  console.log(`${files[0].split('/').pop()} vs ${files[i].split('/').pop()}: ${numDiff} different pixels (${pct}% match)`);
}

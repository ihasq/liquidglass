const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;

const files = [
  'e2e/debug/final-1-initial.png',
  'e2e/debug/final-2-our-disp.png',
  'e2e/debug/final-3-max-refraction.png',
  'e2e/debug/final-4-high-scale.png',
  'e2e/debug/final-5-low-scale.png'
];

const names = ['Initial', 'Our Disp', 'Max Refraction', 'High Scale', 'Low Scale'];

const images = files.map(f => PNG.sync.read(fs.readFileSync(f)));

console.log('Pixel differences between consecutive screenshots:\n');

for (let i = 1; i < images.length; i++) {
  const diff = new PNG({ width: images[0].width, height: images[0].height });
  const numDiff = pixelmatch(images[i-1].data, images[i].data, diff.data, images[0].width, images[0].height, { threshold: 0.1 });
  console.log(`${names[i-1]} → ${names[i]}: ${numDiff} pixels changed`);
}

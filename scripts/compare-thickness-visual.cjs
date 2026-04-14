const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;

const values = [0.5, 1.0, 2.0, 3.0];
const files = values.map(v => `e2e/debug/thickness-visual-${v}.png`);
const images = files.map(f => PNG.sync.read(fs.readFileSync(f)));

console.log('Thickness visual comparison (with scale=150):\n');

// Compare each to 1.0 (baseline)
const baseline = images[1]; // 1.0
for (let i = 0; i < images.length; i++) {
  if (i === 1) continue;
  const diff = pixelmatch(baseline.data, images[i].data, null, baseline.width, baseline.height, { threshold: 0.1 });
  console.log(`Thickness 1.0 vs ${values[i]}: ${diff} pixels different`);
}

// Compare consecutive
console.log('\nConsecutive comparisons:');
for (let i = 1; i < images.length; i++) {
  const diff = pixelmatch(images[i-1].data, images[i].data, null, images[0].width, images[0].height, { threshold: 0.1 });
  console.log(`${values[i-1]} → ${values[i]}: ${diff} pixels`);
}

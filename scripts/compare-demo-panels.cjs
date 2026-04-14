const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;

// Demo panels are around x=20, y=60 for "our" panel (second one)
// First panel (kube) at ~x=20, second panel at ~x=270
const PANEL_X = 270;
const PANEL_Y = 60;
const PANEL_W = 210;
const PANEL_H = 150;

function extractRegion(img, x, y, w, h) {
  const region = new PNG({ width: w, height: h });
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const srcIdx = ((y + py) * img.width + (x + px)) * 4;
      const dstIdx = (py * w + px) * 4;
      region.data[dstIdx] = img.data[srcIdx];
      region.data[dstIdx + 1] = img.data[srcIdx + 1];
      region.data[dstIdx + 2] = img.data[srcIdx + 2];
      region.data[dstIdx + 3] = img.data[srcIdx + 3];
    }
  }
  return region;
}

const files = [
  'e2e/debug/slider-test-1-initial.png',
  'e2e/debug/slider-test-2-uncheck-disp.png',
  'e2e/debug/slider-test-3-refraction.png',
  'e2e/debug/slider-test-4-scale.png'
];

const images = files.map(f => PNG.sync.read(fs.readFileSync(f)));

// Extract "Our Implementation" panel from each
const panels = images.map(img => extractRegion(img, PANEL_X, PANEL_Y, PANEL_W, PANEL_H));

// Save first panel for inspection
fs.writeFileSync('e2e/debug/panel-initial.png', PNG.sync.write(panels[0]));
fs.writeFileSync('e2e/debug/panel-scale200.png', PNG.sync.write(panels[3]));

console.log('Comparing "Our Implementation" panel only:\n');

for (let i = 1; i < panels.length; i++) {
  const diff = new PNG({ width: PANEL_W, height: PANEL_H });
  const numDiff = pixelmatch(panels[0].data, panels[i].data, diff.data, PANEL_W, PANEL_H, { threshold: 0.1 });
  const total = PANEL_W * PANEL_H;
  const pct = ((total - numDiff) / total * 100).toFixed(2);
  
  console.log(`Initial vs ${files[i].split('-').pop().replace('.png', '')}: ${numDiff}/${total} different (${pct}% match)`);
  
  fs.writeFileSync(`e2e/debug/panel-diff-${i}.png`, PNG.sync.write(diff));
}

console.log('\nPanel images saved to e2e/debug/panel-*.png');

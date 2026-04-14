const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Extract curve from center row (y=150) - R channel, left edge
const centerY = Math.floor(height / 2);
console.log(`Center Y: ${centerY}`);

const curve = [];
for (let x = 0; x < 50; x++) {
  const r = getPixel(x, centerY).r;
  curve.push(r - 128);  // Normalize: 128 = 0 displacement
}

console.log('KUBE_CURVE (R - 128 from left edge at center):');
console.log('const KUBE_CURVE = [');
for (let i = 0; i < curve.length; i += 10) {
  const line = curve.slice(i, Math.min(i + 10, curve.length)).join(', ');
  console.log(`  ${line},`);
}
console.log('];');

// Verify the curve shape
console.log('\nRaw R values at center row:');
let line = '';
for (let x = 0; x < 50; x++) {
  line += `${getPixel(x, centerY).r} `;
}
console.log(line);

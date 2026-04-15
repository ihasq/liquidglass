import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const mockup = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));

function getPixel(x, y) {
  const idx = (y * mockup.width + x) * 4;
  return { r: mockup.data[idx], g: mockup.data[idx + 1], b: mockup.data[idx + 2] };
}

console.log('=== MOCKUP ANTI-ALIASING ANALYSIS ===\n');

// Top-left corner (858, 60) with radius ~74
// Look for anti-aliased (gray) pixels

console.log('Scanning top-left corner for gray pixels (not pure black or white):');

for (let y = 60; y < 140; y++) {
  for (let x = 858; x < 940; x++) {
    const p = getPixel(x, y);
    // Look for pixels that aren't pure black or pure white
    if (p.r > 10 && p.r < 245) {
      console.log(`  (${x}, ${y}): rgb(${p.r}, ${p.g}, ${p.b})`);
    }
  }
}

console.log('\n=== TRANSITION ZONE ===');
// Scan more systematically around the expected corner edge

const center = { x: 858 + 74, y: 60 + 74 }; // Approximate circle center
console.log(`Circle center (estimated): (${center.x}, ${center.y})`);

// Check pixels at different angles around the corner
for (let angle = 135; angle <= 180; angle += 5) {
  const rad = angle * Math.PI / 180;
  const x = Math.round(center.x + 74 * Math.cos(rad));
  const y = Math.round(center.y + 74 * Math.sin(rad));

  const p = getPixel(x, y);
  console.log(`angle=${angle}: (${x}, ${y}) = rgb(${p.r}, ${p.g}, ${p.b})`);
}

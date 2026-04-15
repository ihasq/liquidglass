import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const SCREENSHOT_PATH = './screenshots/current.png';

const mockup = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));
const screenshot = PNG.sync.read(fs.readFileSync(SCREENSHOT_PATH));

function getPixel(png, x, y) {
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

console.log('=== PIXEL VALUES AT Y=325 (slider center) ===\n');

console.log('x\tMockup R\tScreenshot R\tDiff');
for (let x = 430; x < 480; x++) {
  const mp = getPixel(mockup, x, 325);
  const sp = getPixel(screenshot, x, 325);
  const diff = Math.abs(mp.r - sp.r);
  const marker = diff > 50 ? '***' : diff > 20 ? '*' : '';
  console.log(`${x}\t${mp.r}\t\t${sp.r}\t\t${diff} ${marker}`);
}

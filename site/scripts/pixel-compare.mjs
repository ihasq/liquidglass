import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const SCREENSHOT_PATH = './screenshots/current.png';

function getPixel(png, x, y) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return null;
  const idx = (y * png.width + x) * 4;
  return {
    r: png.data[idx],
    g: png.data[idx + 1],
    b: png.data[idx + 2],
    hex: `#${png.data[idx].toString(16).padStart(2, '0')}${png.data[idx + 1].toString(16).padStart(2, '0')}${png.data[idx + 2].toString(16).padStart(2, '0')}`
  };
}

function main() {
  const mockupPng = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));
  const screenshotPng = PNG.sync.read(fs.readFileSync(SCREENSHOT_PATH));

  console.log('Comparing pixel values at key locations:\n');

  // Key positions to compare
  const positions = [
    // Title area
    { x: 129, y: 60, desc: 'Title start' },
    { x: 129, y: 80, desc: 'Title middle' },
    { x: 200, y: 80, desc: 'Title text' },

    // Step numbers
    { x: 100, y: 120, desc: 'Step 1 number area' },
    { x: 100, y: 160, desc: 'Step 2 number area' },
    { x: 100, y: 200, desc: 'Step 3 number area' },
    { x: 100, y: 680, desc: 'Step 4 number area' },

    // Code block content
    { x: 150, y: 120, desc: 'Code 1 start' },
    { x: 150, y: 160, desc: 'Code 2 start' },
    { x: 150, y: 200, desc: 'Code 3 start' },

    // Black box corners
    { x: 858, y: 60, desc: 'Black box top-left' },
    { x: 1793, y: 932, desc: 'Black box bottom-right' },
    { x: 900, y: 100, desc: 'Black box interior' },
  ];

  positions.forEach(({ x, y, desc }) => {
    const mockupP = getPixel(mockupPng, x, y);
    const screenP = getPixel(screenshotPng, x, y);

    const match = mockupP && screenP &&
      mockupP.r === screenP.r && mockupP.g === screenP.g && mockupP.b === screenP.b;

    console.log(`${desc} (${x},${y}):`);
    console.log(`  Mockup:     ${mockupP?.hex || 'N/A'}`);
    console.log(`  Screenshot: ${screenP?.hex || 'N/A'}`);
    console.log(`  Match: ${match ? '✓' : '✗'}\n`);
  });

  // Find exact positions of text in mockup vs screenshot
  console.log('\n=== Text Position Analysis ===\n');

  // Scan for first dark pixel (text) in each row
  for (let y = 50; y < 150; y += 10) {
    let mockupFirstDark = -1, screenFirstDark = -1;

    for (let x = 0; x < 500; x++) {
      const mp = getPixel(mockupPng, x, y);
      const sp = getPixel(screenshotPng, x, y);

      if (mockupFirstDark === -1 && mp && mp.r < 150) mockupFirstDark = x;
      if (screenFirstDark === -1 && sp && sp.r < 150) screenFirstDark = x;
    }

    if (mockupFirstDark > 0 || screenFirstDark > 0) {
      console.log(`Row ${y}: Mockup text starts at x=${mockupFirstDark}, Screenshot at x=${screenFirstDark}, diff=${screenFirstDark - mockupFirstDark}`);
    }
  }

  // Check vertical alignment of step numbers
  console.log('\n=== Step Number Vertical Positions ===\n');

  // Look for gray pixels (step numbers are gray)
  for (let y = 100; y < 800; y++) {
    const mockupP = getPixel(mockupPng, 103, y);
    if (mockupP && mockupP.r > 100 && mockupP.r < 200 && Math.abs(mockupP.r - mockupP.g) < 20) {
      console.log(`Potential step number at y=${y}: ${mockupP.hex}`);
    }
  }
}

main();

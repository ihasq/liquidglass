import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const SCREENSHOT_PATH = './screenshots/current.png';

function getPixel(png, x, y) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return null;
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

function main() {
  const mockup = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));
  const screenshot = PNG.sync.read(fs.readFileSync(SCREENSHOT_PATH));

  console.log('=== DIRECT POSITION COMPARISON ===\n');

  // Title - find y position where text starts
  console.log('TITLE Y position:');
  for (let y = 60; y < 90; y++) {
    let mockupHasText = false, screenHasText = false;
    for (let x = 129; x < 200; x++) {
      const mp = getPixel(mockup, x, y);
      const sp = getPixel(screenshot, x, y);
      if (mp && mp.r < 220) mockupHasText = true;
      if (sp && sp.r < 220) screenHasText = true;
    }
    if (mockupHasText || screenHasText) {
      console.log(`  y=${y}: mockup=${mockupHasText}, screen=${screenHasText}`);
    }
  }

  // Step 1 code block position
  console.log('\nSTEP 1 code block Y:');
  for (let y = 140; y < 220; y += 5) {
    let mockupText = false, screenText = false;
    for (let x = 180; x < 280; x++) {
      const mp = getPixel(mockup, x, y);
      const sp = getPixel(screenshot, x, y);
      if (mp && mp.r < 50) mockupText = true;
      if (sp && sp.r < 50) screenText = true;
    }
    if (mockupText || screenText) {
      console.log(`  y=${y}: mockup=${mockupText}, screen=${screenText}`);
    }
  }

  // Step 3 slider rows
  console.log('\nSTEP 3 slider lines:');
  // Look for gray lines
  for (let y = 280; y < 660; y += 10) {
    let mockupLine = 0, screenLine = 0;
    for (let x = 170; x < 450; x++) {
      const mp = getPixel(mockup, x, y);
      const sp = getPixel(screenshot, x, y);
      if (mp && mp.r > 200 && mp.r < 250) mockupLine++;
      if (sp && sp.r > 200 && sp.r < 250) screenLine++;
    }
    if (mockupLine > 100 || screenLine > 100) {
      console.log(`  y=${y}: mockup=${mockupLine > 100}, screen=${screenLine > 100}`);
    }
  }

  // Step 4 code position
  console.log('\nSTEP 4 code Y:');
  for (let y = 560; y < 750; y += 10) {
    let mockupBg = false, screenBg = false;
    for (let x = 170; x < 250; x++) {
      const mp = getPixel(mockup, x, y);
      const sp = getPixel(screenshot, x, y);
      if (mp && mp.r > 230 && mp.r < 245) mockupBg = true;
      if (sp && sp.r > 230 && sp.r < 245) screenBg = true;
    }
    if (mockupBg || screenBg) {
      console.log(`  y=${y}: mockup has #eee bg = ${mockupBg}, screen = ${screenBg}`);
    }
  }

  // Look for exact positions of slider circles
  console.log('\nSLIDER CIRCLES X position:');
  const testY = 375; // middle of first slider row
  for (let x = 340; x < 420; x++) {
    const mp = getPixel(mockup, x, testY);
    const sp = getPixel(screenshot, x, testY);
    const mpIsCircle = mp && mp.r > 100 && mp.r < 200;
    const spIsCircle = sp && sp.r > 100 && sp.r < 200;
    if (mpIsCircle || spIsCircle) {
      console.log(`  x=${x}: mockup circle=${mpIsCircle} (${mp?.r}), screen circle=${spIsCircle} (${sp?.r})`);
    }
  }
}

main();

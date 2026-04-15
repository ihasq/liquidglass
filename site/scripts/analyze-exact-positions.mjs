import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';

function getPixel(png, x, y) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return null;
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

function main() {
  const png = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));

  console.log('=== PRECISE POSITION EXTRACTION ===\n');

  // Title
  console.log('TITLE:');
  let titleMinX = 9999, titleMinY = 9999, titleMaxX = 0, titleMaxY = 0;
  for (let y = 50; y < 130; y++) {
    for (let x = 100; x < 600; x++) {
      const p = getPixel(png, x, y);
      if (p && p.r < 200 && p.g < 200 && p.b < 200) { // Not white
        if (x < titleMinX) titleMinX = x;
        if (x > titleMaxX) titleMaxX = x;
        if (y < titleMinY) titleMinY = y;
        if (y > titleMaxY) titleMaxY = y;
      }
    }
  }
  console.log(`  Bounds: x=${titleMinX}-${titleMaxX}, y=${titleMinY}-${titleMaxY}`);
  console.log(`  Size: ${titleMaxX - titleMinX}w x ${titleMaxY - titleMinY}h`);

  // Get title color at center
  const titleCenterX = Math.floor((titleMinX + titleMaxX) / 2);
  const titleCenterY = Math.floor((titleMinY + titleMaxY) / 2);
  const titleColor = getPixel(png, titleCenterX, titleCenterY);
  console.log(`  Color at center: rgb(${titleColor?.r},${titleColor?.g},${titleColor?.b})`);

  // Step numbers - find exact positions
  console.log('\nSTEP NUMBERS:');
  const stepYs = [194, 259, 325, 689];
  stepYs.forEach((y, i) => {
    // Find the step number circle/text
    let foundX = -1;
    for (let x = 80; x < 140; x++) {
      const p = getPixel(png, x, y);
      if (p && p.r > 100 && p.r < 220 && Math.abs(p.r - p.g) < 10) {
        foundX = x;
        console.log(`  Step ${i+1} at y=${y}: found at x=${x}, color=rgb(${p.r},${p.g},${p.b})`);
        break;
      }
    }
  });

  // Code block positions - find exact y positions
  console.log('\nCODE BLOCKS:');

  // Step 1 code: scan for dark text around y=190-203
  console.log('Step 1:');
  for (let y = 185; y < 210; y++) {
    let textStart = -1;
    for (let x = 130; x < 600; x++) {
      const p = getPixel(png, x, y);
      if (p && p.r < 100 && textStart === -1) {
        textStart = x;
        break;
      }
    }
    if (textStart > 0) {
      console.log(`  y=${y}: text starts at x=${textStart}`);
    }
  }

  // Step 2 code: scan for dark text around y=255-268
  console.log('Step 2:');
  for (let y = 250; y < 275; y++) {
    let textStart = -1;
    for (let x = 130; x < 600; x++) {
      const p = getPixel(png, x, y);
      if (p && p.r < 100 && textStart === -1) {
        textStart = x;
        break;
      }
    }
    if (textStart > 0) {
      console.log(`  y=${y}: text starts at x=${textStart}`);
    }
  }

  // Step 3: slider lines positions
  console.log('\nStep 3 SLIDER ROWS:');
  const sliderYs = [360, 409, 458, 507, 555, 603]; // Based on earlier analysis
  sliderYs.forEach((baseY, i) => {
    // Find the line
    let lineStart = -1, lineEnd = -1, circleX = -1;
    for (let x = 130; x < 500; x++) {
      const p = getPixel(png, x, baseY + 15);
      if (p && p.r > 200 && p.r < 240 && lineStart === -1) {
        lineStart = x;
      }
      if (p && p.r > 200 && p.r < 240) {
        lineEnd = x;
      }
    }
    // Find circle
    for (let x = lineEnd - 20; x < lineEnd + 40; x++) {
      const p = getPixel(png, x, baseY + 15);
      if (p && p.r < 200 && p.r > 100) {
        circleX = x;
        break;
      }
    }
    console.log(`  Row ${i+1} (y~${baseY}): line x=${lineStart}-${lineEnd}`);
  });

  // Step 4 content
  console.log('\nStep 4:');
  for (let y = 690; y < 910; y += 20) {
    let textStart = -1;
    for (let x = 130; x < 600; x++) {
      const p = getPixel(png, x, y);
      if (p && p.r < 100 && textStart === -1) {
        textStart = x;
        break;
      }
    }
    if (textStart > 0) {
      console.log(`  y=${y}: text starts at x=${textStart}`);
    }
  }

  // Copy icons positions
  console.log('\nCOPY ICONS (looking for gray icons):');
  const copyIconYs = [190, 255, 315, 690];
  copyIconYs.forEach((y, i) => {
    let iconX = -1;
    for (let x = 500; x < 600; x++) {
      const p = getPixel(png, x, y);
      if (p && p.r > 100 && p.r < 200 && p.g > 100 && p.g < 200) {
        iconX = x;
        console.log(`  Step ${i+1} (y=${y}): icon at x=${x}, color=rgb(${p.r},${p.g},${p.b})`);
        break;
      }
    }
  });
}

main();

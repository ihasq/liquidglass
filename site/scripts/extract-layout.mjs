import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';

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

function isDark(p, threshold = 180) {
  return p && p.r < threshold;
}

function isGray(p) {
  return p && p.r > 150 && p.r < 220 && Math.abs(p.r - p.g) < 10 && Math.abs(p.r - p.b) < 10;
}

function main() {
  const png = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));

  console.log('=== MOCKUP LAYOUT EXTRACTION ===\n');
  console.log(`Image size: ${png.width}x${png.height}\n`);

  // Find title bounds
  console.log('--- TITLE ---');
  let titleTop = -1, titleBottom = -1, titleLeft = -1, titleRight = -1;
  for (let y = 0; y < 150; y++) {
    for (let x = 0; x < 500; x++) {
      const p = getPixel(png, x, y);
      if (isDark(p)) {
        if (titleTop === -1) titleTop = y;
        titleBottom = y;
        if (titleLeft === -1 || x < titleLeft) titleLeft = x;
        if (x > titleRight) titleRight = x;
      }
    }
  }
  console.log(`Title bounds: x=${titleLeft}-${titleRight} (w=${titleRight - titleLeft}), y=${titleTop}-${titleBottom} (h=${titleBottom - titleTop})`);

  // Sample title color
  const titleColor = getPixel(png, Math.floor((titleLeft + titleRight) / 2), Math.floor((titleTop + titleBottom) / 2));
  console.log(`Title color: ${titleColor?.hex}`);

  // Find step number circles (look for gray pixels in left margin)
  console.log('\n--- STEP NUMBERS ---');
  let stepPositions = [];
  let lastStepY = -100;

  for (let y = titleBottom + 20; y < 900; y++) {
    for (let x = 80; x < 130; x++) {
      const p = getPixel(png, x, y);
      if (isGray(p) && y - lastStepY > 30) {
        // Found potential step number - scan for exact bounds
        let circleTop = y, circleBottom = y;
        for (let sy = y - 10; sy < y + 30; sy++) {
          const sp = getPixel(png, x, sy);
          if (isGray(sp)) {
            if (sy < circleTop) circleTop = sy;
            if (sy > circleBottom) circleBottom = sy;
          }
        }

        stepPositions.push({ y: Math.floor((circleTop + circleBottom) / 2), top: circleTop, bottom: circleBottom, x });
        lastStepY = y;
        console.log(`Step at y=${Math.floor((circleTop + circleBottom) / 2)}, height=${circleBottom - circleTop}, color=${p.hex}`);
        break;
      }
    }
  }

  // Find text rows for each code block
  console.log('\n--- CODE BLOCKS ---');

  // Scan each section between step numbers
  for (let s = 0; s < stepPositions.length; s++) {
    const startY = stepPositions[s].y - 10;
    const endY = s < stepPositions.length - 1 ? stepPositions[s + 1].y - 30 : 900;

    console.log(`\nStep ${s + 1} content (y=${startY} to ${endY}):`);

    // Find text bounds
    let textTop = -1, textBottom = -1, textLeft = 1000, textRight = 0;
    let textRows = [];

    for (let y = startY; y < endY; y++) {
      let rowHasText = false;
      for (let x = 120; x < 600; x++) {
        const p = getPixel(png, x, y);
        if (p && p.r < 100) { // Dark text
          rowHasText = true;
          if (textTop === -1) textTop = y;
          textBottom = y;
          if (x < textLeft) textLeft = x;
          if (x > textRight) textRight = x;
        }
      }
      if (rowHasText) {
        textRows.push(y);
      }
    }

    if (textTop !== -1) {
      console.log(`  Text bounds: x=${textLeft}-${textRight}, y=${textTop}-${textBottom}`);
      console.log(`  Text rows: ${textRows.length}`);

      // Group consecutive rows
      let lines = [];
      let currentLine = [textRows[0]];
      for (let i = 1; i < textRows.length; i++) {
        if (textRows[i] - textRows[i-1] <= 3) {
          currentLine.push(textRows[i]);
        } else {
          lines.push({ start: currentLine[0], end: currentLine[currentLine.length - 1] });
          currentLine = [textRows[i]];
        }
      }
      if (currentLine.length > 0) {
        lines.push({ start: currentLine[0], end: currentLine[currentLine.length - 1] });
      }

      console.log(`  Line count: ${lines.length}`);
      lines.forEach((line, i) => {
        console.log(`    Line ${i + 1}: y=${line.start}-${line.end} (h=${line.end - line.start + 1})`);
      });
    }
  }

  // Black box
  console.log('\n--- BLACK PREVIEW BOX ---');
  let boxLeft = 0, boxRight = 0, boxTop = 0, boxBottom = 0;
  for (let x = 0; x < png.width; x++) {
    const p = getPixel(png, x, 500);
    if (p && p.r < 10 && p.g < 10 && p.b < 10) {
      if (boxLeft === 0) boxLeft = x;
      boxRight = x;
    }
  }
  for (let y = 0; y < png.height; y++) {
    const p = getPixel(png, Math.floor((boxLeft + boxRight) / 2), y);
    if (p && p.r < 10 && p.g < 10 && p.b < 10) {
      if (boxTop === 0) boxTop = y;
      boxBottom = y;
    }
  }
  console.log(`Box position: x=${boxLeft}, y=${boxTop}`);
  console.log(`Box size: ${boxRight - boxLeft + 1}x${boxBottom - boxTop + 1}`);
  console.log(`Right margin: ${png.width - boxRight - 1}`);
  console.log(`Bottom margin: ${png.height - boxBottom - 1}`);
}

main();

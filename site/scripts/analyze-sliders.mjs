import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const png = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));

function getPixel(x, y) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return null;
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

console.log('=== SLIDER ANALYSIS ===\n');

const expectedYs = [325, 374, 423, 472, 521, 569, 618];

expectedYs.forEach((expectedY, i) => {
  console.log(`\n=== Slider ${i + 1} (expected y=${expectedY}) ===`);

  // Find the exact y where gray line is
  for (let y = expectedY - 10; y <= expectedY + 10; y++) {
    // Check at x=200 for gray line
    const p = getPixel(200, y);
    if (p && p.r > 200 && p.r < 230 && p.g > 200 && p.g < 230) {
      console.log(`Gray line at y=${y}: rgb(${p.r},${p.g},${p.b})`);
    }
  }

  // Find the knob (black circle)
  let knobStartX = -1, knobEndX = -1;
  for (let x = 420; x < 520; x++) {
    const p = getPixel(x, expectedY);
    if (p && p.r < 30) {
      if (knobStartX === -1) knobStartX = x;
      knobEndX = x;
    }
  }
  console.log(`Knob horizontal: x=${knobStartX} to ${knobEndX} (width=${knobEndX - knobStartX + 1})`);

  // Find knob vertical extent
  let knobTopY = -1, knobBottomY = -1;
  const knobCenterX = Math.floor((knobStartX + knobEndX) / 2);
  for (let y = expectedY - 20; y <= expectedY + 20; y++) {
    const p = getPixel(knobCenterX, y);
    if (p && p.r < 30) {
      if (knobTopY === -1) knobTopY = y;
      knobBottomY = y;
    }
  }
  console.log(`Knob vertical: y=${knobTopY} to ${knobBottomY} (height=${knobBottomY - knobTopY + 1})`);
  console.log(`Knob center: (${knobCenterX}, ${Math.floor((knobTopY + knobBottomY) / 2)})`);

  // Find white text inside knob
  let textStartX = -1;
  for (let x = knobStartX; x < knobEndX; x++) {
    const p = getPixel(x, expectedY);
    if (p && p.r > 200) {
      if (textStartX === -1) {
        textStartX = x;
        console.log(`White text starts at x=${x}`);
      }
    }
  }

  // Find right gray line
  let rightLineStart = -1, rightLineEnd = -1;
  for (let x = knobEndX; x < 550; x++) {
    const p = getPixel(x, expectedY);
    if (p && p.r > 200 && p.r < 230 && p.g > 200 && p.g < 230) {
      if (rightLineStart === -1) rightLineStart = x;
      rightLineEnd = x;
    }
  }
  console.log(`Right gray line: x=${rightLineStart} to ${rightLineEnd} (width=${rightLineEnd - rightLineStart + 1})`);
});

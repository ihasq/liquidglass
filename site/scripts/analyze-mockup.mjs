import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';

function getPixel(png, x, y) {
  const idx = (y * png.width + x) * 4;
  return {
    r: png.data[idx],
    g: png.data[idx + 1],
    b: png.data[idx + 2],
    a: png.data[idx + 3],
    hex: `#${png.data[idx].toString(16).padStart(2, '0')}${png.data[idx + 1].toString(16).padStart(2, '0')}${png.data[idx + 2].toString(16).padStart(2, '0')}`
  };
}

function findColorBoundaries(png, color, threshold = 30) {
  let minX = png.width, maxX = 0, minY = png.height, maxY = 0;
  const [tr, tg, tb] = color;

  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const p = getPixel(png, x, y);
      if (Math.abs(p.r - tr) < threshold && Math.abs(p.g - tg) < threshold && Math.abs(p.b - tb) < threshold) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  return { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function main() {
  const mockupBuffer = fs.readFileSync(MOCKUP_PATH);
  const png = PNG.sync.read(mockupBuffer);

  console.log(`Mockup dimensions: ${png.width}x${png.height}`);
  console.log('');

  // Sample background color
  console.log('Background color (10,10):', getPixel(png, 10, 10).hex);
  console.log('Background color (100,100):', getPixel(png, 100, 100).hex);

  // Find black area (the preview box)
  const blackBounds = findColorBoundaries(png, [0, 0, 0], 20);
  console.log('');
  console.log('Black preview box:');
  console.log(`  Position: (${blackBounds.minX}, ${blackBounds.minY})`);
  console.log(`  Size: ${blackBounds.width}x${blackBounds.height}`);

  // Sample some key pixels for text areas
  console.log('');
  console.log('Sample pixels:');
  for (let y = 0; y < 100; y += 20) {
    for (let x = 0; x < 400; x += 50) {
      const p = getPixel(png, x, y);
      if (p.r < 200 || p.g < 200 || p.b < 200) {
        console.log(`  (${x},${y}): ${p.hex}`);
      }
    }
  }

  // Find white areas (code blocks)
  console.log('');
  console.log('Looking for white boxes (code blocks)...');
  const whiteBounds = findColorBoundaries(png, [255, 255, 255], 10);
  console.log(`  White area: (${whiteBounds.minX}, ${whiteBounds.minY}) to (${whiteBounds.maxX}, ${whiteBounds.maxY})`);

  // Scan for text rows (look for dark pixels)
  console.log('');
  console.log('Text row analysis (first 200px):');
  let textRows = [];
  for (let y = 0; y < 200; y++) {
    let darkPixels = 0;
    for (let x = 0; x < 500; x++) {
      const p = getPixel(png, x, y);
      if (p.r < 150 && p.g < 150 && p.b < 150) {
        darkPixels++;
      }
    }
    if (darkPixels > 10) {
      textRows.push({ y, darkPixels });
    }
  }

  // Group consecutive text rows
  let currentGroup = [];
  let groups = [];
  for (let i = 0; i < textRows.length; i++) {
    if (currentGroup.length === 0 || textRows[i].y - currentGroup[currentGroup.length - 1].y <= 2) {
      currentGroup.push(textRows[i]);
    } else {
      if (currentGroup.length > 0) {
        groups.push({
          startY: currentGroup[0].y,
          endY: currentGroup[currentGroup.length - 1].y,
          height: currentGroup[currentGroup.length - 1].y - currentGroup[0].y + 1
        });
      }
      currentGroup = [textRows[i]];
    }
  }
  if (currentGroup.length > 0) {
    groups.push({
      startY: currentGroup[0].y,
      endY: currentGroup[currentGroup.length - 1].y,
      height: currentGroup[currentGroup.length - 1].y - currentGroup[0].y + 1
    });
  }

  console.log('Text line groups:');
  groups.slice(0, 10).forEach((g, i) => {
    console.log(`  ${i + 1}. Y: ${g.startY}-${g.endY} (height: ${g.height})`);
  });
}

main();

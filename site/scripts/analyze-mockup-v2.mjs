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
    a: png.data[idx + 3],
    hex: `#${png.data[idx].toString(16).padStart(2, '0')}${png.data[idx + 1].toString(16).padStart(2, '0')}${png.data[idx + 2].toString(16).padStart(2, '0')}`
  };
}

function isBlack(p, threshold = 30) {
  return p && p.r < threshold && p.g < threshold && p.b < threshold;
}

function isWhite(p, threshold = 250) {
  return p && p.r > threshold && p.g > threshold && p.b > threshold;
}

function isGray(p, minGray = 200, maxGray = 250) {
  return p && p.r > minGray && p.r < maxGray &&
         Math.abs(p.r - p.g) < 10 && Math.abs(p.r - p.b) < 10;
}

function main() {
  const mockupBuffer = fs.readFileSync(MOCKUP_PATH);
  const png = PNG.sync.read(mockupBuffer);

  console.log(`Mockup dimensions: ${png.width}x${png.height}\n`);

  // Find the black rectangle more accurately
  // Scan horizontally at y=500 (middle) to find black region
  let blackStartX = -1, blackEndX = -1;
  for (let x = 0; x < png.width; x++) {
    const p = getPixel(png, x, 500);
    if (isBlack(p) && blackStartX === -1) {
      blackStartX = x;
    }
    if (isBlack(p)) {
      blackEndX = x;
    }
  }

  // Scan vertically at the center of black region
  const blackCenterX = (blackStartX + blackEndX) / 2;
  let blackStartY = -1, blackEndY = -1;
  for (let y = 0; y < png.height; y++) {
    const p = getPixel(png, Math.floor(blackCenterX), y);
    if (isBlack(p) && blackStartY === -1) {
      blackStartY = y;
    }
    if (isBlack(p)) {
      blackEndY = y;
    }
  }

  console.log('Black preview box:');
  console.log(`  X: ${blackStartX} to ${blackEndX} (width: ${blackEndX - blackStartX + 1})`);
  console.log(`  Y: ${blackStartY} to ${blackEndY} (height: ${blackEndY - blackStartY + 1})`);
  console.log(`  Center: (${Math.floor(blackCenterX)}, ${Math.floor((blackStartY + blackEndY) / 2)})`);
  console.log('');

  // Sample key locations
  console.log('Key pixel samples:');
  const samplePoints = [
    [10, 10, 'top-left corner'],
    [100, 10, 'title area'],
    [50, 50, 'left margin'],
    [blackStartX - 50, 300, 'left of black box'],
    [blackStartX + 50, blackStartY + 50, 'inside black box corner'],
  ];

  samplePoints.forEach(([x, y, desc]) => {
    const p = getPixel(png, x, y);
    if (p) console.log(`  ${desc} (${x},${y}): ${p.hex}`);
  });
  console.log('');

  // Scan for horizontal edges (text lines) in left portion
  console.log('Scanning for text elements in left portion...');
  const leftWidth = blackStartX - 50;

  // Find rows with dark pixels (text)
  let textRows = [];
  for (let y = 0; y < png.height; y++) {
    let darkPixels = 0;
    let leftmostDark = leftWidth;
    for (let x = 0; x < leftWidth; x++) {
      const p = getPixel(png, x, y);
      if (p && p.r < 150) {
        darkPixels++;
        if (x < leftmostDark) leftmostDark = x;
      }
    }
    if (darkPixels > 5) {
      textRows.push({ y, darkPixels, leftmostDark });
    }
  }

  // Group consecutive rows
  let groups = [];
  let currentGroup = [];
  for (const row of textRows) {
    if (currentGroup.length === 0 || row.y - currentGroup[currentGroup.length - 1].y <= 3) {
      currentGroup.push(row);
    } else {
      groups.push(currentGroup);
      currentGroup = [row];
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  console.log(`Found ${groups.length} text elements:\n`);
  groups.forEach((g, i) => {
    const startY = g[0].y;
    const endY = g[g.length - 1].y;
    const height = endY - startY + 1;
    const leftmost = Math.min(...g.map(r => r.leftmostDark));
    const totalPixels = g.reduce((s, r) => s + r.darkPixels, 0);

    // Classify by position and size
    let type = 'unknown';
    if (height > 15 && leftmost < 50) type = 'title';
    else if (height < 15 && leftmost < 30) type = 'step-number';
    else if (height >= 10 && leftmost >= 30) type = 'code-block';

    console.log(`  ${i + 1}. Y: ${startY}-${endY} (h=${height}), X starts at ${leftmost}, type: ${type}`);
  });

  // Detect code block boundaries (look for white rectangles)
  console.log('\nSearching for code block boundaries...');

  // Look for horizontal transitions from gray to white
  let codeBlocks = [];
  let inCodeBlock = false;
  let currentBlock = { startY: 0, endY: 0 };

  for (let y = 50; y < png.height - 50; y++) {
    // Sample at x=100 (should be inside code blocks)
    const p = getPixel(png, 100, y);
    const pLeft = getPixel(png, 30, y); // Step number area

    if (isWhite(p) && !inCodeBlock) {
      inCodeBlock = true;
      currentBlock.startY = y;
    } else if (!isWhite(p) && inCodeBlock) {
      inCodeBlock = false;
      currentBlock.endY = y - 1;
      if (currentBlock.endY - currentBlock.startY > 20) {
        codeBlocks.push({ ...currentBlock });
      }
    }
  }

  console.log(`Found ${codeBlocks.length} potential code blocks:`);
  codeBlocks.forEach((block, i) => {
    console.log(`  ${i + 1}. Y: ${block.startY}-${block.endY} (height: ${block.endY - block.startY + 1})`);
  });

  // Measure padding/margins
  console.log('\nLayout measurements:');
  console.log(`  Left margin: ~${textRows.length > 0 ? Math.min(...textRows.map(r => r.leftmostDark)) : 0}px`);
  console.log(`  Right side starts: ${blackStartX}px`);
  console.log(`  Black box padding from right: ${png.width - blackEndX}px`);
  console.log(`  Black box padding from bottom: ${png.height - blackEndY}px`);
  console.log(`  Black box border-radius: ~${(blackEndY - blackStartY) * 0.08 | 0}px (estimated)`);
}

main();

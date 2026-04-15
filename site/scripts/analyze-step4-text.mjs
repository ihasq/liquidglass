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

console.log('=== STEP 4 TEXT COMPARISON ===\n');

// First line "div {" should be around y=692 based on earlier analysis
console.log('Scanning for "div {" text (y=690-700):');

for (let y = 688; y < 705; y++) {
  let mockupFirstBlack = -1;
  let screenshotFirstBlack = -1;

  for (let x = 180; x < 250; x++) {
    const mp = getPixel(mockup, x, y);
    const sp = getPixel(screenshot, x, y);

    if (mp.r < 30 && mockupFirstBlack === -1) {
      mockupFirstBlack = x;
    }
    if (sp.r < 30 && screenshotFirstBlack === -1) {
      screenshotFirstBlack = x;
    }
  }

  if (mockupFirstBlack > 0 || screenshotFirstBlack > 0) {
    console.log(`y=${y}: mockup starts at x=${mockupFirstBlack}, screenshot starts at x=${screenshotFirstBlack}, diff=${mockupFirstBlack - screenshotFirstBlack}`);
  }
}

// Check specific line - the property names
console.log('\n=== LINE HEIGHT CHECK ===');
// Find y positions where "--liquidglass" text appears

let mockupTextYs = [];
let screenshotTextYs = [];

for (let y = 700; y < 880; y++) {
  const mp = getPixel(mockup, 195, y); // x=195 is in the middle of "--"
  const sp = getPixel(screenshot, 195, y);

  if (mp.r < 30) mockupTextYs.push(y);
  if (sp.r < 30) screenshotTextYs.push(y);
}

// Group consecutive y values
function groupConsecutive(arr) {
  const groups = [];
  let current = [arr[0]];

  for (let i = 1; i < arr.length; i++) {
    if (arr[i] - arr[i-1] <= 2) {
      current.push(arr[i]);
    } else {
      groups.push(current);
      current = [arr[i]];
    }
  }
  groups.push(current);
  return groups;
}

const mockupLines = groupConsecutive(mockupTextYs);
const screenshotLines = groupConsecutive(screenshotTextYs);

console.log(`Mockup has ${mockupLines.length} text lines at x=195`);
console.log(`Screenshot has ${screenshotLines.length} text lines at x=195`);

console.log('\nLine center positions:');
for (let i = 0; i < Math.max(mockupLines.length, screenshotLines.length); i++) {
  const mCenter = mockupLines[i] ? Math.floor((mockupLines[i][0] + mockupLines[i][mockupLines[i].length-1]) / 2) : 'N/A';
  const sCenter = screenshotLines[i] ? Math.floor((screenshotLines[i][0] + screenshotLines[i][screenshotLines[i].length-1]) / 2) : 'N/A';
  console.log(`Line ${i+1}: mockup y=${mCenter}, screenshot y=${sCenter}`);
}

import { PNG } from 'pngjs';
import fs from 'fs';
import puppeteer from 'puppeteer';

const MOCKUP_PATH = '../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';

// Load mockup once
const mockupPng = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));

function getPixel(png, x, y) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return null;
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

// Extract ground truth constraints from mockup
function extractConstraints() {
  const constraints = {
    // Title position
    title: { x: 129, y: 72, width: 370, height: 43 },

    // Step numbers (x, y center)
    steps: [
      { x: 129, y: 191 },
      { x: 129, y: 257 },
      { x: 129, y: 322 },
      { x: 129, y: 687 },
    ],

    // Code blocks (x, y, approximate width)
    codeBlocks: [
      { x: 167, y: 177, height: 35 },  // Step 1
      { x: 167, y: 243, height: 35 },  // Step 2
    ],

    // Slider lines (x start, x end, y center)
    sliders: [
      { xStart: 167, xEnd: 509, y: 325, textX: 445 },
      { xStart: 167, xEnd: 509, y: 374, textX: 445 },
      { xStart: 167, xEnd: 509, y: 423, textX: 445 },
      { xStart: 167, xEnd: 509, y: 472, textX: 445 },
      { xStart: 167, xEnd: 509, y: 521, textX: 445 },
      { xStart: 167, xEnd: 509, y: 569, textX: 445 },
      { xStart: 167, xEnd: 509, y: 618, textX: 445 },
    ],

    // Step 4 code block
    step4Code: { x: 167, y: 690, firstTextY: 730 },

    // Black box
    blackBox: { x: 858, y: 60, width: 936, height: 873, radius: 69 },
  };

  return constraints;
}

// Define search space for each parameter
const searchSpace = {
  titleTop: { min: 60, max: 80, step: 1 },
  titleFontSize: { min: 38, max: 48, step: 1 },
  step1Top: { min: 170, max: 190, step: 1 },
  step2Top: { min: 235, max: 255, step: 1 },
  step3Top: { min: 305, max: 325, step: 1 },
  step4Top: { min: 670, max: 695, step: 1 },
  codeBlockHeight: { min: 30, max: 40, step: 1 },
  sliderLineWidth: { min: 330, max: 350, step: 1 },
  sliderTextOffset: { min: 270, max: 290, step: 1 },
};

// Generate component HTML with given parameters
function generateHTML(params) {
  const sliderYs = [325, 374, 423, 472, 521, 569, 618];
  const sliderValues = ['50;', '50;', '50;', '50;', '50;', '50;', '50px;'];

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter+Tight&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Geist Mono', monospace; background: white; }
    @font-face {
      font-family: 'Geist Mono';
      src: url('https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-mono/GeistMono-Regular.woff2') format('woff2');
    }
  </style>
</head>
<body>
  <div style="position:relative;width:1919px;height:997px;overflow:hidden;">
    <!-- Title -->
    <div style="position:absolute;left:129px;top:${params.titleTop}px;font-size:${params.titleFontSize}px;font-style:italic;color:#bebebe;font-family:'Geist Mono',monospace;">
      liquidglass.css
    </div>

    <!-- Step 1 -->
    <span style="position:absolute;left:104px;top:${params.step1Top}px;font-size:14px;color:#b0b0b0;font-family:'Inter Tight',sans-serif;">①</span>
    <div style="position:absolute;left:167px;top:${params.step1Top - 5}px;height:${params.codeBlockHeight}px;background:#eee;display:flex;align-items:center;padding:0 40px 0 22px;font-size:13px;">
      npm i liquidglass.css
    </div>

    <!-- Step 2 -->
    <span style="position:absolute;left:104px;top:${params.step2Top}px;font-size:14px;color:#8f8f8f;font-family:'Inter Tight',sans-serif;">②</span>
    <div style="position:absolute;left:167px;top:${params.step2Top - 5}px;height:${params.codeBlockHeight}px;background:#eee;display:flex;align-items:center;padding:0 40px 0 22px;font-size:13px;">
      import "liquidglass.css"
    </div>

    <!-- Step 3 -->
    <span style="position:absolute;left:104px;top:${params.step3Top}px;font-size:14px;color:#a1a1a1;font-family:'Inter Tight',sans-serif;">③</span>

    <!-- Sliders -->
    ${sliderYs.map((y, i) => `
    <div style="position:absolute;left:167px;top:${y - 3}px;">
      <div style="width:${params.sliderLineWidth}px;height:6px;background:#d9d9d9;"></div>
      <span style="position:absolute;left:${params.sliderTextOffset}px;top:-4px;font-size:13px;color:#000;">${sliderValues[i]}</span>
    </div>
    `).join('')}

    <!-- Step 4 -->
    <span style="position:absolute;left:104px;top:${params.step4Top}px;font-size:14px;color:#858585;font-family:'Inter Tight',sans-serif;">④</span>
    <div style="position:absolute;left:167px;top:${params.step4Top + 10}px;background:#eee;padding:12px 40px 12px 22px;font-size:13px;line-height:1.35;">
      <pre style="margin:0;font-family:'Geist Mono',monospace;">div {
  --liquidglass-refraction:    50;
  --liquidglass-thickness:     50;
  --liquidglass-softness:      50;
  --liquidglass-gloss:         50;
  --liquidglass-saturation:    50;
  --liquidglass-dispersion:    50;

  border-radius:               50px;
}</pre>
    </div>

    <!-- Black box -->
    <div style="position:absolute;left:858px;top:60px;width:936px;height:873px;background:black;border-radius:69px;"></div>
  </div>
</body>
</html>`;
}

// Calculate match score between screenshot and mockup
function calculateScore(screenshotPng) {
  let matchingPixels = 0;
  const totalPixels = mockupPng.width * mockupPng.height;

  for (let y = 0; y < mockupPng.height; y++) {
    for (let x = 0; x < mockupPng.width; x++) {
      const mp = getPixel(mockupPng, x, y);
      const sp = getPixel(screenshotPng, x, y);

      if (sp && Math.abs(mp.r - sp.r) < 10 && Math.abs(mp.g - sp.g) < 10 && Math.abs(mp.b - sp.b) < 10) {
        matchingPixels++;
      }
    }
  }

  return matchingPixels / totalPixels;
}

// Take screenshot with given parameters
async function evaluateParams(browser, params) {
  const page = await browser.newPage();
  await page.setViewport({ width: mockupPng.width, height: mockupPng.height });

  const html = generateHTML(params);
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 500));

  const buffer = await page.screenshot({ type: 'png' });
  await page.close();

  const screenshotPng = PNG.sync.read(buffer);
  return calculateScore(screenshotPng);
}

// Grid search for optimal parameters
async function gridSearch() {
  console.log('Starting SAT-based parameter optimization...\n');

  const browser = await puppeteer.launch({ headless: true });

  let bestParams = {
    titleTop: 68,
    titleFontSize: 43,
    step1Top: 185,
    step2Top: 250,
    step3Top: 315,
    step4Top: 680,
    codeBlockHeight: 35,
    sliderLineWidth: 343,
    sliderTextOffset: 278,
  };

  let bestScore = await evaluateParams(browser, bestParams);
  console.log(`Initial score: ${(bestScore * 100).toFixed(2)}%`);

  // Iteratively optimize each parameter
  const paramNames = Object.keys(searchSpace);

  for (let iteration = 0; iteration < 3; iteration++) {
    console.log(`\n=== Iteration ${iteration + 1} ===`);

    for (const paramName of paramNames) {
      const space = searchSpace[paramName];
      let localBestValue = bestParams[paramName];
      let localBestScore = bestScore;

      console.log(`Optimizing ${paramName}...`);

      for (let value = space.min; value <= space.max; value += space.step) {
        const testParams = { ...bestParams, [paramName]: value };
        const score = await evaluateParams(browser, testParams);

        if (score > localBestScore) {
          localBestScore = score;
          localBestValue = value;
          console.log(`  ${paramName}=${value}: ${(score * 100).toFixed(2)}% (improved!)`);
        }
      }

      if (localBestScore > bestScore) {
        bestParams[paramName] = localBestValue;
        bestScore = localBestScore;
      }
    }

    console.log(`\nBest score after iteration ${iteration + 1}: ${(bestScore * 100).toFixed(2)}%`);
  }

  await browser.close();

  console.log('\n=== OPTIMAL PARAMETERS ===');
  console.log(JSON.stringify(bestParams, null, 2));
  console.log(`\nFinal match rate: ${(bestScore * 100).toFixed(2)}%`);

  // Save results
  fs.writeFileSync('./sat-results.json', JSON.stringify({ params: bestParams, score: bestScore }, null, 2));

  return bestParams;
}

gridSearch().catch(console.error);

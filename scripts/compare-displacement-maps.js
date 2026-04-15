/**
 * Compare Canvas-based and SVG-based displacement maps
 * Target: 99.9% pixel match
 */

import puppeteer from 'puppeteer';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import fs from 'fs';

const TEST_WIDTH = 200;
const TEST_HEIGHT = 100;
const TEST_RADIUS = 20;

async function runComparison() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });

  // Create comparison page
  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { margin: 0; padding: 20px; background: #fff; }
        .container { display: flex; gap: 20px; }
        .map-container {
          width: ${TEST_WIDTH}px;
          height: ${TEST_HEIGHT}px;
          border: 1px solid #000;
        }
        canvas, img { display: block; }
        h3 { margin: 5px 0; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div>
          <h3>Canvas-based</h3>
          <div class="map-container" id="canvas-container"></div>
        </div>
        <div>
          <h3>SVG-based</h3>
          <div class="map-container" id="svg-container"></div>
        </div>
      </div>
      <script>
        const WIDTH = ${TEST_WIDTH};
        const HEIGHT = ${TEST_HEIGHT};
        const BORDER_RADIUS = ${TEST_RADIUS};
        const EDGE_WIDTH_RATIO = 0.5;

        // ============================================
        // CANVAS-BASED DISPLACEMENT MAP (REFERENCE)
        // ============================================
        function generateCanvasDisplacementMap() {
          const canvas = document.createElement('canvas');
          canvas.width = WIDTH;
          canvas.height = HEIGHT;
          const ctx = canvas.getContext('2d');

          const halfW = WIDTH / 2;
          const halfH = HEIGHT / 2;
          const edgeWidth = Math.min(halfW, halfH) * EDGE_WIDTH_RATIO;
          const r = Math.min(BORDER_RADIUS, halfW, halfH);

          const imageData = ctx.createImageData(WIDTH, HEIGHT);
          const data = imageData.data;

          for (let py = 0; py < HEIGHT; py++) {
            for (let px = 0; px < WIDTH; px++) {
              const idx = (py * WIDTH + px) * 4;

              const dx = Math.abs(px - halfW);
              const dy = Math.abs(py - halfH);

              // Check if outside rounded rect
              let inBounds = true;
              const inCorner = dx > halfW - r && dy > halfH - r;
              if (inCorner) {
                const cornerX = dx - (halfW - r);
                const cornerY = dy - (halfH - r);
                if (cornerX * cornerX + cornerY * cornerY > r * r) {
                  inBounds = false;
                }
              }

              if (!inBounds) {
                data[idx] = 128;
                data[idx + 1] = 128;
                data[idx + 2] = 128;
                data[idx + 3] = 255;
                continue;
              }

              // Distance from edge and direction
              let distFromEdge;
              let dirX = 0, dirY = 0;

              if (inCorner) {
                const cornerX = dx - (halfW - r);
                const cornerY = dy - (halfH - r);
                const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
                distFromEdge = r - cornerDist;
                if (cornerDist > 0.001) {
                  dirX = (cornerX / cornerDist) * Math.sign(px - halfW);
                  dirY = (cornerY / cornerDist) * Math.sign(py - halfH);
                }
              } else {
                const distX = halfW - dx;
                const distY = halfH - dy;
                if (distX < distY) {
                  distFromEdge = distX;
                  dirX = Math.sign(px - halfW);
                } else {
                  distFromEdge = distY;
                  dirY = Math.sign(py - halfH);
                }
              }

              // Exponential decay magnitude
              const magnitude = distFromEdge < 0 ? 0 : Math.exp(-3 * distFromEdge / edgeWidth);

              // Displacement vector (pointing inward)
              const dispX = -dirX * magnitude;
              const dispY = -dirY * magnitude;

              data[idx] = Math.round(128 + dispX * 127);
              data[idx + 1] = Math.round(128 + dispY * 127);
              data[idx + 2] = 128;
              data[idx + 3] = 255;
            }
          }

          ctx.putImageData(imageData, 0, 0);
          return canvas;
        }

        // ============================================
        // SVG-BASED DISPLACEMENT MAP
        // Version 6: Pixel-perfect - exact Canvas logic replica
        // ============================================
        function generateSVGDisplacementMap() {
          const halfW = WIDTH / 2;
          const halfH = HEIGHT / 2;
          const edgeWidth = Math.min(halfW, halfH) * EDGE_WIDTH_RATIO;
          const r = Math.min(BORDER_RADIUS, halfW, halfH);

          const strips = [];

          // Process EVERY pixel using exact Canvas logic
          for (let py = 0; py < HEIGHT; py++) {
            for (let px = 0; px < WIDTH; px++) {
              const dx = Math.abs(px - halfW);
              const dy = Math.abs(py - halfH);

              // Check if outside rounded rect
              let inBounds = true;
              const inCorner = dx > halfW - r && dy > halfH - r;
              if (inCorner) {
                const cornerX = dx - (halfW - r);
                const cornerY = dy - (halfH - r);
                if (cornerX * cornerX + cornerY * cornerY > r * r) {
                  inBounds = false;
                }
              }

              // Outside bounds: neutral (handled by background)
              if (!inBounds) continue;

              let distFromEdge;
              let dirX = 0, dirY = 0;

              if (inCorner) {
                const cornerX = dx - (halfW - r);
                const cornerY = dy - (halfH - r);
                const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
                distFromEdge = r - cornerDist;
                if (cornerDist > 0.001) {
                  dirX = (cornerX / cornerDist) * Math.sign(px - halfW);
                  dirY = (cornerY / cornerDist) * Math.sign(py - halfH);
                }
              } else {
                const distX = halfW - dx;
                const distY = halfH - dy;
                if (distX < distY) {
                  distFromEdge = distX;
                  dirX = Math.sign(px - halfW);
                } else {
                  distFromEdge = distY;
                  dirY = Math.sign(py - halfH);
                }
              }

              const magnitude = distFromEdge < 0 ? 0 : Math.exp(-3 * distFromEdge / edgeWidth);

              // Skip if magnitude is negligible (neutral pixel)
              if (magnitude < 0.01) continue;

              const dispX = -dirX * magnitude;
              const dispY = -dirY * magnitude;

              const red = Math.round(128 + dispX * 127);
              const green = Math.round(128 + dispY * 127);

              // Only add rect if color differs from neutral
              if (red !== 128 || green !== 128) {
                strips.push(\`<rect x="\${px}" y="\${py}" width="1" height="1" fill="rgb(\${red},\${green},128)"/>\`);
              }
            }
          }

          const svg = \`<svg xmlns="http://www.w3.org/2000/svg" width="\${WIDTH}" height="\${HEIGHT}">
  <!-- Full background (neutral) -->
  <rect width="\${WIDTH}" height="\${HEIGHT}" fill="rgb(128,128,128)"/>
  <!-- Displacement pixels -->
  \${strips.join('\\n  ')}
</svg>\`;

          const img = new Image();
          img.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
          return img;
        }

        // Render both
        const canvasMap = generateCanvasDisplacementMap();
        document.getElementById('canvas-container').appendChild(canvasMap);

        const svgImg = generateSVGDisplacementMap();
        svgImg.onload = () => {
          document.getElementById('svg-container').appendChild(svgImg);
          window.__ready = true;
        };
        svgImg.onerror = (e) => console.error('SVG load error', e);
      </script>
    </body>
    </html>
  `);

  // Wait for images to load
  await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });
  await new Promise(r => setTimeout(r, 500));

  // Take screenshots of each map
  const canvasEl = await page.$('#canvas-container canvas');
  const svgEl = await page.$('#svg-container img');

  const canvasBuffer = await canvasEl.screenshot({ type: 'png' });
  const svgBuffer = await svgEl.screenshot({ type: 'png' });

  // Save screenshots
  fs.writeFileSync('e2e/debug/disp-canvas.png', canvasBuffer);
  fs.writeFileSync('e2e/debug/disp-svg.png', svgBuffer);

  // Compare using pixelmatch
  const canvasPng = PNG.sync.read(canvasBuffer);
  const svgPng = PNG.sync.read(svgBuffer);

  const { width, height } = canvasPng;
  const diff = new PNG({ width, height });

  const numDiffPixels = pixelmatch(
    canvasPng.data,
    svgPng.data,
    diff.data,
    width,
    height,
    { threshold: 0.1 }
  );

  const totalPixels = width * height;
  const matchRate = ((totalPixels - numDiffPixels) / totalPixels * 100).toFixed(2);

  fs.writeFileSync('e2e/debug/disp-diff.png', PNG.sync.write(diff));

  console.log('='.repeat(50));
  console.log('DISPLACEMENT MAP COMPARISON');
  console.log('='.repeat(50));
  console.log(`Dimensions: ${width} x ${height}`);
  console.log(`Total pixels: ${totalPixels}`);
  console.log(`Different pixels: ${numDiffPixels}`);
  console.log(`Match rate: ${matchRate}%`);
  console.log(`Target: 99.9%`);
  console.log('='.repeat(50));

  // Analyze specific pixel differences
  console.log('\nAnalyzing differences...');
  const diffLocations = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const dr = Math.abs(canvasPng.data[idx] - svgPng.data[idx]);
      const dg = Math.abs(canvasPng.data[idx + 1] - svgPng.data[idx + 1]);
      if (dr > 5 || dg > 5) {
        diffLocations.push({
          x, y,
          canvas: { r: canvasPng.data[idx], g: canvasPng.data[idx + 1] },
          svg: { r: svgPng.data[idx], g: svgPng.data[idx + 1] },
          diff: { r: dr, g: dg }
        });
      }
    }
  }

  console.log(`Significant differences (>5): ${diffLocations.length}`);
  if (diffLocations.length > 0) {
    console.log('\nSample differences:');
    diffLocations.slice(0, 10).forEach(d => {
      console.log(`  (${d.x}, ${d.y}): Canvas(${d.canvas.r}, ${d.canvas.g}) vs SVG(${d.svg.r}, ${d.svg.g}) diff(${d.diff.r}, ${d.diff.g})`);
    });
  }

  await browser.close();

  return { matchRate: parseFloat(matchRate), numDiffPixels, diffLocations };
}

runComparison().catch(console.error);

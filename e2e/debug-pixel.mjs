import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();

const html = `<!DOCTYPE html>
<html><body>
<canvas id="test" width="200" height="200"></canvas>
<script>
const width = 200, height = 200;
const r = 40, edgeWidthRatio = 0.5;
const halfW = width / 2, halfH = height / 2;
const minHalf = Math.min(halfW, halfH);
const edgeWidth = minHalf * edgeWidthRatio;
const cornerSize = r + edgeWidth;  // 90
const CORNER_TILE_SIZE = 256;

function fastExp(x) {
  if (x < -87) return 0;
  if (x > 0) return 1;
  return Math.exp(x);
}

function getPixel(ctx, x, y) {
  const d = ctx.getImageData(x, y, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2], a: d[3] };
}

function generateCornerTile() {
  const canvas = document.createElement('canvas');
  canvas.width = CORNER_TILE_SIZE;
  canvas.height = CORNER_TILE_SIZE;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(CORNER_TILE_SIZE, CORNER_TILE_SIZE);
  const data = imageData.data;

  const negThreeOverEdgeWidth = -3 / edgeWidth;

  for (let py = 0; py < CORNER_TILE_SIZE; py++) {
    for (let px = 0; px < CORNER_TILE_SIZE; px++) {
      const idx = (py * CORNER_TILE_SIZE + px) * 4;

      const vx = (px / CORNER_TILE_SIZE) * cornerSize;
      const vy = (py / CORNER_TILE_SIZE) * cornerSize;

      const dx = cornerSize - vx;
      const dy = cornerSize - vy;

      const signX = -1;
      const signY = -1;

      const inCornerX = dx > edgeWidth;
      const inCornerY = dy > edgeWidth;
      const inCorner = inCornerX && inCornerY;

      let inBounds = true;
      let distFromEdge = 0;
      let dirX = 0, dirY = 0;

      if (inCorner) {
        const cornerX = dx - edgeWidth;
        const cornerY = dy - edgeWidth;
        const cornerDistSq = cornerX * cornerX + cornerY * cornerY;

        if (cornerDistSq > r * r) {
          inBounds = false;
        } else {
          const cornerDist = Math.sqrt(cornerDistSq);
          distFromEdge = r - cornerDist;
          if (cornerDist > 0.001) {
            const invDist = 1 / cornerDist;
            dirX = cornerX * invDist * signX;
            dirY = cornerY * invDist * signY;
          }
        }
      } else {
        const distX = vx;
        const distY = vy;
        if (distX < distY) {
          distFromEdge = distX;
          dirX = signX;
          dirY = 0;
        } else {
          distFromEdge = distY;
          dirX = 0;
          dirY = signY;
        }
      }

      if (!inBounds) {
        data[idx] = 128;
        data[idx + 1] = 128;
        data[idx + 2] = 128;
        data[idx + 3] = 255;
      } else {
        const magnitude = fastExp(distFromEdge * negThreeOverEdgeWidth);
        const dispX = -dirX * magnitude;
        const dispY = -dirY * magnitude;
        data[idx] = Math.round(Math.max(0, Math.min(255, 128 + dispX * 127)));
        data[idx + 1] = Math.round(Math.max(0, Math.min(255, 128 + dispY * 127)));
        data[idx + 2] = 128;
        data[idx + 3] = 255;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

const canvas = document.getElementById('test');
const ctx = canvas.getContext('2d');
const cornerTile = generateCornerTile();

window.debug = [];

// Test pixel position
const testX = 35, testY = 0;

// Step 1: Fill neutral
ctx.fillStyle = 'rgb(128,128,128)';
ctx.fillRect(0, 0, width, height);
window.debug.push({ step: '1-neutral', pixel: getPixel(ctx, testX, testY) });

// Step 2: Draw edges
const topGrad = ctx.createLinearGradient(0, 0, 0, cornerSize);
for (let i = 0; i <= 16; i++) {
  const offset = i / 16;
  const p = offset * cornerSize;
  const mag = Math.exp(-3 * p / edgeWidth);
  topGrad.addColorStop(offset, 'rgba(128,255,128,' + mag + ')');
}
ctx.fillStyle = topGrad;
ctx.fillRect(cornerSize, 0, Math.max(0, width - 2 * cornerSize), cornerSize);
window.debug.push({ step: '2-topEdge', pixel: getPixel(ctx, testX, testY) });

// Step 3: Draw TL corner (with smoothing disabled)
const tempCanvas = document.createElement('canvas');
tempCanvas.width = cornerSize;
tempCanvas.height = cornerSize;
const tempCtx = tempCanvas.getContext('2d');
tempCtx.imageSmoothingEnabled = false;
tempCtx.drawImage(cornerTile, 0, 0, cornerSize, cornerSize);

// Check what the corner tile has at position (35, 0) before drawing
const cornerPixel = getPixel(tempCtx, testX, testY);
window.debug.push({ step: '3a-cornerTile', pixel: cornerPixel });

ctx.drawImage(tempCanvas, 0, 0);
window.debug.push({ step: '3b-afterCorner', pixel: getPixel(ctx, testX, testY) });

// Also check the source corner tile at the scaled position
const srcX = Math.floor(testX * CORNER_TILE_SIZE / cornerSize);
const srcY = Math.floor(testY * CORNER_TILE_SIZE / cornerSize);
const tileCtx = cornerTile.getContext('2d');
window.debug.push({ step: 'cornerTileSrc', srcPos: [srcX, srcY], pixel: getPixel(tileCtx, srcX, srcY) });
</script>
</body></html>`;

await page.setContent(html);
await page.waitForFunction(() => window.debug && window.debug.length >= 5);
const debug = await page.evaluate(() => window.debug);

console.log('Debug trace for pixel (35, 0):');
debug.forEach(d => {
  console.log(`  ${d.step}: RGB(${d.pixel.r}, ${d.pixel.g}, ${d.pixel.b}, ${d.pixel.a})${d.srcPos ? ' from tile pos ' + d.srcPos : ''}`);
});

await browser.close();

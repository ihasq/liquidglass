import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();

const html = `<!DOCTYPE html>
<html><body>
<script>
const r = 40, edgeWidth = 50, cornerSize = 90;
const CORNER_TILE_SIZE = 256;

function fastExp(x) {
  if (x < -87) return 0;
  if (x > 0) return 1;
  return Math.exp(x);
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
            dirX = cornerX * invDist * -1;
            dirY = cornerY * invDist * -1;
          }
        }
      } else {
        const distX = vx;
        const distY = vy;
        if (distX < distY) {
          distFromEdge = distX;
          dirX = -1;
          dirY = 0;
        } else {
          distFromEdge = distY;
          dirX = 0;
          dirY = -1;
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
  return ctx;
}

const tileCtx = generateCornerTile();

// Check pixels at row 0 from x=95 to x=105
window.results = [];
for (let px = 95; px <= 105; px++) {
  for (let py = 0; py <= 2; py++) {
    const d = tileCtx.getImageData(px, py, 1, 1).data;
    window.results.push({
      pos: [px, py],
      rgb: [d[0], d[1], d[2]],
      neutral: d[0] === 128 && d[1] === 128
    });
  }
}
</script>
</body></html>`;

await page.setContent(html);
await page.waitForFunction(() => window.results && window.results.length > 0);
const results = await page.evaluate(() => window.results);

console.log('Source tile pixels around row 0:');
console.log('  x    y    R    G    B  neutral?');
results.forEach(r => {
  console.log(`  ${String(r.pos[0]).padStart(3)} ${String(r.pos[1]).padStart(3)}  ${String(r.rgb[0]).padStart(3)} ${String(r.rgb[1]).padStart(3)} ${String(r.rgb[2]).padStart(3)}  ${r.neutral ? 'YES' : 'no'}`);
});

await browser.close();

// Test how SVG gradients render to understand the channel behavior
const puppeteer = require('puppeteer');
const { createServer } = require('vite');
const { join, dirname } = require('path');
const { writeFileSync, readFileSync, existsSync, mkdirSync } = require('fs');
const PNG = require('pngjs').PNG;

const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'e2e/debug/svg-test');

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

async function main() {
  const server = await createServer({
    root: ROOT,
    server: { port: 3341 }
  });
  await server.listen();

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 500, height: 400, deviceScaleFactor: 1 });

  // Create test page that renders SVG gradients to canvas
  const testHtml = `<!DOCTYPE html>
<html>
<body>
<h3>SVG Gradient to Canvas Test</h3>

<div id="results"></div>

<script>
async function test() {
  const results = [];

  // Test 1: Simple X gradient (R varies, G=128, B=0)
  const svg1 = \`<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'>
    <defs>
      <linearGradient id='g' x2='1'>
        <stop offset='0' stop-color='#ff8000'/>
        <stop offset='0.5' stop-color='#808000'/>
        <stop offset='1' stop-color='#008000'/>
      </linearGradient>
    </defs>
    <rect fill='url(#g)' width='100' height='100'/>
  </svg>\`;

  // Test 2: Simple Y gradient (R=128, G varies, B=0)
  const svg2 = \`<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'>
    <defs>
      <linearGradient id='g' y2='1'>
        <stop offset='0' stop-color='#80ff00'/>
        <stop offset='0.5' stop-color='#808000'/>
        <stop offset='1' stop-color='#800000'/>
      </linearGradient>
    </defs>
    <rect fill='url(#g)' width='100' height='100'/>
  </svg>\`;

  // Test 3: Two gradients overlaid (trying to get R from X, G from Y)
  const svg3 = \`<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'>
    <defs>
      <linearGradient id='gx' x2='1'>
        <stop offset='0' stop-color='#ff0000'/>
        <stop offset='0.5' stop-color='#800000'/>
        <stop offset='1' stop-color='#000000'/>
      </linearGradient>
      <linearGradient id='gy' y2='1'>
        <stop offset='0' stop-color='#00ff00'/>
        <stop offset='0.5' stop-color='#008000'/>
        <stop offset='1' stop-color='#000000'/>
      </linearGradient>
    </defs>
    <rect fill='url(#gx)' width='100' height='100'/>
    <rect fill='url(#gy)' width='100' height='100' style='mix-blend-mode:screen'/>
  </svg>\`;

  // Test 4: Use lighten blend (takes max of each channel)
  const svg4 = \`<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'>
    <defs>
      <linearGradient id='gx' x2='1'>
        <stop offset='0' stop-color='#ff8080'/>
        <stop offset='0.5' stop-color='#808080'/>
        <stop offset='1' stop-color='#008080'/>
      </linearGradient>
      <linearGradient id='gy' y2='1'>
        <stop offset='0' stop-color='#80ff80'/>
        <stop offset='0.5' stop-color='#808080'/>
        <stop offset='1' stop-color='#800080'/>
      </linearGradient>
    </defs>
    <rect fill='#808080' width='100' height='100'/>
    <rect fill='url(#gx)' width='100' height='100' style='mix-blend-mode:lighten'/>
    <rect fill='url(#gy)' width='100' height='100' style='mix-blend-mode:lighten'/>
  </svg>\`;

  // Test 5: Direct pre-combined colors at key positions
  const svg5 = \`<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'>
    <defs>
      <!-- Top-left: R=255 (from left), G=255 (from top) -->
      <!-- Top-right: R=0 (from right), G=255 (from top) -->
      <!-- Bottom-left: R=255 (from left), G=0 (from bottom) -->
      <!-- Bottom-right: R=0 (from right), G=0 (from bottom) -->
      <linearGradient id='top' x2='1'>
        <stop offset='0' stop-color='#ffff00'/>
        <stop offset='0.5' stop-color='#80ff00'/>
        <stop offset='1' stop-color='#00ff00'/>
      </linearGradient>
      <linearGradient id='bottom' x2='1'>
        <stop offset='0' stop-color='#ff0000'/>
        <stop offset='0.5' stop-color='#800000'/>
        <stop offset='1' stop-color='#000000'/>
      </linearGradient>
      <linearGradient id='vertical' y2='1'>
        <stop offset='0' stop-color='url(#top)'/>
        <stop offset='0.5' stop-color='#808000'/>
        <stop offset='1' stop-color='url(#bottom)'/>
      </linearGradient>
    </defs>
    <rect fill='url(#vertical)' width='100' height='100'/>
  </svg>\`;

  async function renderSVG(svg, name) {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, 100, 100).data;

        // Sample key positions
        const samples = {
          topLeft: [data[0], data[1], data[2]],
          topCenter: [data[(50) * 4], data[(50) * 4 + 1], data[(50) * 4 + 2]],
          topRight: [data[(99) * 4], data[(99) * 4 + 1], data[(99) * 4 + 2]],
          centerLeft: [data[(50 * 100) * 4], data[(50 * 100) * 4 + 1], data[(50 * 100) * 4 + 2]],
          center: [data[(50 * 100 + 50) * 4], data[(50 * 100 + 50) * 4 + 1], data[(50 * 100 + 50) * 4 + 2]],
          centerRight: [data[(50 * 100 + 99) * 4], data[(50 * 100 + 99) * 4 + 1], data[(50 * 100 + 99) * 4 + 2]],
          bottomLeft: [data[(99 * 100) * 4], data[(99 * 100) * 4 + 1], data[(99 * 100) * 4 + 2]],
          bottomCenter: [data[(99 * 100 + 50) * 4], data[(99 * 100 + 50) * 4 + 1], data[(99 * 100 + 50) * 4 + 2]],
          bottomRight: [data[(99 * 100 + 99) * 4], data[(99 * 100 + 99) * 4 + 1], data[(99 * 100 + 99) * 4 + 2]],
        };

        resolve({ name, samples, dataUrl: canvas.toDataURL() });
      };
      img.onerror = () => resolve({ name, error: 'Failed to load SVG' });
      img.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
    });
  }

  results.push(await renderSVG(svg1, 'X-gradient'));
  results.push(await renderSVG(svg2, 'Y-gradient'));
  results.push(await renderSVG(svg3, 'Screen-blend'));
  results.push(await renderSVG(svg4, 'Lighten-blend'));
  results.push(await renderSVG(svg5, 'Nested-gradients'));

  return results;
}

test().then(results => {
  window.testResults = results;

  let html = '<table border="1"><tr><th>Test</th><th>Image</th><th>Samples (R,G,B)</th></tr>';
  for (const r of results) {
    html += '<tr>';
    html += '<td>' + r.name + '</td>';
    html += '<td><img src="' + r.dataUrl + '" width="100" height="100"/></td>';
    html += '<td><pre>' + JSON.stringify(r.samples, null, 2) + '</pre></td>';
    html += '</tr>';
  }
  html += '</table>';
  document.getElementById('results').innerHTML = html;
});
</script>
</body>
</html>`;

  await page.setContent(testHtml);
  await new Promise(r => setTimeout(r, 2000));

  // Get the test results
  const results = await page.evaluate(() => window.testResults);

  console.log('SVG Gradient Rendering Test Results:');
  console.log('=====================================\n');

  for (const r of results) {
    console.log(`Test: ${r.name}`);
    if (r.error) {
      console.log(`  Error: ${r.error}`);
    } else {
      console.log('  Key positions (R, G, B):');
      console.log(`    Top-Left:     [${r.samples.topLeft.join(', ')}]`);
      console.log(`    Top-Center:   [${r.samples.topCenter.join(', ')}]`);
      console.log(`    Top-Right:    [${r.samples.topRight.join(', ')}]`);
      console.log(`    Center-Left:  [${r.samples.centerLeft.join(', ')}]`);
      console.log(`    Center:       [${r.samples.center.join(', ')}]`);
      console.log(`    Center-Right: [${r.samples.centerRight.join(', ')}]`);
      console.log(`    Bottom-Left:  [${r.samples.bottomLeft.join(', ')}]`);
      console.log(`    Bottom-Center:[${r.samples.bottomCenter.join(', ')}]`);
      console.log(`    Bottom-Right: [${r.samples.bottomRight.join(', ')}]`);
    }
    console.log();
  }

  // Save screenshot
  const shot = await page.screenshot({ type: 'png' });
  writeFileSync(join(OUTPUT_DIR, 'svg-gradient-test.png'), shot);

  await browser.close();
  await server.close();

  console.log('What we need for displacement map:');
  console.log('  Top-Left:     [255, 255, x] (push right and down)');
  console.log('  Top-Right:    [0, 255, x]   (push left and down)');
  console.log('  Bottom-Left:  [255, 0, x]   (push right and up)');
  console.log('  Bottom-Right: [0, 0, x]     (push left and up)');
  console.log('  Center:       [128, 128, x] (neutral)');
}

main().catch(console.error);

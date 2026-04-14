const puppeteer = require('puppeteer');
const fs = require('fs');
const PNG = require('pngjs').PNG;

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Generate our displacement map via browser
  const testHtml = `
    <!DOCTYPE html>
    <html>
    <body>
    <canvas id="output"></canvas>
    <script type="module">
      import { generateDisplacementMap } from '/src/core/displacement/generator.ts';
      const result = generateDisplacementMap({
        width: 420,
        height: 300,
        profile: 'squircle',
        refractiveIndex: 1.5,
        thickness: 1.0,
        refractionLevel: 0.8,
        borderRadius: 60
      });
      document.getElementById('output').replaceWith(result.canvas);
      window.mapDataUrl = result.dataUrl;
    </script>
    </body>
    </html>
  `;

  fs.writeFileSync('demo/gen-disp-test.html', testHtml);

  await page.goto('http://localhost:8788/demo/gen-disp-test.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 2000));

  // Get the data URL
  const dataUrl = await page.evaluate(() => window.mapDataUrl);

  if (dataUrl) {
    // Convert data URL to PNG
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync('e2e/debug/our-displacement-map.png', buffer);
    console.log('Saved our displacement map to e2e/debug/our-displacement-map.png');

    // Compare with kube
    const ourImg = PNG.sync.read(buffer);
    const kubeImg = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));

    console.log(`\nOur map: ${ourImg.width}x${ourImg.height}`);
    console.log(`Kube map: ${kubeImg.width}x${kubeImg.height}`);

    // Both maps now 420x300
    console.log('\nComparison at key points (same resolution):');
    const ourPoints = [
      { name: 'center', x: 210, y: 150 },
      { name: 'top edge', x: 210, y: 5 },
      { name: 'bottom edge', x: 210, y: 295 },
      { name: 'left edge', x: 65, y: 150 },
      { name: 'right edge', x: 355, y: 150 },
      { name: '90% top', x: 210, y: 15 },
      { name: '90% bottom', x: 210, y: 285 },
    ];
    const kubePoints = ourPoints;  // Same coordinates

    for (let i = 0; i < ourPoints.length; i++) {
      const ourPt = ourPoints[i];
      const kubePt = kubePoints[i];
      const ourIdx = (ourPt.y * ourImg.width + ourPt.x) * 4;
      const kubeIdx = (kubePt.y * kubeImg.width + kubePt.x) * 4;

      console.log(`${ourPt.name}: Our R=${ourImg.data[ourIdx]} G=${ourImg.data[ourIdx+1]} | Kube R=${kubeImg.data[kubeIdx]} G=${kubeImg.data[kubeIdx+1]}`);
    }
  }

  await browser.close();
}

main().catch(console.error);

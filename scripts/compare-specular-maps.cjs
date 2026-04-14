const puppeteer = require('puppeteer');
const fs = require('fs');
const PNG = require('pngjs').PNG;

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const testHtml = `
    <!DOCTYPE html>
    <html>
    <body>
    <canvas id="output"></canvas>
    <script type="module">
      import { generateSpecularMap } from '/src/core/specular/highlight.ts';
      const result = generateSpecularMap({
        width: 420,
        height: 300,
        profile: 'squircle',
        lightDirection: { x: 0.6, y: -0.8 },
        intensity: 0.5,
        saturation: 0,
        borderRadius: 60
      });
      document.getElementById('output').replaceWith(result.canvas);
      window.mapDataUrl = result.dataUrl;
    </script>
    </body>
    </html>
  `;

  fs.writeFileSync('demo/gen-spec-test.html', testHtml);

  await page.goto('http://localhost:8788/demo/gen-spec-test.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 2000));

  const dataUrl = await page.evaluate(() => window.mapDataUrl);

  if (dataUrl) {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync('e2e/debug/our-specular-map.png', buffer);
    console.log('Saved our specular map to e2e/debug/our-specular-map.png');

    const ourImg = PNG.sync.read(buffer);
    const kubeImg = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/specular-map-w2qrsb.png'));

    console.log(`\nOur map: ${ourImg.width}x${ourImg.height}`);
    console.log(`Kube map: ${kubeImg.width}x${kubeImg.height}`);

    // Analyze radial alpha profile for both
    const centerX = 105, centerY = 75, maxRadius = 75;

    console.log('\nAlpha profile comparison (our 210x150 vs kube 420x300):');
    console.log('location\tourA\tkubeA');

    // Both 420x300 now
    const samples = [
      { name: 'center', ourX: 210, ourY: 150, kubeX: 210, kubeY: 150 },
      { name: 'top edge', ourX: 210, ourY: 5, kubeX: 210, kubeY: 5 },
      { name: 'bottom edge', ourX: 210, ourY: 295, kubeX: 210, kubeY: 295 },
      { name: 'left edge', ourX: 60, ourY: 150, kubeX: 60, kubeY: 150 },
      { name: 'right edge', ourX: 360, ourY: 150, kubeX: 360, kubeY: 150 },
      { name: '95% top', ourX: 210, ourY: 8, kubeX: 210, kubeY: 8 },
      { name: '95% bottom', ourX: 210, ourY: 292, kubeX: 210, kubeY: 292 },
    ];

    for (const s of samples) {
      const ourIdx = (s.ourY * ourImg.width + s.ourX) * 4;
      const kubeIdx = (s.kubeY * kubeImg.width + s.kubeX) * 4;
      console.log(`${s.name}\t${ourImg.data[ourIdx + 3]}\t${kubeImg.data[kubeIdx + 3]}`);
    }

    // Count non-zero alpha pixels
    let ourNonZero = 0, kubeNonZero = 0;
    for (let i = 3; i < ourImg.data.length; i += 4) if (ourImg.data[i] > 0) ourNonZero++;
    for (let i = 3; i < kubeImg.data.length; i += 4) if (kubeImg.data[i] > 0) kubeNonZero++;
    console.log(`\nNon-zero alpha pixels: Our=${ourNonZero}, Kube=${kubeNonZero}`);
  }

  await browser.close();
}

main().catch(console.error);

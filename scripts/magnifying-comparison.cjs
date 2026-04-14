const puppeteer = require('puppeteer');
const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatch = require('pixelmatch');

async function captureKubeMagnifyingGlass(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1200 });

  console.log('Navigating to kube.io...');
  await page.goto('https://kube.io/blog/liquid-glass-css-svg/', {
    waitUntil: 'networkidle0',
    timeout: 60000
  });

  await new Promise(r => setTimeout(r, 2000));

  // Find and scroll to magnifying glass section
  const magnifyingSection = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h2, h3'));
    const heading = headings.find(h => h.textContent.toLowerCase().includes('magnifying'));
    if (heading) {
      heading.scrollIntoView({ behavior: 'instant', block: 'start' });
      return true;
    }
    return false;
  });

  if (!magnifyingSection) {
    console.log('Could not find magnifying glass section');
  }

  await new Promise(r => setTimeout(r, 1000));

  // Capture the visible area
  await page.screenshot({
    path: 'e2e/debug/kube-magnifying-section.png',
    clip: { x: 0, y: 0, width: 1400, height: 800 }
  });

  // Try to find the actual magnifying glass element
  const glassElement = await page.$('[style*="backdrop-filter"][style*="magnifying"]');
  if (glassElement) {
    const box = await glassElement.boundingBox();
    if (box) {
      await page.screenshot({
        path: 'e2e/debug/kube-magnifying-element.png',
        clip: { x: box.x, y: box.y, width: box.width, height: box.height }
      });
      console.log('Captured magnifying element:', box);
    }
  }

  // Get the magnifying glass filter parameters
  const filterParams = await page.evaluate(() => {
    const filter = document.getElementById('magnifying-glass-filter');
    if (filter) {
      const feDisplacementMaps = filter.querySelectorAll('feDisplacementMap');
      return Array.from(feDisplacementMaps).map(d => ({
        scale: d.getAttribute('scale'),
        in: d.getAttribute('in'),
        in2: d.getAttribute('in2')
      }));
    }
    return null;
  });

  console.log('Magnifying glass filter params:', filterParams);

  await page.close();
}

async function createOurMagnifyingGlass(browser, port) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1200 });

  // Create a test page with similar setup to kube.io's magnifying glass
  const testHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          margin: 0;
          padding: 40px;
          background: linear-gradient(135deg, #f5f5f5 0%, #e0e0e0 100%);
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .demo-container {
          position: relative;
          width: 210px;
          height: 150px;
        }
        .background-image {
          width: 210px;
          height: 150px;
          object-fit: cover;
        }
        liquid-glass {
          position: absolute;
          top: 0;
          left: 0;
          width: 210px;
          height: 150px;
          display: block;
        }
      </style>
    </head>
    <body>
      <h2>Our Implementation</h2>
      <div class="demo-container">
        <img class="background-image" src="https://images.unsplash.com/photo-1540573133985-87b6da6d54a9?w=210&h=150&fit=crop" alt="frog">
        <liquid-glass
          profile="squircle"
          refractive-index="1.5"
          refraction-level="0.7"
          specular-opacity="0.5"
          background-opacity="0"
          border-radius="30"
        ></liquid-glass>
      </div>
      <script type="module">
        import { registerLiquidGlassElement } from '/src/index.ts';
        registerLiquidGlassElement();
      </script>
    </body>
    </html>
  `;

  // Save test page
  fs.writeFileSync('demo/magnifying-test.html', testHtml);

  await page.goto(`http://localhost:${port}/demo/magnifying-test.html`, {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 2000));

  await page.screenshot({
    path: 'e2e/debug/our-magnifying.png',
    clip: { x: 40, y: 80, width: 210, height: 150 }
  });

  console.log('Captured our magnifying glass implementation');
  await page.close();
}

function compareImages(img1Path, img2Path, diffPath) {
  const img1 = PNG.sync.read(fs.readFileSync(img1Path));
  const img2 = PNG.sync.read(fs.readFileSync(img2Path));

  // Resize to match if needed
  const width = Math.min(img1.width, img2.width);
  const height = Math.min(img1.height, img2.height);

  const diff = new PNG({ width, height });

  const numDiffPixels = pixelmatch(
    img1.data, img2.data, diff.data,
    width, height,
    { threshold: 0.1 }
  );

  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  const totalPixels = width * height;
  const matchPercentage = ((totalPixels - numDiffPixels) / totalPixels * 100).toFixed(2);

  return {
    diffPixels: numDiffPixels,
    totalPixels,
    matchPercentage
  };
}

async function main() {
  const port = process.argv[2] || '8788';

  const browser = await puppeteer.launch({ headless: true });

  try {
    await captureKubeMagnifyingGlass(browser);
    await createOurMagnifyingGlass(browser, port);

    // Compare if both images exist
    const kubeImg = 'e2e/debug/kube-magnifying-section.png';
    const ourImg = 'e2e/debug/our-magnifying.png';

    if (fs.existsSync(kubeImg) && fs.existsSync(ourImg)) {
      console.log('\nNote: Direct comparison not possible due to different content.');
      console.log('Manual inspection required to assess similarity of glass effect.');
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

main();

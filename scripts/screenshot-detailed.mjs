import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });

await page.goto('http://localhost:8789/demo/parameter-lab.html', {
  waitUntil: 'networkidle0',
  timeout: 30000
});

// Wait for liquid-glass elements to render
await page.waitForSelector('liquid-glass', { timeout: 10000 });
await new Promise(r => setTimeout(r, 3000));

// Full page screenshot
await page.screenshot({
  path: '/tmp/liquidglass-full.png',
  fullPage: false
});

// Get the main liquid-glass element and take a close-up
const element = await page.$('#element-1 liquid-glass');
if (element) {
  const box = await element.boundingBox();
  if (box) {
    // Take a screenshot of just the element area with padding
    await page.screenshot({
      path: '/tmp/liquidglass-element.png',
      clip: {
        x: Math.max(0, box.x - 50),
        y: Math.max(0, box.y - 50),
        width: box.width + 100,
        height: box.height + 100
      }
    });
  }
}

// Also extract the displacement map data URL if possible
const displacementData = await page.evaluate(() => {
  const glass = document.querySelector('liquid-glass');
  if (glass && glass.shadowRoot) {
    const svg = glass.shadowRoot.querySelector('svg');
    if (svg) {
      return svg.outerHTML.substring(0, 2000); // First 2000 chars
    }
    // Try to find the filter
    const style = glass.shadowRoot.querySelector('style');
    if (style) {
      return style.textContent.substring(0, 2000);
    }
  }
  return null;
});

console.log('Displacement filter info:', displacementData);
console.log('Screenshots saved');

await browser.close();

const puppeteer = require('puppeteer');
const fs = require('fs');
const { PNG } = require('pngjs');

async function captureKubeDemo() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  console.log('Navigating to kube.io...');
  await page.goto('https://kube.io/blog/liquid-glass-css-svg/', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  // Wait for demo to load
  await new Promise(r => setTimeout(r, 2000));

  // Scroll to magnifying glass section
  await page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll('h2, h3')).find(
      el => el.textContent.toLowerCase().includes('magnifying')
    );
    if (heading) {
      heading.scrollIntoView({ behavior: 'instant', block: 'center' });
    }
  });

  await new Promise(r => setTimeout(r, 1000));

  // Take full page screenshot
  await page.screenshot({
    path: 'e2e/debug/kube-full-page.png',
    fullPage: false
  });

  // Try to find and capture just the magnifying glass demo area
  const demoElement = await page.$('[class*="magnif"], [class*="glass"], [class*="demo"]');
  if (demoElement) {
    await demoElement.screenshot({ path: 'e2e/debug/kube-magnifying-glass.png' });
    console.log('Captured magnifying glass element');
  }

  // Also extract any SVG filters from the page
  const svgFilters = await page.evaluate(() => {
    const svgs = document.querySelectorAll('svg');
    const filters = [];
    svgs.forEach(svg => {
      const filterEls = svg.querySelectorAll('filter');
      filterEls.forEach(f => {
        filters.push({
          id: f.id,
          innerHTML: f.innerHTML,
          outerHTML: f.outerHTML
        });
      });
    });
    return filters;
  });

  console.log('Found SVG filters:', svgFilters.length);
  fs.writeFileSync('e2e/debug/kube-filters.json', JSON.stringify(svgFilters, null, 2));

  // Extract any data URLs for displacement maps
  const dataUrls = await page.evaluate(() => {
    const images = document.querySelectorAll('feImage');
    return Array.from(images).map(img => ({
      href: img.getAttribute('href') || img.getAttribute('xlink:href'),
      width: img.getAttribute('width'),
      height: img.getAttribute('height')
    })).filter(x => x.href && x.href.startsWith('data:'));
  });

  console.log('Found data URLs:', dataUrls.length);
  fs.writeFileSync('e2e/debug/kube-dataurls.json', JSON.stringify(dataUrls, null, 2));

  // Get computed styles of glass elements
  const glassStyles = await page.evaluate(() => {
    const elements = document.querySelectorAll('[style*="backdrop-filter"], [style*="filter"]');
    return Array.from(elements).slice(0, 10).map(el => ({
      tagName: el.tagName,
      className: el.className,
      backdropFilter: getComputedStyle(el).backdropFilter,
      filter: getComputedStyle(el).filter,
      width: el.offsetWidth,
      height: el.offsetHeight
    }));
  });

  console.log('Glass elements found:', glassStyles.length);
  fs.writeFileSync('e2e/debug/kube-glass-styles.json', JSON.stringify(glassStyles, null, 2));

  await browser.close();
  console.log('Done capturing kube.io');
}

captureKubeDemo().catch(console.error);

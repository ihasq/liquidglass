/**
 * CDP: Get displacement map SVG filter data from both pages
 */

import puppeteer from 'puppeteer';

async function getDisplacementMap(url, name) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });

  console.log(`\n=== ${name} ===`);
  console.log(`URL: ${url}`);

  await page.goto(url, { waitUntil: 'networkidle0' });

  // Wait a bit for liquid glass to initialize
  await new Promise(r => setTimeout(r, 1000));

  const data = await page.evaluate(() => {
    // Get all SVG filters
    const svgFilters = document.querySelectorAll('svg filter');
    const filters = [];

    for (const filter of svgFilters) {
      const filterData = {
        id: filter.id,
        innerHTML: filter.innerHTML,
        // Get feDisplacementMap specifically
        displacementMaps: [],
        feImages: [],
      };

      const feDisplacementMaps = filter.querySelectorAll('feDisplacementMap');
      for (const dm of feDisplacementMaps) {
        filterData.displacementMaps.push({
          scale: dm.getAttribute('scale'),
          xChannelSelector: dm.getAttribute('xChannelSelector'),
          yChannelSelector: dm.getAttribute('yChannelSelector'),
          in: dm.getAttribute('in'),
          in2: dm.getAttribute('in2'),
        });
      }

      const feImages = filter.querySelectorAll('feImage');
      for (const img of feImages) {
        const href = img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        filterData.feImages.push({
          href: href ? href.substring(0, 200) + (href.length > 200 ? '...' : '') : null,
          result: img.getAttribute('result'),
        });
      }

      filters.push(filterData);
    }

    // Also get elements with liquid glass styles
    const liquidGlassElements = document.querySelectorAll('[style*="--liquidglass"]');
    const elements = [];
    for (const el of liquidGlassElements) {
      const computed = getComputedStyle(el);
      elements.push({
        tagName: el.tagName,
        filter: computed.filter,
        style: el.getAttribute('style')?.substring(0, 300),
      });
    }

    return { filters, elements };
  });

  console.log(`\nFilters found: ${data.filters.length}`);
  for (const filter of data.filters) {
    console.log(`\nFilter ID: ${filter.id}`);
    console.log('Displacement Maps:');
    for (const dm of filter.displacementMaps) {
      console.log(`  scale: ${dm.scale}`);
      console.log(`  xChannelSelector: ${dm.xChannelSelector}`);
      console.log(`  yChannelSelector: ${dm.yChannelSelector}`);
    }
    console.log('feImages:');
    for (const img of filter.feImages) {
      console.log(`  result: ${img.result}`);
      console.log(`  href: ${img.href}`);
    }
  }

  console.log(`\nLiquid Glass Elements: ${data.elements.length}`);
  for (const el of data.elements) {
    console.log(`  ${el.tagName}: filter="${el.filter}"`);
  }

  await browser.close();
  return data;
}

async function main() {
  try {
    // Get from demo page
    const demoData = await getDisplacementMap('http://localhost:8787/demo/parameter-lab.html', 'Demo Parameter Lab');

    // Get from site
    const siteData = await getDisplacementMap('http://localhost:5176', 'Site Preview');

    // Output raw JSON for comparison
    console.log('\n\n=== RAW JSON DATA ===\n');
    console.log('--- Demo ---');
    console.log(JSON.stringify(demoData, null, 2));
    console.log('\n--- Site ---');
    console.log(JSON.stringify(siteData, null, 2));

  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();

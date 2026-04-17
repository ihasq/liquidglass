/**
 * CDP Debug Script - Compare displacement maps by hash
 */

import puppeteer from 'puppeteer';
import crypto from 'crypto';

async function main() {
  console.log('Launching browser...');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  console.log('Navigating to parameter-lab.html...');
  await page.goto('http://localhost:8788/demo/parameter-lab.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 2000));

  console.log('\n=== TEST: Compare full displacement map URLs by hash ===\n');

  const test = await page.evaluate(async () => {
    const glass = document.querySelector('#element-1 .glass-panel');
    const getDispUrl = () => document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href');

    // Simple hash function for comparison
    const simpleHash = (str) => {
      if (!str) return 'null';
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return hash.toString(16);
    };

    const results = [];

    // Initial state
    const initial = getDispUrl();
    results.push({
      step: 'Initial',
      hash: simpleHash(initial),
      urlLength: initial?.length,
      radius: getComputedStyle(glass).borderRadius
    });

    // Change border-radius
    glass.style.borderRadius = '80px';
    await new Promise(r => setTimeout(r, 100));

    const after100 = getDispUrl();
    results.push({
      step: 'After 100ms (radius 80px)',
      hash: simpleHash(after100),
      urlLength: after100?.length,
      radius: getComputedStyle(glass).borderRadius,
      changed: simpleHash(initial) !== simpleHash(after100)
    });

    // Wait for high-res render
    await new Promise(r => setTimeout(r, 500));

    const after600 = getDispUrl();
    results.push({
      step: 'After 600ms (high-res)',
      hash: simpleHash(after600),
      urlLength: after600?.length,
      radius: getComputedStyle(glass).borderRadius,
      changed: simpleHash(initial) !== simpleHash(after600)
    });

    // Change border-radius again
    glass.style.borderRadius = '10px';
    await new Promise(r => setTimeout(r, 500));

    const afterSecond = getDispUrl();
    results.push({
      step: 'After second change (radius 10px)',
      hash: simpleHash(afterSecond),
      urlLength: afterSecond?.length,
      radius: getComputedStyle(glass).borderRadius,
      changed: simpleHash(after600) !== simpleHash(afterSecond)
    });

    // Change size (should definitely trigger re-render)
    glass.style.width = '400px';
    await new Promise(r => setTimeout(r, 500));

    const afterSize = getDispUrl();
    results.push({
      step: 'After size change (400px width)',
      hash: simpleHash(afterSize),
      urlLength: afterSize?.length,
      radius: getComputedStyle(glass).borderRadius,
      changed: simpleHash(afterSecond) !== simpleHash(afterSize)
    });

    return results;
  });

  console.log('Results:');
  for (const r of test) {
    console.log(`${r.step}:`);
    console.log(`  Hash: ${r.hash}`);
    console.log(`  URL Length: ${r.urlLength}`);
    console.log(`  Radius: ${r.radius}`);
    if (r.changed !== undefined) {
      console.log(`  Changed: ${r.changed}`);
    }
    console.log('');
  }

  // Additional test: Check if border-radius is passed to displacement map generator
  console.log('\n=== TEST 2: Check if border-radius reaches displacement map ===\n');

  const test2 = await page.evaluate(async () => {
    const glass = document.querySelector('#element-1 .glass-panel');

    // Set a very distinctive border-radius
    glass.style.borderRadius = '100px';

    // Wait for render
    await new Promise(r => setTimeout(r, 1000));

    // Get the displacement map data URL
    const dispUrl = document.querySelector('svg[aria-hidden="true"] defs filter feImage[result="dImgNew"]')?.getAttribute('href');

    // Decode and check size
    if (!dispUrl) return { error: 'No displacement URL' };

    // Extract base64 data
    const base64Data = dispUrl.split(',')[1];
    if (!base64Data) return { error: 'Invalid data URL' };

    // Decode to binary
    const binary = atob(base64Data);

    // PNG IHDR chunk is at bytes 8-32
    // Width is at bytes 16-19 (big endian)
    // Height is at bytes 20-23 (big endian)
    const width = (binary.charCodeAt(16) << 24) | (binary.charCodeAt(17) << 16) | (binary.charCodeAt(18) << 8) | binary.charCodeAt(19);
    const height = (binary.charCodeAt(20) << 24) | (binary.charCodeAt(21) << 16) | (binary.charCodeAt(22) << 8) | binary.charCodeAt(23);

    return {
      pngWidth: width,
      pngHeight: height,
      elementWidth: glass.offsetWidth,
      elementHeight: glass.offsetHeight,
      borderRadius: getComputedStyle(glass).borderRadius,
      urlLength: dispUrl.length
    };
  });

  console.log('Test 2 results:', test2);

  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);

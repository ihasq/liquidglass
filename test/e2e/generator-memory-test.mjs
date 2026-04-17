#!/usr/bin/env node
/**
 * Isolated Generator Memory Test
 *
 * Tests displacement map generation in isolation from the demo app
 * to identify if memory leaks are in generators or elsewhere.
 */

import puppeteer from 'puppeteer';

const ITERATIONS = 100;

async function run() {
  console.log('Testing displacement generator memory in isolation...\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--enable-precise-memory-info',
      '--js-flags=--expose-gc',
      '--enable-unsafe-webgpu',
    ],
  });

  const page = await browser.newPage();
  const cdp = await page.target().createCDPSession();

  // Navigate to test page served by dev server
  await page.goto('http://localhost:8787/test/e2e/generator-test.html', {
    waitUntil: 'networkidle0',
    timeout: 30000,
  });

  // Wait for module to load
  await page.waitForFunction(() => window.ready === true, { timeout: 10000 });
  console.log('Library loaded');

  // Force GC and get initial heap
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.disable');
  await new Promise(r => setTimeout(r, 500));

  const initialHeap = await page.evaluate(() => performance.memory?.usedJSHeapSize || 0);
  console.log(`Initial heap: ${(initialHeap / 1024 / 1024).toFixed(2)} MB`);

  // Run generator test
  console.log(`\nRunning ${ITERATIONS} resize iterations...\n`);

  const results = await page.evaluate(async (iters) => {
    return await window.runGeneratorTest(iters);
  }, ITERATIONS);

  // Print results
  for (const r of results) {
    console.log(`  Iteration ${r.iteration.toString().padStart(3)}: ${(r.heap / 1024 / 1024).toFixed(2)} MB`);
  }

  // Force GC and get final heap
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.disable');
  await new Promise(r => setTimeout(r, 500));

  const finalHeap = await page.evaluate(() => performance.memory?.usedJSHeapSize || 0);

  console.log(`\nFinal heap (after GC): ${(finalHeap / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Growth: ${((finalHeap - initialHeap) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Per iteration: ${((finalHeap - initialHeap) / 1024 / ITERATIONS).toFixed(2)} KB`);

  await browser.close();
}

run().catch(console.error);

#!/usr/bin/env node
/**
 * Run shader benchmark and collect results
 */

import puppeteer from 'puppeteer';

async function run() {
  console.log('Running shader composite approach benchmark...\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
    ],
  });

  const page = await browser.newPage();

  // Collect console logs
  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    console.log(text);
  });

  await page.goto('http://localhost:8787/test/e2e/shader-benchmark.html', {
    waitUntil: 'networkidle0',
    timeout: 60000,
  });

  // Wait for benchmark to complete
  await page.waitForFunction(
    () => document.body.textContent.includes('Benchmark complete!'),
    { timeout: 120000 }
  );

  // Give some extra time for final logs
  await new Promise(r => setTimeout(r, 1000));

  await browser.close();

  console.log('\nBenchmark finished.');
}

run().catch(console.error);

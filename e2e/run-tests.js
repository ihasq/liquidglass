/**
 * E2E Test runner using Puppeteer (CDP over WebSocket)
 * Takes screenshots and compares with reference images
 */

import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, 'snapshots');
const RESULTS_DIR = join(__dirname, 'results');
const UPDATE_SNAPSHOTS = process.argv.includes('--update-snapshots');

// Ensure directories exist
if (!existsSync(SNAPSHOTS_DIR)) mkdirSync(SNAPSHOTS_DIR, { recursive: true });
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

/**
 * Calculate pixel difference between two images
 */
function calculateDifference(buffer1, buffer2) {
  if (buffer1.length !== buffer2.length) {
    return { diffPercent: 100, diffPixels: Math.max(buffer1.length, buffer2.length) / 4 };
  }

  let diffPixels = 0;
  const totalPixels = buffer1.length / 4;

  for (let i = 0; i < buffer1.length; i += 4) {
    const rDiff = Math.abs(buffer1[i] - buffer2[i]);
    const gDiff = Math.abs(buffer1[i + 1] - buffer2[i + 1]);
    const bDiff = Math.abs(buffer1[i + 2] - buffer2[i + 2]);

    // Consider pixel different if any channel differs by more than threshold
    if (rDiff > 10 || gDiff > 10 || bDiff > 10) {
      diffPixels++;
    }
  }

  return {
    diffPercent: (diffPixels / totalPixels) * 100,
    diffPixels
  };
}

/**
 * Take screenshot of an element
 */
async function screenshotElement(page, selector, name) {
  const element = await page.$(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  const screenshot = await element.screenshot({ type: 'png' });
  return screenshot;
}

/**
 * Run a single test
 */
async function runTest(page, testCase) {
  const { name, selector, description } = testCase;
  const snapshotPath = join(SNAPSHOTS_DIR, `${name}.png`);
  const resultPath = join(RESULTS_DIR, `${name}.png`);

  console.log(`  Testing: ${name} - ${description}`);

  // Take screenshot
  const screenshot = await screenshotElement(page, selector, name);

  // Save result
  writeFileSync(resultPath, screenshot);

  // Compare or update
  if (UPDATE_SNAPSHOTS || !existsSync(snapshotPath)) {
    writeFileSync(snapshotPath, screenshot);
    console.log(`    ✓ Snapshot ${UPDATE_SNAPSHOTS ? 'updated' : 'created'}`);
    return { name, status: 'created', diffPercent: 0 };
  }

  // Compare with existing snapshot
  const existingSnapshot = readFileSync(snapshotPath);

  // Simple size comparison first
  if (screenshot.length !== existingSnapshot.length) {
    console.log(`    ✗ Size mismatch (${screenshot.length} vs ${existingSnapshot.length})`);
    return { name, status: 'failed', diffPercent: 100, reason: 'size mismatch' };
  }

  // Byte-by-byte comparison
  let diffBytes = 0;
  for (let i = 0; i < screenshot.length; i++) {
    if (screenshot[i] !== existingSnapshot[i]) diffBytes++;
  }

  const diffPercent = (diffBytes / screenshot.length) * 100;

  if (diffPercent < 1) {
    console.log(`    ✓ Passed (${diffPercent.toFixed(2)}% diff)`);
    return { name, status: 'passed', diffPercent };
  } else {
    console.log(`    ✗ Failed (${diffPercent.toFixed(2)}% diff)`);
    return { name, status: 'failed', diffPercent };
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('Starting Liquid Glass E2E Tests\n');

  // Start Vite dev server
  console.log('Starting dev server...');
  const server = await createServer({
    root: join(__dirname, '..'),
    server: { port: 3333 }
  });
  await server.listen();
  const serverUrl = 'http://localhost:3333';
  console.log(`Server running at ${serverUrl}\n`);

  // Launch browser
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--font-render-hinting=none'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });

  // Navigate to demo page
  console.log('Loading demo page...');
  await page.goto(serverUrl, { waitUntil: 'networkidle0' });

  // Wait for effects to render
  await page.waitForSelector('#panel-squircle');
  await new Promise(r => setTimeout(r, 1000)); // Extra wait for canvas generation

  // Define test cases
  const testCases = [
    {
      name: 'panel-squircle',
      selector: '#panel-squircle',
      description: 'Squircle profile glass panel'
    },
    {
      name: 'panel-circle',
      selector: '#panel-circle',
      description: 'Circular profile glass panel'
    },
    {
      name: 'panel-lip',
      selector: '#panel-lip',
      description: 'Lip profile glass panel'
    },
    {
      name: 'full-page',
      selector: 'body',
      description: 'Full page screenshot'
    }
  ];

  // Run tests
  console.log('\nRunning tests...\n');
  const results = [];

  for (const testCase of testCases) {
    try {
      const result = await runTest(page, testCase);
      results.push(result);
    } catch (error) {
      console.log(`    ✗ Error: ${error.message}`);
      results.push({ name: testCase.name, status: 'error', error: error.message });
    }
  }

  // Cleanup
  await browser.close();
  await server.close();

  // Summary
  console.log('\n--- Test Summary ---');
  const passed = results.filter(r => r.status === 'passed' || r.status === 'created').length;
  const failed = results.filter(r => r.status === 'failed' || r.status === 'error').length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  // Write results JSON
  writeFileSync(join(RESULTS_DIR, 'results.json'), JSON.stringify(results, null, 2));

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => r.status === 'failed' || r.status === 'error').forEach(r => {
      console.log(`  - ${r.name}: ${r.reason || r.error || `${r.diffPercent?.toFixed(2)}% diff`}`);
    });
    process.exit(1);
  }

  console.log('\nAll tests passed!');
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * E2E Test Runner
 *
 * Launches Vite dev server, opens test page in headless browser,
 * and collects test results from console logs via CDP.
 *
 * The test page runs all tests automatically using browser JS.
 * This runner just collects and reports results.
 *
 * Usage:
 *   npm run test:e2e           # Run E2E tests
 *   npm run test:e2e -- --headed  # Run with visible browser
 */

import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// ============================================================================
// Configuration
// ============================================================================

const args = process.argv.slice(2);
const HEADED = args.includes('--headed');
const VERBOSE = args.includes('--verbose') || args.includes('-v');
const TIMEOUT = 60000; // 60 seconds max test duration

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

// ============================================================================
// Log Parsing
// ============================================================================

class TestCollector {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      suites: [],
      logs: [],
    };
    this.currentSuite = null;
    this.summary = null;
    this.complete = false;
  }

  processLog(text) {
    this.results.logs.push(text);

    if (text.startsWith('[SUITE]')) {
      const name = text.replace('[SUITE] ', '');
      this.currentSuite = { name, tests: [] };
      this.results.suites.push(this.currentSuite);

      if (VERBOSE) {
        console.log(`${colors.cyan}${colors.bold}  ${name}${colors.reset}`);
      }
    } else if (text.startsWith('[PASS]')) {
      const match = text.match(/\[PASS\] (.+) > (.+) \((.+)ms\)/);
      if (match && this.currentSuite) {
        this.currentSuite.tests.push({
          name: match[2],
          passed: true,
          duration: parseFloat(match[3]),
        });
        this.results.passed++;

        if (VERBOSE) {
          console.log(`    ${colors.green}✓${colors.reset} ${match[2]} ${colors.dim}(${match[3]}ms)${colors.reset}`);
        }
      }
    } else if (text.startsWith('[FAIL]')) {
      const match = text.match(/\[FAIL\] (.+) > (.+): (.+)/);
      if (match && this.currentSuite) {
        this.currentSuite.tests.push({
          name: match[2],
          passed: false,
          error: match[3],
        });
        this.results.failed++;

        console.log(`    ${colors.red}✗${colors.reset} ${match[2]}: ${colors.red}${match[3]}${colors.reset}`);
      }
    } else if (text.startsWith('[SKIP]')) {
      const match = text.match(/\[SKIP\] (.+) > (.+?)(?:: (.+))?$/);
      if (match && this.currentSuite) {
        this.currentSuite.tests.push({
          name: match[2],
          skipped: true,
          reason: match[3] || '',
        });
        this.results.skipped++;

        if (VERBOSE) {
          console.log(`    ${colors.yellow}○${colors.reset} ${match[2]} ${colors.dim}(skipped)${colors.reset}`);
        }
      }
    } else if (text.startsWith('[SUMMARY]')) {
      try {
        this.summary = JSON.parse(text.replace('[SUMMARY] ', ''));
      } catch (e) {
        console.error('Failed to parse summary:', e);
      }
    } else if (text === '[COMPLETE]') {
      this.complete = true;
    }
  }

  getReport() {
    return {
      ...this.results,
      summary: this.summary,
      complete: this.complete,
    };
  }
}

// ============================================================================
// Main Runner
// ============================================================================

async function run() {
  console.log('');
  console.log(`${colors.cyan}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║  LiquidGlass E2E Test Suite                                  ║${colors.reset}`);
  console.log(`${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');

  // Start Vite dev server
  console.log(`${colors.dim}Starting Vite dev server...${colors.reset}`);

  const server = await createServer({
    root: ROOT,
    server: {
      port: 5173,
      strictPort: false,
    },
    logLevel: 'silent',
  });

  await server.listen();
  const address = server.httpServer.address();
  const serverUrl = `http://localhost:${address.port}`;

  console.log(`${colors.dim}Server running at ${serverUrl}${colors.reset}`);
  console.log('');

  // Launch browser
  console.log(`${colors.dim}Launching browser...${colors.reset}`);

  const browser = await puppeteer.launch({
    headless: HEADED ? false : 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      // Enable WebGPU if available
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // Set up log collector
  const collector = new TestCollector();

  page.on('console', msg => {
    const text = msg.text();
    collector.processLog(text);
  });

  page.on('pageerror', error => {
    console.error(`${colors.red}Page error: ${error.message}${colors.reset}`);
  });

  // Navigate to test page
  console.log(`${colors.dim}Loading test page...${colors.reset}`);
  console.log('');

  try {
    await page.goto(`${serverUrl}/test/e2e/test-page.html`, {
      waitUntil: 'networkidle0',
      timeout: TIMEOUT,
    });

    // Wait for tests to complete
    const startTime = Date.now();

    await page.waitForFunction(
      () => {
        // Check if [COMPLETE] was logged
        return window.__e2eComplete === true ||
          document.body.textContent.includes('Tests Complete');
      },
      { timeout: TIMEOUT }
    ).catch(() => {
      // Timeout - check if we have results anyway
    });

    // Wait a bit more for any async tests
    await new Promise(r => setTimeout(r, 500));

    // Give extra time if tests are still running
    while (!collector.complete && (Date.now() - startTime) < TIMEOUT) {
      await new Promise(r => setTimeout(r, 200));
    }

  } catch (error) {
    console.error(`${colors.red}Test execution error: ${error.message}${colors.reset}`);
  }

  // Close browser and server
  await browser.close();
  await server.close();

  // Report results
  const report = collector.getReport();

  console.log('');
  console.log(`${colors.cyan}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║  Test Results                                                ║${colors.reset}`);
  console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);

  if (!VERBOSE) {
    // Show suite summary
    for (const suite of report.suites) {
      const passed = suite.tests.filter(t => t.passed).length;
      const failed = suite.tests.filter(t => !t.passed && !t.skipped).length;
      const skipped = suite.tests.filter(t => t.skipped).length;
      const total = suite.tests.length;

      const icon = failed > 0 ? `${colors.red}✗` : `${colors.green}✓`;
      console.log(`${icon} ${suite.name}: ${passed}/${total - skipped} ${colors.dim}(${skipped} skipped)${colors.reset}`);
    }
    console.log('');
  }

  // Summary
  const { passed, failed, skipped } = report;
  const total = passed + failed + skipped;

  console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);
  console.log(`${colors.cyan}║  ${colors.green}Passed:  ${String(passed).padStart(3)}${colors.cyan}                                               ║${colors.reset}`);
  console.log(`${colors.cyan}║  ${colors.red}Failed:  ${String(failed).padStart(3)}${colors.cyan}                                               ║${colors.reset}`);
  console.log(`${colors.cyan}║  ${colors.yellow}Skipped: ${String(skipped).padStart(3)}${colors.cyan}                                               ║${colors.reset}`);
  console.log(`${colors.cyan}║  ${colors.bold}Total:   ${String(total).padStart(3)}${colors.cyan}                                               ║${colors.reset}`);

  if (report.summary?.duration) {
    console.log(`${colors.cyan}║  ${colors.dim}Duration: ${report.summary.duration}ms${colors.cyan}                                         ║${colors.reset}`);
  }

  console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);

  if (failed > 0) {
    console.log(`${colors.red}║  E2E TESTS FAILED                                            ║${colors.reset}`);
    console.log(`${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}`);
    console.log('');

    // List failed tests
    console.log(`${colors.red}Failed tests:${colors.reset}`);
    for (const suite of report.suites) {
      for (const test of suite.tests) {
        if (!test.passed && !test.skipped) {
          console.log(`  ${colors.red}✗${colors.reset} ${suite.name} > ${test.name}`);
          if (test.error) {
            console.log(`    ${colors.dim}${test.error}${colors.reset}`);
          }
        }
      }
    }

    process.exit(1);
  } else {
    console.log(`${colors.green}║  ALL E2E TESTS PASSED                                        ║${colors.reset}`);
    console.log(`${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}`);
    process.exit(0);
  }
}

// ============================================================================
// Entry Point
// ============================================================================

run().catch(error => {
  console.error(`${colors.red}Runner error: ${error.message}${colors.reset}`);
  console.error(error.stack);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Displacement Map Diff Runner
 *
 * Runs the displacement diff analysis page via CDP,
 * captures vector diff results, and reports errors.
 */

import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

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

async function run() {
  console.log('');
  console.log(`${colors.cyan}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║  Displacement Map Vector Diff Analysis                       ║${colors.reset}`);
  console.log(`${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');

  // Start Vite dev server
  console.log(`${colors.dim}Starting Vite dev server...${colors.reset}`);

  const server = await createServer({
    root: ROOT,
    server: { port: 5174, strictPort: false },
    logLevel: 'silent',
  });

  await server.listen();
  const address = server.httpServer.address();
  const serverUrl = `http://localhost:${address.port}`;
  console.log(`${colors.dim}Server: ${serverUrl}${colors.reset}`);
  console.log('');

  // Launch browser
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // Collect console logs
  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    if (text.includes('Error') || text.includes('FAIL')) {
      console.log(`${colors.red}${text}${colors.reset}`);
    } else if (text.includes('OK') || text.includes('PASS')) {
      console.log(`${colors.green}${text}${colors.reset}`);
    } else {
      console.log(`${colors.dim}${text}${colors.reset}`);
    }
  });

  page.on('pageerror', error => {
    console.error(`${colors.red}Page error: ${error.message}${colors.reset}`);
  });

  // Navigate to diff page
  console.log(`${colors.cyan}Loading diff analysis page...${colors.reset}`);
  console.log('');

  try {
    await page.goto(`${serverUrl}/test/e2e/displacement-diff.html`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // Wait for analysis to complete
    await page.waitForFunction(
      () => window.__analysisComplete === true,
      { timeout: 30000 }
    );

    // Extract results
    const results = await page.evaluate(() => {
      const diffResults = window.__diffResults || {};
      const output = {};

      for (const [name, result] of Object.entries(diffResults)) {
        output[name] = {
          maxDiff: result.maxDiff,
          avgDiff: result.avgDiff,
          diffPixels: result.diffPixels,
          totalPixels: result.totalPixels,
          samples: result.samples,
        };
      }

      return output;
    });

    console.log('');
    console.log(`${colors.cyan}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.cyan}║  Analysis Results                                            ║${colors.reset}`);
    console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);

    let hasErrors = false;

    for (const [name, result] of Object.entries(results)) {
      const pct = ((result.diffPixels / result.totalPixels) * 100).toFixed(2);
      const status = result.maxDiff < 0.01 ? `${colors.green}PASS` : `${colors.red}FAIL`;

      console.log(`${colors.cyan}║${colors.reset}  ${name.toUpperCase().padEnd(8)} ${status}${colors.reset}`);
      console.log(`${colors.cyan}║${colors.reset}    Max vector diff:  ${result.maxDiff.toFixed(6)}`);
      console.log(`${colors.cyan}║${colors.reset}    Avg vector diff:  ${result.avgDiff.toFixed(6)}`);
      console.log(`${colors.cyan}║${colors.reset}    Diff pixels:      ${result.diffPixels} / ${result.totalPixels} (${pct}%)`);

      if (result.maxDiff >= 0.01) {
        hasErrors = true;

        if (result.samples && result.samples.length > 0) {
          console.log(`${colors.cyan}║${colors.reset}    ${colors.yellow}Sample error locations:${colors.reset}`);
          for (const s of result.samples.slice(0, 5)) {
            console.log(`${colors.cyan}║${colors.reset}      (${s.x}, ${s.y}): ref=(${s.refR},${s.refG}) test=(${s.testR},${s.testG})`);
            console.log(`${colors.cyan}║${colors.reset}        dx=${s.dx.toFixed(4)} dy=${s.dy.toFixed(4)} mag=${s.mag.toFixed(4)}`);
          }
        }
      }
      console.log(`${colors.cyan}║${colors.reset}`);
    }

    // Take screenshot of diff canvases
    const screenshotPath = join(__dirname, 'diff-screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`${colors.cyan}║${colors.reset}  Screenshot saved: ${screenshotPath}`);

    // Extract diff canvas data for debugging
    const canvasData = await page.evaluate(() => {
      const maps = window.__maps || {};
      const data = {};

      for (const [name, canvas] of Object.entries(maps)) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // Get center pixel (should be 128, 128 for no displacement)
        const cx = Math.floor(canvas.width / 2);
        const cy = Math.floor(canvas.height / 2);
        const idx = (cy * canvas.width + cx) * 4;

        // Get corner pixel (should have displacement)
        const cornerIdx = 0;

        // Sample specific pixels for debugging
        data[name] = {
          width: canvas.width,
          height: canvas.height,
          center: {
            r: imageData.data[idx],
            g: imageData.data[idx + 1],
            b: imageData.data[idx + 2],
          },
          topLeft: {
            r: imageData.data[cornerIdx],
            g: imageData.data[cornerIdx + 1],
            b: imageData.data[cornerIdx + 2],
          },
          // Sample along edge (where displacement is strongest)
          edge: [],
        };

        // Sample top edge
        for (let x = 0; x < 10; x++) {
          const i = (0 * canvas.width + x) * 4;
          data[name].edge.push({
            x, y: 0,
            r: imageData.data[i],
            g: imageData.data[i + 1],
          });
        }
      }

      return data;
    });

    console.log(`${colors.cyan}║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}  ${colors.yellow}Pixel samples for debugging:${colors.reset}`);

    for (const [name, data] of Object.entries(canvasData)) {
      console.log(`${colors.cyan}║${colors.reset}    ${name.toUpperCase()}:`);
      console.log(`${colors.cyan}║${colors.reset}      Center (${data.width/2}, ${data.height/2}): R=${data.center.r} G=${data.center.g}`);
      console.log(`${colors.cyan}║${colors.reset}      TopLeft (0, 0): R=${data.topLeft.r} G=${data.topLeft.g}`);
      console.log(`${colors.cyan}║${colors.reset}      Top edge R values: [${data.edge.map(e => e.r).join(', ')}]`);
      console.log(`${colors.cyan}║${colors.reset}      Top edge G values: [${data.edge.map(e => e.g).join(', ')}]`);
    }

    console.log(`${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}`);

    // Save detailed results to JSON
    const jsonPath = join(__dirname, 'diff-results.json');
    fs.writeFileSync(jsonPath, JSON.stringify({ results, canvasData, logs }, null, 2));
    console.log(`${colors.dim}Detailed results saved to: ${jsonPath}${colors.reset}`);

    await browser.close();
    await server.close();

    if (hasErrors) {
      console.log('');
      console.log(`${colors.red}WebGL2 displacement map has errors!${colors.reset}`);
      process.exit(1);
    } else {
      console.log('');
      console.log(`${colors.green}All displacement maps match!${colors.reset}`);
      process.exit(0);
    }

  } catch (error) {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    console.error(error.stack);

    await browser.close();
    await server.close();
    process.exit(1);
  }
}

run();

#!/usr/bin/env node
/**
 * Memory Leak Detector for Liquid Glass
 *
 * This script specifically monitors liquidglass internals for memory leaks:
 * - SVG filter element accumulation
 * - Data URL string retention in feImage href attributes
 * - Canvas element accumulation
 * - WeakMap/Set growth patterns
 *
 * Usage:
 *   npm run dev  # Start dev server first
 *   node test/e2e/memory-leak-detector.mjs
 */

import puppeteer from 'puppeteer';

const RESIZE_CYCLES = 5;
const RESIZES_PER_CYCLE = 20;
const RESIZE_DELAY = 30;

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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ============================================================================
// In-page monitoring script
// ============================================================================

const MONITOR_SCRIPT = `
(function() {
  // Track data URL sizes
  window.__lgMonitor = {
    dataUrlSizes: [],
    svgFilterCount: 0,
    feImageHrefs: new Set(),
    canvasCount: 0,
    measurements: [],

    measure() {
      // Count SVG filters
      const svgRoot = document.querySelector('svg[aria-hidden="true"]');
      const filters = svgRoot ? svgRoot.querySelectorAll('filter') : [];
      this.svgFilterCount = filters.length;

      // Analyze feImage href attributes (potential data URL leaks)
      const feImages = document.querySelectorAll('feImage[href]');
      const currentHrefs = new Set();
      let totalDataUrlSize = 0;
      let pngDataUrlCount = 0;

      feImages.forEach(img => {
        const href = img.getAttribute('href');
        if (href && href.startsWith('data:image/png')) {
          currentHrefs.add(href);
          totalDataUrlSize += href.length;
          pngDataUrlCount++;
        }
      });

      // Track new data URLs (accumulation detection)
      const newUrls = [...currentHrefs].filter(url => !this.feImageHrefs.has(url));
      newUrls.forEach(url => this.feImageHrefs.add(url));

      // Count canvas elements in document
      this.canvasCount = document.querySelectorAll('canvas').length;

      const measurement = {
        timestamp: Date.now(),
        filterCount: this.svgFilterCount,
        feImageCount: feImages.length,
        pngDataUrlCount,
        totalDataUrlSize,
        uniqueDataUrls: this.feImageHrefs.size,
        newDataUrls: newUrls.length,
        canvasCount: this.canvasCount,
        heapUsed: performance.memory?.usedJSHeapSize || 0,
      };

      this.measurements.push(measurement);
      return measurement;
    },

    getReport() {
      return {
        measurements: this.measurements,
        totalUniqueDataUrls: this.feImageHrefs.size,
        finalFilterCount: this.svgFilterCount,
      };
    },

    reset() {
      this.measurements = [];
      this.feImageHrefs.clear();
    }
  };

  return true;
})();
`;

// ============================================================================
// Main Runner
// ============================================================================

async function run() {
  console.log('');
  console.log(`${colors.cyan}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║  LiquidGlass Memory Leak Detector                            ║${colors.reset}`);
  console.log(`${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');

  let browser = null;

  try {
    console.log(`${colors.dim}Launching browser...${colors.reset}`);

    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-precise-memory-info',
        '--js-flags=--expose-gc',
        '--enable-unsafe-webgpu',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Get CDP session for GC
    const cdp = await page.target().createCDPSession();

    // Navigate
    const url = 'http://localhost:8787/demo/parameter-lab/';
    console.log(`${colors.dim}Loading ${url}...${colors.reset}`);

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('.glass-panel', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1000));

    // Inject monitoring
    await page.evaluate(MONITOR_SCRIPT);
    console.log(`${colors.green}Monitoring injected${colors.reset}`);

    // Force initial GC
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.disable');
    await new Promise(r => setTimeout(r, 500));

    // Take initial measurement
    const initial = await page.evaluate(() => window.__lgMonitor.measure());
    console.log(`${colors.dim}Initial state:${colors.reset}`);
    console.log(`  Filters: ${initial.filterCount}, feImages: ${initial.feImageCount}, Heap: ${(initial.heapUsed / 1024 / 1024).toFixed(2)} MB`);

    console.log('');
    console.log(`${colors.cyan}Running ${RESIZE_CYCLES} resize cycles (${RESIZES_PER_CYCLE} resizes each)...${colors.reset}`);

    // Run resize cycles
    for (let cycle = 0; cycle < RESIZE_CYCLES; cycle++) {
      console.log(`${colors.dim}Cycle ${cycle + 1}/${RESIZE_CYCLES}...${colors.reset}`);

      for (let i = 0; i < RESIZES_PER_CYCLE; i++) {
        const phase = (i / RESIZES_PER_CYCLE) * Math.PI * 2;
        const widthDelta = Math.sin(phase) * 80;
        const heightDelta = Math.cos(phase) * 60;

        await page.evaluate(({ w, h }) => {
          const el = document.querySelector('.glass-panel');
          if (el) {
            el.style.width = `${320 + w}px`;
            el.style.height = `${200 + h}px`;
          }
        }, { w: widthDelta, h: heightDelta });

        await new Promise(r => setTimeout(r, RESIZE_DELAY));
      }

      // Wait for renders to complete
      await new Promise(r => setTimeout(r, 500));

      // Force GC
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.disable');
      await new Promise(r => setTimeout(r, 200));

      // Measure after GC
      const measurement = await page.evaluate(() => window.__lgMonitor.measure());
      console.log(`  After GC: Heap=${formatBytes(measurement.heapUsed)}, Filters=${measurement.filterCount}, UniqueURLs=${measurement.uniqueDataUrls}, New=${measurement.newDataUrls}`);
    }

    // Final measurement
    await new Promise(r => setTimeout(r, 1000));
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.disable');
    await new Promise(r => setTimeout(r, 500));

    const final = await page.evaluate(() => window.__lgMonitor.measure());
    const report = await page.evaluate(() => window.__lgMonitor.getReport());

    // Print report
    console.log('');
    console.log(`${colors.cyan}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.cyan}║  Analysis Results                                            ║${colors.reset}`);
    console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);

    const heapGrowth = final.heapUsed - initial.heapUsed;
    const heapGrowthColor = heapGrowth > 1024 * 1024 ? colors.red : heapGrowth > 256 * 1024 ? colors.yellow : colors.green;

    console.log(`${colors.cyan}║${colors.reset}  Initial Heap:       ${formatBytes(initial.heapUsed).padEnd(20)}${colors.cyan}                ║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}  Final Heap:         ${formatBytes(final.heapUsed).padEnd(20)}${colors.cyan}                ║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}  Heap Growth:        ${heapGrowthColor}${formatBytes(heapGrowth).padEnd(20)}${colors.cyan}                ║${colors.reset}`);
    console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);

    // SVG Filter analysis
    const filterGrowth = final.filterCount - initial.filterCount;
    const filterColor = filterGrowth > 0 ? colors.red : colors.green;
    console.log(`${colors.cyan}║${colors.reset}  Initial Filters:    ${String(initial.filterCount).padEnd(20)}${colors.cyan}                ║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}  Final Filters:      ${String(final.filterCount).padEnd(20)}${colors.cyan}                ║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}  Filter Growth:      ${filterColor}${String(filterGrowth).padEnd(20)}${colors.cyan}                ║${colors.reset}`);
    console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);

    // Data URL analysis
    const urlsColor = report.totalUniqueDataUrls > 10 ? colors.red : report.totalUniqueDataUrls > 5 ? colors.yellow : colors.green;
    console.log(`${colors.cyan}║${colors.reset}  Total Unique URLs:  ${urlsColor}${String(report.totalUniqueDataUrls).padEnd(20)}${colors.cyan}                ║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}  Final PNG URLs:     ${String(final.pngDataUrlCount).padEnd(20)}${colors.cyan}                ║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}  URL Data Size:      ${formatBytes(final.totalDataUrlSize).padEnd(20)}${colors.cyan}                ║${colors.reset}`);

    console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);

    // Diagnosis
    const issues = [];

    if (filterGrowth > 0) {
      issues.push(`SVG filter accumulation: ${filterGrowth} extra filters`);
    }

    if (report.totalUniqueDataUrls > RESIZE_CYCLES * 2 + 5) {
      // Expected: ~2 URLs per element (disp + spec), some extra for morphing
      issues.push(`Data URL accumulation: ${report.totalUniqueDataUrls} unique URLs retained`);
    }

    if (heapGrowth > 1024 * 1024) {
      issues.push(`Heap growth: ${formatBytes(heapGrowth)} after GC`);
    }

    if (issues.length === 0) {
      console.log(`${colors.green}║  DIAGNOSIS: No significant memory leaks detected            ║${colors.reset}`);
    } else {
      console.log(`${colors.red}║  DIAGNOSIS: Potential memory leaks found:                   ║${colors.reset}`);
      for (const issue of issues) {
        console.log(`${colors.red}║    - ${issue.padEnd(52)}║${colors.reset}`);
      }
    }

    console.log(`${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}`);

    // Print measurement timeline for debugging
    console.log('');
    console.log(`${colors.cyan}Measurement Timeline:${colors.reset}`);
    for (const m of report.measurements) {
      const time = new Date(m.timestamp).toISOString().slice(11, 23);
      console.log(`  ${colors.dim}${time}${colors.reset} Heap=${formatBytes(m.heapUsed).padEnd(10)} Filters=${m.filterCount} URLs=${m.uniqueDataUrls} New=${m.newDataUrls}`);
    }

  } catch (error) {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

run();

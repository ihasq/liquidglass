#!/usr/bin/env node
/**
 * Memory Profiler for Liquid Glass
 *
 * Connects to a running Chrome instance via CDP to analyze memory behavior
 * during continuous resize operations.
 *
 * Prerequisites:
 *   1. Start the dev server: npm run dev
 *   2. Launch Chrome with remote debugging:
 *      google-chrome --remote-debugging-port=9222 http://localhost:8787/demo/parameter-lab/
 *   3. Run this script: node test/e2e/memory-profiler.mjs
 *
 * Or run automated mode:
 *   node test/e2e/memory-profiler.mjs --headless
 */

import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// Configuration
const args = process.argv.slice(2);
const HEADLESS = args.includes('--headless');
const CONNECT_EXISTING = args.includes('--connect') || args.includes('-c');
const VERBOSE = args.includes('--verbose') || args.includes('-v');
const OUTPUT_FILE = args.find(a => a.startsWith('--output='))?.split('=')[1];

const RESIZE_ITERATIONS = 100;
const RESIZE_DELAY_MS = 50;
const SNAPSHOT_INTERVAL = 25; // Take snapshot every N iterations

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

function log(msg, data = '') {
  if (VERBOSE) {
    console.log(`${colors.dim}[Memory]${colors.reset} ${msg}`, data);
  }
}

// ============================================================================
// Memory Snapshot Analysis
// ============================================================================

class MemoryAnalyzer {
  constructor(cdp) {
    this.cdp = cdp;
    this.snapshots = [];
    this.allocations = [];
  }

  async startSampling() {
    await this.cdp.send('HeapProfiler.enable');
    await this.cdp.send('HeapProfiler.startSampling', {
      samplingInterval: 32768, // 32KB
    });
    log('Heap sampling started');
  }

  async stopSampling() {
    const { profile } = await this.cdp.send('HeapProfiler.stopSampling');
    await this.cdp.send('HeapProfiler.disable');
    return profile;
  }

  async takeHeapSnapshot(label) {
    const startTime = Date.now();

    // Force garbage collection first
    await this.cdp.send('HeapProfiler.collectGarbage');
    await new Promise(r => setTimeout(r, 100));

    // Get heap statistics
    const { result } = await this.cdp.send('Runtime.evaluate', {
      expression: `performance.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
      } : null`,
      returnByValue: true,
    });

    const snapshot = {
      label,
      timestamp: Date.now(),
      duration: Date.now() - startTime,
      memory: result.value,
    };

    this.snapshots.push(snapshot);
    return snapshot;
  }

  async getDetailedHeapStats() {
    await this.cdp.send('HeapProfiler.enable');

    // Take a full heap snapshot for analysis
    let chunks = [];
    const handler = ({ chunk }) => {
      chunks.push(chunk);
    };
    this.cdp.on('HeapProfiler.addHeapSnapshotChunk', handler);

    await this.cdp.send('HeapProfiler.takeHeapSnapshot', {
      reportProgress: false,
      treatGlobalObjectsAsRoots: true,
    });

    const snapshotData = chunks.join('');
    this.cdp.off('HeapProfiler.addHeapSnapshotChunk', handler);
    await this.cdp.send('HeapProfiler.disable');

    try {
      return JSON.parse(snapshotData);
    } catch (e) {
      return null;
    }
  }

  async analyzeStringRetention() {
    // Get heap snapshot and analyze large strings (likely data URLs)
    console.log(`${colors.dim}Taking heap snapshot for string analysis...${colors.reset}`);
    const heapData = await this.getDetailedHeapStats();
    if (!heapData) return null;

    const { nodes, strings, snapshot } = heapData;
    const meta = snapshot.meta;
    const nodeFieldCount = meta.node_fields.length;
    const typeIndex = meta.node_fields.indexOf('type');
    const nameIndex = meta.node_fields.indexOf('name');
    const selfSizeIndex = meta.node_fields.indexOf('self_size');
    const nodeTypes = meta.node_types[0];

    // Find string type index
    const stringTypeIdx = nodeTypes.indexOf('string');
    const concatenatedStringTypeIdx = nodeTypes.indexOf('concatenated string');

    // Collect large strings
    const largeStrings = [];
    for (let i = 0; i < nodes.length; i += nodeFieldCount) {
      const typeIdx = nodes[i + typeIndex];
      if (typeIdx === stringTypeIdx || typeIdx === concatenatedStringTypeIdx) {
        const selfSize = nodes[i + selfSizeIndex];
        const nameIdx = nodes[i + nameIndex];
        if (selfSize > 10000) { // Strings > 10KB
          const name = strings[nameIdx] || '';
          largeStrings.push({
            size: selfSize,
            preview: name.slice(0, 100),
            isDataUrl: name.startsWith('data:'),
          });
        }
      }
    }

    // Sort by size
    largeStrings.sort((a, b) => b.size - a.size);
    return largeStrings.slice(0, 20); // Top 20
  }

  analyzeSnapshot(heapData) {
    if (!heapData) return null;

    const { nodes, edges, strings, snapshot } = heapData;
    const meta = snapshot.meta;

    // Count by type
    const typeCounts = {};
    const nodeFieldCount = meta.node_fields.length;
    const typeIndex = meta.node_fields.indexOf('type');
    const nameIndex = meta.node_fields.indexOf('name');
    const selfSizeIndex = meta.node_fields.indexOf('self_size');
    const retainedSizeIndex = meta.node_fields.indexOf('retained_size');

    const nodeTypes = meta.node_types[0];

    for (let i = 0; i < nodes.length; i += nodeFieldCount) {
      const typeIdx = nodes[i + typeIndex];
      const typeName = nodeTypes[typeIdx];
      const selfSize = nodes[i + selfSizeIndex];

      if (!typeCounts[typeName]) {
        typeCounts[typeName] = { count: 0, selfSize: 0 };
      }
      typeCounts[typeName].count++;
      typeCounts[typeName].selfSize += selfSize;
    }

    return typeCounts;
  }

  getReport() {
    if (this.snapshots.length < 2) {
      return { growth: 0, snapshots: this.snapshots };
    }

    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];

    const heapGrowth = last.memory?.usedJSHeapSize - first.memory?.usedJSHeapSize;
    const totalGrowth = last.memory?.totalJSHeapSize - first.memory?.totalJSHeapSize;

    return {
      heapGrowth,
      totalGrowth,
      snapshots: this.snapshots,
      perIterationGrowth: heapGrowth / RESIZE_ITERATIONS,
    };
  }
}

// ============================================================================
// Resize Simulation
// ============================================================================

async function simulateResize(page, analyzer) {
  console.log(`${colors.cyan}Starting resize simulation (${RESIZE_ITERATIONS} iterations)...${colors.reset}`);

  // Initial snapshot
  const initialSnapshot = await analyzer.takeHeapSnapshot('initial');
  console.log(`${colors.dim}Initial heap: ${formatBytes(initialSnapshot.memory?.usedJSHeapSize || 0)}${colors.reset}`);

  // Find the first glass element
  const elementSelector = '.glass-panel';

  // Get element info
  const elementInfo = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      x: rect.x,
      y: rect.y,
    };
  }, elementSelector);

  if (!elementInfo) {
    console.error(`${colors.red}No glass element found!${colors.reset}`);
    return;
  }

  console.log(`${colors.dim}Element found: ${elementInfo.width}x${elementInfo.height}${colors.reset}`);

  // Perform continuous resize
  for (let i = 0; i < RESIZE_ITERATIONS; i++) {
    const phase = (i / RESIZE_ITERATIONS) * Math.PI * 4; // 2 full cycles
    const widthDelta = Math.sin(phase) * 100;
    const heightDelta = Math.cos(phase) * 80;

    const newWidth = Math.round(elementInfo.width + widthDelta);
    const newHeight = Math.round(elementInfo.height + heightDelta);

    // Resize via CSS width/height on parent (simulates drag resize)
    await page.evaluate(({ sel, w, h }) => {
      const el = document.querySelector(sel);
      if (el && el.parentElement) {
        // Find the interactive element wrapper
        const wrapper = el.closest('.interactive-element');
        if (wrapper) {
          // Trigger resize by modifying element style
          el.style.width = `${w}px`;
          el.style.height = `${h}px`;
        }
      }
    }, { sel: elementSelector, w: newWidth, h: newHeight });

    await new Promise(r => setTimeout(r, RESIZE_DELAY_MS));

    // Progress and periodic snapshots
    if ((i + 1) % SNAPSHOT_INTERVAL === 0) {
      const snapshot = await analyzer.takeHeapSnapshot(`iteration-${i + 1}`);
      const progress = ((i + 1) / RESIZE_ITERATIONS * 100).toFixed(0);
      const heap = formatBytes(snapshot.memory?.usedJSHeapSize || 0);
      console.log(`${colors.dim}[${progress}%] Iteration ${i + 1}: heap=${heap}${colors.reset}`);
    }
  }

  // Final snapshot after resize stops
  console.log(`${colors.dim}Waiting for final renders to complete...${colors.reset}`);
  await new Promise(r => setTimeout(r, 1000));

  // Force GC and take final snapshot
  const finalSnapshot = await analyzer.takeHeapSnapshot('final');
  console.log(`${colors.dim}Final heap: ${formatBytes(finalSnapshot.memory?.usedJSHeapSize || 0)}${colors.reset}`);

  return analyzer.getReport();
}

// ============================================================================
// Allocation Tracking
// ============================================================================

async function trackAllocations(page, cdp) {
  console.log(`${colors.cyan}Tracking allocations during resize...${colors.reset}`);

  try {
    // Enable heap profiler and start sampling
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.startSampling', {
      samplingInterval: 16384, // 16KB sampling interval
    });

    // Do a smaller resize test
    const elementSelector = '.glass-panel';
    for (let i = 0; i < 20; i++) {
      const phase = (i / 20) * Math.PI * 2;
      const widthDelta = Math.sin(phase) * 50;
      const heightDelta = Math.cos(phase) * 40;

      await page.evaluate(({ sel, w, h }) => {
        const el = document.querySelector(sel);
        if (el) {
          el.style.width = `${320 + w}px`;
          el.style.height = `${200 + h}px`;
        }
      }, { sel: elementSelector, w: widthDelta, h: heightDelta });

      await new Promise(r => setTimeout(r, 100));
    }

    // Stop sampling and get profile
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    await cdp.send('HeapProfiler.disable');

    return { profile };
  } catch (error) {
    console.log(`${colors.yellow}Allocation tracking failed: ${error.message}${colors.reset}`);
    return { profile: null };
  }
}

// ============================================================================
// Main Runner
// ============================================================================

async function run() {
  console.log('');
  console.log(`${colors.cyan}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║  LiquidGlass Memory Profiler                                 ║${colors.reset}`);
  console.log(`${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');

  let server = null;
  let browser = null;

  try {
    // Start Vite dev server if running headless and not connecting to existing
    if (HEADLESS && !CONNECT_EXISTING) {
      console.log(`${colors.dim}Starting Vite dev server...${colors.reset}`);
      server = await createServer({
        root: ROOT,
        server: { port: 8787, strictPort: true },
        logLevel: 'silent',
      });
      await server.listen();
      console.log(`${colors.dim}Server running at http://localhost:8787${colors.reset}`);
    } else if (CONNECT_EXISTING) {
      console.log(`${colors.dim}Connecting to existing server at localhost:8787...${colors.reset}`);
    }

    // Launch or connect to browser
    console.log(`${colors.dim}Launching browser...${colors.reset}`);

    browser = await puppeteer.launch({
      headless: HEADLESS ? 'new' : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-precise-memory-info', // Enable performance.memory
        '--js-flags=--expose-gc', // Expose gc() function
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
      ],
      devtools: !HEADLESS,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Get CDP session
    const cdp = await page.target().createCDPSession();

    // Navigate to demo page
    const url = 'http://localhost:8787/demo/parameter-lab/';
    console.log(`${colors.dim}Loading ${url}...${colors.reset}`);

    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // Wait for initialization
    await page.waitForSelector('.glass-panel', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1000));

    console.log(`${colors.green}Page loaded successfully${colors.reset}`);
    console.log('');

    // Create analyzer
    const analyzer = new MemoryAnalyzer(cdp);

    // Run resize simulation
    const report = await simulateResize(page, analyzer);

    // Print report
    console.log('');
    console.log(`${colors.cyan}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.cyan}║  Memory Analysis Report                                      ║${colors.reset}`);
    console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);

    const heapGrowth = report.heapGrowth || 0;
    const totalGrowth = report.totalGrowth || 0;
    const perIteration = report.perIterationGrowth || 0;

    const heapGrowthColor = heapGrowth > 1024 * 1024 ? colors.red : heapGrowth > 512 * 1024 ? colors.yellow : colors.green;
    const perIterColor = perIteration > 10 * 1024 ? colors.red : perIteration > 5 * 1024 ? colors.yellow : colors.green;

    console.log(`${colors.cyan}║${colors.reset}  Heap Growth:        ${heapGrowthColor}${formatBytes(heapGrowth).padEnd(20)}${colors.cyan}                ║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}  Total Growth:       ${formatBytes(totalGrowth).padEnd(20)}${colors.cyan}                ║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}  Per Iteration:      ${perIterColor}${formatBytes(perIteration).padEnd(20)}${colors.cyan}                ║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}  Iterations:         ${String(RESIZE_ITERATIONS).padEnd(20)}${colors.cyan}                ║${colors.reset}`);
    console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);

    // Snapshot timeline
    console.log(`${colors.cyan}║  Snapshot Timeline:                                          ║${colors.reset}`);
    for (const snap of report.snapshots) {
      const heap = formatBytes(snap.memory?.usedJSHeapSize || 0);
      console.log(`${colors.cyan}║${colors.reset}    ${snap.label.padEnd(20)} ${heap.padEnd(15)}${colors.cyan}                   ║${colors.reset}`);
    }

    console.log(`${colors.cyan}╠══════════════════════════════════════════════════════════════╣${colors.reset}`);

    // Diagnosis
    if (heapGrowth > 2 * 1024 * 1024) {
      console.log(`${colors.red}║  DIAGNOSIS: Significant memory leak detected!               ║${colors.reset}`);
      console.log(`${colors.red}║  Memory grew by ${formatBytes(heapGrowth)} during ${RESIZE_ITERATIONS} resize operations.  ║${colors.reset}`);
    } else if (heapGrowth > 512 * 1024) {
      console.log(`${colors.yellow}║  DIAGNOSIS: Moderate memory growth detected.                ║${colors.reset}`);
      console.log(`${colors.yellow}║  May need investigation for long-running sessions.         ║${colors.reset}`);
    } else {
      console.log(`${colors.green}║  DIAGNOSIS: Memory usage appears stable.                    ║${colors.reset}`);
    }

    console.log(`${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}`);

    // Analyze string retention (data URLs)
    console.log('');
    console.log(`${colors.cyan}Analyzing string retention (data URLs)...${colors.reset}`);

    const largeStrings = await analyzer.analyzeStringRetention();
    if (largeStrings && largeStrings.length > 0) {
      console.log(`${colors.cyan}Large strings in heap (potential leaks):${colors.reset}`);
      let dataUrlCount = 0;
      let dataUrlTotalSize = 0;
      for (const str of largeStrings) {
        const typeLabel = str.isDataUrl ? `${colors.red}[DATA URL]${colors.reset}` : '';
        console.log(`  ${formatBytes(str.size).padEnd(12)} ${typeLabel} ${colors.dim}${str.preview.slice(0, 50)}...${colors.reset}`);
        if (str.isDataUrl) {
          dataUrlCount++;
          dataUrlTotalSize += str.size;
        }
      }
      if (dataUrlCount > 0) {
        console.log(`${colors.yellow}Found ${dataUrlCount} data URL strings totaling ${formatBytes(dataUrlTotalSize)}${colors.reset}`);
      }
    }

    // Run allocation tracking for detailed analysis
    console.log('');
    console.log(`${colors.cyan}Running detailed allocation analysis...${colors.reset}`);

    const allocData = await trackAllocations(page, cdp);

    if (allocData.profile && allocData.profile.head) {
      console.log('');
      console.log(`${colors.cyan}Top Allocation Sites:${colors.reset}`);

      // Flatten and sort allocation nodes
      const nodes = [];
      function collectNodes(node, depth = 0) {
        if (node.selfSize > 0) {
          nodes.push({
            name: node.callFrame?.functionName || '(anonymous)',
            url: node.callFrame?.url || '',
            line: node.callFrame?.lineNumber || 0,
            selfSize: node.selfSize,
          });
        }
        if (node.children) {
          for (const child of node.children) {
            collectNodes(child, depth + 1);
          }
        }
      }
      collectNodes(allocData.profile.head);

      // Sort by size and show top 15
      nodes.sort((a, b) => b.selfSize - a.selfSize);
      const top = nodes.slice(0, 15);

      for (const node of top) {
        const file = node.url.split('/').pop() || node.url;
        const location = node.line ? `${file}:${node.line}` : file;
        console.log(`  ${colors.yellow}${formatBytes(node.selfSize).padEnd(12)}${colors.reset} ${node.name.slice(0, 30).padEnd(32)} ${colors.dim}${location}${colors.reset}`);
      }
    }

    // Save detailed report if requested
    if (OUTPUT_FILE) {
      const fullReport = {
        summary: report,
        allocations: allocData,
        timestamp: new Date().toISOString(),
      };
      writeFileSync(OUTPUT_FILE, JSON.stringify(fullReport, null, 2));
      console.log(`${colors.dim}Report saved to ${OUTPUT_FILE}${colors.reset}`);
    }

    console.log('');
    console.log(`${colors.green}Memory profiling complete.${colors.reset}`);

    // Keep browser open if not headless
    if (!HEADLESS) {
      console.log(`${colors.dim}Browser window kept open for manual inspection.${colors.reset}`);
      console.log(`${colors.dim}Press Ctrl+C to exit.${colors.reset}`);
      await new Promise(() => {}); // Wait forever
    }

  } catch (error) {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (browser && HEADLESS) {
      await browser.close();
    }
    if (server) {
      await server.close();
    }
  }
}

// ============================================================================
// Entry Point
// ============================================================================

run().catch(error => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  console.error(error.stack);
  process.exit(1);
});

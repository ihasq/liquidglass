#!/usr/bin/env node
/**
 * CDP Performance Trace for CSS Property Engine Demo
 *
 * Captures stack traces and analyzes unnecessary updates
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const DEMO_URL = 'http://localhost:5173/demo/css-property-engine-demo.html';
const TRACE_DURATION_MS = 5000;

async function startDevServer() {
  console.log('Starting Vite dev server...');
  const server = spawn('npx', ['vite', '--port', '5173'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Wait for server to be ready
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server timeout')), 30000);

    server.stdout.on('data', (data) => {
      const str = data.toString();
      if (str.includes('Local:') || str.includes('ready')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    server.stderr.on('data', (data) => {
      console.error('Server error:', data.toString());
    });

    server.on('error', reject);
  });

  console.log('Vite dev server started');
  return server;
}

async function runTrace() {
  let server;
  let browser;

  try {
    // Start dev server
    server = await startDevServer();
    await sleep(2000); // Extra wait for stability

    // Launch browser
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    // Enable CDP domains
    const client = await page.target().createCDPSession();

    // Enable profiling with call stacks
    await client.send('Profiler.enable');
    await client.send('Profiler.setSamplingInterval', { interval: 100 }); // 100µs

    // Enable tracing
    await client.send('Tracing.start', {
      categories: [
        'devtools.timeline',
        'v8.execute',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.stack',
        'disabled-by-default-v8.cpu_profiler',
      ].join(','),
      options: 'sampling-frequency=10000', // 10kHz
    });

    // Navigate to page
    console.log(`Navigating to ${DEMO_URL}...`);
    await page.goto(DEMO_URL, { waitUntil: 'networkidle0' });

    // Start CPU profiling
    await client.send('Profiler.start');

    // Simulate interactions
    console.log('Simulating interactions...');

    // Wait for initial render
    await sleep(1000);

    // Simulate color change
    await page.evaluate(() => {
      const colorInput = document.getElementById('color1');
      if (colorInput) {
        colorInput.value = '#ff0000';
        colorInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(500);

    // Simulate size change
    await page.evaluate(() => {
      const sizeInput = document.getElementById('size1');
      if (sizeInput) {
        sizeInput.value = '120';
        sizeInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(500);

    // Add a new box
    await page.evaluate(() => {
      const addBtn = document.getElementById('addBox');
      if (addBtn) addBtn.click();
    });
    await sleep(500);

    // Toggle highlight
    await page.evaluate(() => {
      const toggleBtn = document.getElementById('toggleHighlight');
      if (toggleBtn) toggleBtn.click();
    });
    await sleep(500);

    // Rapid changes to test throttling
    console.log('Testing rapid changes...');
    for (let i = 0; i < 10; i++) {
      await page.evaluate((val) => {
        const sizeInput = document.getElementById('size1');
        if (sizeInput) {
          sizeInput.value = String(val);
          sizeInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, 80 + i * 5);
      await sleep(50);
    }

    await sleep(1000);

    // Stop profiling
    const profile = await client.send('Profiler.stop');

    // Stop tracing
    const traceEvents = [];
    client.on('Tracing.dataCollected', (data) => {
      traceEvents.push(...data.value);
    });

    await client.send('Tracing.end');
    await sleep(500); // Wait for trace data

    // Analyze results
    console.log('\n========================================');
    console.log('PERFORMANCE ANALYSIS');
    console.log('========================================\n');

    // Analyze CPU profile
    analyzeProfile(profile.profile);

    // Get callback execution counts from page
    const logCount = await page.evaluate(() => {
      const log = document.getElementById('log');
      return log ? log.children.length : 0;
    });

    console.log(`\nCallback executions logged: ${logCount}`);

    // Check for console warnings/errors
    const logs = [];
    page.on('console', (msg) => logs.push({ type: msg.type(), text: msg.text() }));

    // Get final state
    const finalState = await page.evaluate(() => {
      const boxes = document.querySelectorAll('.demo-box');
      return {
        boxCount: boxes.length,
        box1Transform: boxes[0]?.style.transform || 'none',
        box1Background: boxes[0]?.style.backgroundColor || 'none',
      };
    });

    console.log('\nFinal State:');
    console.log(`  Box count: ${finalState.boxCount}`);
    console.log(`  Box 1 transform: ${finalState.box1Transform}`);
    console.log(`  Box 1 background: ${finalState.box1Background}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    if (browser) await browser.close();
    if (server) {
      server.kill('SIGTERM');
    }
  }
}

function analyzeProfile(profile) {
  if (!profile || !profile.nodes) {
    console.log('No profile data available');
    return;
  }

  const nodeMap = new Map();
  for (const node of profile.nodes) {
    nodeMap.set(node.id, node);
  }

  // Find hot functions related to our engine
  const engineFunctions = [];
  const targetPatterns = [
    'defineProperties',
    '_checkElement',
    '_scanDocument',
    '_scanStylesheets',
    '_scheduleScan',
    'callback',
    'PropertyCallback',
    'MutationObserver',
    'ResizeObserver',
  ];

  for (const node of profile.nodes) {
    const callFrame = node.callFrame;
    if (!callFrame || !callFrame.functionName) continue;

    const funcName = callFrame.functionName;
    const hitCount = node.hitCount || 0;

    for (const pattern of targetPatterns) {
      if (funcName.includes(pattern)) {
        engineFunctions.push({
          name: funcName,
          url: callFrame.url,
          line: callFrame.lineNumber,
          hitCount,
        });
        break;
      }
    }
  }

  // Sort by hit count
  engineFunctions.sort((a, b) => b.hitCount - a.hitCount);

  console.log('Engine-related function hits:');
  console.log('─'.repeat(60));

  if (engineFunctions.length === 0) {
    console.log('  (No engine functions captured in sampling)');
  } else {
    for (const func of engineFunctions.slice(0, 20)) {
      const shortUrl = func.url.split('/').pop() || func.url;
      console.log(`  ${func.hitCount.toString().padStart(4)} hits: ${func.name}`);
      console.log(`         ${shortUrl}:${func.line}`);
    }
  }

  // Check for potential issues
  console.log('\n─'.repeat(60));
  console.log('Potential Issues:');
  console.log('─'.repeat(60));

  const scanHits = engineFunctions.filter(f => f.name.includes('_scan'));
  const checkHits = engineFunctions.filter(f => f.name.includes('_check'));

  const totalScanHits = scanHits.reduce((sum, f) => sum + f.hitCount, 0);
  const totalCheckHits = checkHits.reduce((sum, f) => sum + f.hitCount, 0);

  if (totalScanHits > 100) {
    console.log(`  ⚠️  High scan frequency: ${totalScanHits} hits`);
    console.log('     Consider increasing debounce interval');
  } else {
    console.log(`  ✓  Scan frequency OK: ${totalScanHits} hits`);
  }

  if (totalCheckHits > 200) {
    console.log(`  ⚠️  High element check frequency: ${totalCheckHits} hits`);
    console.log('     Consider caching computed styles');
  } else {
    console.log(`  ✓  Element check frequency OK: ${totalCheckHits} hits`);
  }
}

runTrace().catch(console.error);

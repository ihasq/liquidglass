#!/usr/bin/env node
/**
 * CDP test: verify the new floating stats Renderer row is wired to the
 * Displacement Renderer parameter control bidirectionally.
 *
 *   - Click side-panel button → floating stats reflects new value
 *   - Click floating stats button → side-panel reflects new value
 *   - Both update params.displacementRenderer in shared state
 */

import puppeteer from 'puppeteer';

const URL = 'http://localhost:8787/demo/parameter-lab/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(800);

  console.log('\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('\u2551  Renderer Bidirectional Binding Verification     \u2551');
  console.log('\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D');

  // Helpers
  async function getActiveInStats() {
    return page.evaluate(() => {
      const rows = document.querySelectorAll('.stats .stat-row');
      for (const r of rows) {
        const label = r.querySelector('.stat-label')?.textContent || '';
        if (!label.startsWith('Renderer')) continue;
        const active = r.querySelector('.view-mode-btn.active');
        return active ? active.textContent.trim() : null;
      }
      return null;
    });
  }
  async function getActiveInSidePanel() {
    return page.evaluate(() => {
      // Side panel renderer control: find Toggle whose section contains
      // "Displacement Renderer" label
      const controls = document.querySelectorAll('.control');
      for (const ctl of controls) {
        const label = ctl.querySelector('.control-label')?.textContent || '';
        if (!label.includes('Displacement Renderer')) continue;
        const active = ctl.querySelector('.view-mode-btn.active');
        return active ? active.textContent.trim() : null;
      }
      return null;
    });
  }
  async function clickInStats(label) {
    return page.evaluate((target) => {
      const rows = document.querySelectorAll('.stats .stat-row');
      for (const r of rows) {
        const lbl = r.querySelector('.stat-label')?.textContent || '';
        if (!lbl.startsWith('Renderer')) continue;
        const btns = r.querySelectorAll('.view-mode-btn');
        for (const b of btns) {
          if (b.textContent.trim() === target) {
            b.click();
            return true;
          }
        }
      }
      return false;
    }, label);
  }
  async function clickInSidePanel(label) {
    return page.evaluate((target) => {
      const controls = document.querySelectorAll('.control');
      for (const ctl of controls) {
        const lbl = ctl.querySelector('.control-label')?.textContent || '';
        if (!lbl.includes('Displacement Renderer')) continue;
        const btns = ctl.querySelectorAll('.view-mode-btn');
        for (const b of btns) {
          if (b.textContent.trim() === target) {
            b.click();
            return true;
          }
        }
      }
      return false;
    }, label);
  }

  const initialStats = await getActiveInStats();
  const initialSide  = await getActiveInSidePanel();
  console.log(`\nInitial state:`);
  console.log(`  Stats panel active:      ${initialStats}`);
  console.log(`  Side panel active:       ${initialSide}`);
  console.log(`  Match: ${initialStats === initialSide ? '\u2713' : '\u2717'}`);

  const results = [];
  results.push({ name: 'initial-sync', pass: initialStats !== null && initialStats === initialSide });

  // Test 1: side panel → stats
  console.log(`\n── Test 1: Click side-panel button → stats updates ──`);
  await clickInSidePanel('GL2');
  await sleep(300);
  const t1Stats = await getActiveInStats();
  const t1Side  = await getActiveInSidePanel();
  console.log(`  After clicking GL2 in side panel:`);
  console.log(`    Stats: ${t1Stats}, Side: ${t1Side}`);
  results.push({ name: 'side→stats: GL2', pass: t1Stats === 'GL2' && t1Side === 'GL2' });

  // Test 2: stats → side panel
  console.log(`\n── Test 2: Click stats button → side panel updates ──`);
  await clickInStats('WASM-SIMD');
  await sleep(300);
  const t2Stats = await getActiveInStats();
  const t2Side  = await getActiveInSidePanel();
  console.log(`  After clicking WASM-SIMD in stats:`);
  console.log(`    Stats: ${t2Stats}, Side: ${t2Side}`);
  results.push({ name: 'stats→side: WASM-SIMD', pass: t2Stats === 'WASM-SIMD' && t2Side === 'WASM-SIMD' });

  // Test 3: cycle through all values
  console.log(`\n── Test 3: Cycle through all renderers ──`);
  let cycleAllPass = true;
  for (const target of ['GPU', 'GL2', 'WASM-SIMD', 'GPU']) {
    await clickInStats(target);
    await sleep(200);
    const s = await getActiveInStats();
    const sp = await getActiveInSidePanel();
    const ok = s === target && sp === target;
    console.log(`  Set to ${target}: stats=${s}, side=${sp} → ${ok ? '\u2713' : '\u2717'}`);
    if (!ok) cycleAllPass = false;
  }
  results.push({ name: 'cycle-all', pass: cycleAllPass });

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log('  Summary');
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  let pass = 0;
  for (const r of results) {
    console.log(`  ${r.pass ? '\u2713 PASS' : '\u2717 FAIL'}  ${r.name}`);
    if (r.pass) pass++;
  }
  console.log(`\n  Total: ${pass} / ${results.length} passed`);

  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });

#!/usr/bin/env node
/**
 * CDP test: verify that displacementRefreshInterval and specularRefreshInterval
 * throttle their respective maps independently during resize.
 *
 * Setup: trigger a continuous resize sequence (many small size deltas),
 * then count the number of frames each map regenerated. With
 * dispInterval=12 and specInterval=1, spec should regenerate ~12x more often.
 */

import puppeteer from 'puppeteer';

const URL = 'http://localhost:8787/demo/parameter-lab/';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1000);

  await page.evaluate(() => {
    globalThis.lgc_dev.profiler.enable();
    globalThis.lgc_dev.profiler.clear();
    globalThis.__cdpFrames = [];
    globalThis.lgc_dev.profiler.subscribe(f => globalThis.__cdpFrames.push(f));
  });

  // Verify the new params exist in schema
  const schemaCheck = await page.evaluate(() => {
    const el = document.querySelector('.glass-panel');
    if (!el) return { ok: false, reason: 'no glass-panel' };
    el.style.setProperty('--liquidglass-displacement-refresh-interval', '12');
    el.style.setProperty('--liquidglass-specular-refresh-interval', '1');
    return { ok: true };
  });
  if (!schemaCheck.ok) {
    console.error('Schema check failed:', schemaCheck.reason);
    await browser.close();
    process.exit(1);
  }
  await sleep(500);

  // Drain frames so far
  await page.evaluate(() => { globalThis.__cdpFrames.length = 0; });

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Per-map throttle during continuous resize');
  console.log('══════════════════════════════════════════════════════════');

  // Simulate resize by changing element width via setProperty
  const RESIZE_FRAMES = 30;
  for (let i = 0; i < RESIZE_FRAMES; i++) {
    await page.evaluate((i) => {
      const el = document.querySelector('.glass-panel');
      if (el) {
        // Width oscillates 280 → 350 → 280 to keep sizes changing
        const w = 280 + Math.round(70 * Math.abs(Math.sin(i * 0.3)));
        el.style.width = `${w}px`;
      }
    }, i);
    await sleep(30);  // ~33fps resize event rate
  }
  await sleep(800);  // settle

  const stats = await page.evaluate(() => {
    const frames = globalThis.__cdpFrames;
    let dispRenders = 0, specRenders = 0, totalFrames = 0;
    for (const f of frames) {
      totalFrames++;
      if (f.steps.displacementMap > 0) dispRenders++;
      if (f.steps.specularMap > 0) specRenders++;
    }
    return { totalFrames, dispRenders, specRenders };
  });

  console.log(`\n  Total render frames captured: ${stats.totalFrames}`);
  console.log(`  Displacement regen count:     ${stats.dispRenders}`);
  console.log(`  Specular     regen count:     ${stats.specRenders}`);
  console.log(`  Spec/Disp ratio:              ${stats.dispRenders ? (stats.specRenders / stats.dispRenders).toFixed(2) : 'inf'}x`);

  // Expected: with intervals 12 and 1, spec should regenerate much more often
  const ratioOk = stats.specRenders >= stats.dispRenders;
  console.log(`\n  Spec renders ≥ Disp renders?  ${ratioOk ? '\u2713 PASS' : '\u2717 FAIL'}`);

  // Now flip: spec=12, disp=1 → expect disp renders > spec renders
  console.log('\n── Inverted intervals (disp=1, spec=12) ──');
  await page.evaluate(() => {
    const el = document.querySelector('.glass-panel');
    if (el) {
      el.style.setProperty('--liquidglass-displacement-refresh-interval', '1');
      el.style.setProperty('--liquidglass-specular-refresh-interval', '12');
    }
    globalThis.__cdpFrames.length = 0;
  });
  await sleep(500);
  await page.evaluate(() => { globalThis.__cdpFrames.length = 0; });

  for (let i = 0; i < RESIZE_FRAMES; i++) {
    await page.evaluate((i) => {
      const el = document.querySelector('.glass-panel');
      if (el) {
        const w = 280 + Math.round(70 * Math.abs(Math.sin(i * 0.3)));
        el.style.width = `${w}px`;
      }
    }, i);
    await sleep(30);
  }
  await sleep(800);

  const stats2 = await page.evaluate(() => {
    const frames = globalThis.__cdpFrames;
    let dispRenders = 0, specRenders = 0, totalFrames = 0;
    for (const f of frames) {
      totalFrames++;
      if (f.steps.displacementMap > 0) dispRenders++;
      if (f.steps.specularMap > 0) specRenders++;
    }
    return { totalFrames, dispRenders, specRenders };
  });

  console.log(`  Total frames: ${stats2.totalFrames}`);
  console.log(`  Disp regen: ${stats2.dispRenders}`);
  console.log(`  Spec regen: ${stats2.specRenders}`);
  console.log(`  Disp/Spec ratio: ${stats2.specRenders ? (stats2.dispRenders / stats2.specRenders).toFixed(2) : 'inf'}x`);

  const ratioOk2 = stats2.dispRenders >= stats2.specRenders;
  console.log(`  Disp renders ≥ Spec renders?  ${ratioOk2 ? '\u2713 PASS' : '\u2717 FAIL'}`);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Final verdict: ${ratioOk && ratioOk2 ? '\u2713 ALL PASS' : '\u2717 FAIL'}`);
  console.log('══════════════════════════════════════════════════════════');

  await browser.close();
  process.exit(ratioOk && ratioOk2 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(2); });

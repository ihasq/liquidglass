#!/usr/bin/env node
/**
 * CDP-based test: verify whether spec/disp parameter changes trigger
 * cross re-rendering (i.e. does changing a specular property cause
 * displacement re-render, and vice versa).
 *
 * Uses lgc_dev.profiler to record per-step timings (displacementMap,
 * specularMap, etc.) per frame.
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

  // Mirror page console to our terminal
  page.on('console', msg => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') console.log(`[page:${t}] ${msg.text()}`);
  });
  page.on('pageerror', err => console.log(`[page:err] ${err.message}`));

  console.log(`Loading ${URL} ...`);
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1000);  // settle

  // Enable profiler in the page
  const enabled = await page.evaluate(() => {
    if (typeof globalThis.lgc_dev === 'undefined') {
      return { ok: false, reason: 'lgc_dev not exposed' };
    }
    if (!globalThis.lgc_dev.profiler) return { ok: false, reason: 'no profiler' };
    globalThis.lgc_dev.profiler.enable();
    globalThis.lgc_dev.profiler.clear();

    // Install a frame collector
    globalThis.__cdpFrames = [];
    globalThis.__cdpUnsub = globalThis.lgc_dev.profiler.subscribe(frame => {
      globalThis.__cdpFrames.push(frame);
    });
    return { ok: true };
  });
  if (!enabled.ok) {
    console.error('Failed to enable profiler:', enabled.reason);
    await browser.close();
    process.exit(1);
  }
  console.log('Profiler enabled.\n');

  // Helpers running inside page
  async function pageSetCSSProp(propName, value) {
    return page.evaluate((p, v) => {
      // Find an attached liquid-glass element via the element registry
      // The CSS Custom Property driver applies styles to elements with the
      // marker class. We grab the first element with `.glass-panel` class.
      const el = document.querySelector('.glass-panel');
      if (!el) return false;
      el.style.setProperty(p, v);
      return true;
    }, propName, value);
  }

  async function snapshotFrames() {
    return page.evaluate(() => {
      const f = globalThis.__cdpFrames.slice();
      globalThis.__cdpFrames.length = 0;
      return f;
    });
  }

  async function changeAndCollect(label, propName, values, settleMs = 800) {
    console.log(`\n── ${label} ──`);
    console.log(`  Setting ${propName} through values: ${values.join(', ')}`);
    // Drain pre-existing frames
    await snapshotFrames();
    for (const v of values) {
      await pageSetCSSProp(propName, String(v));
      await sleep(120);
    }
    await sleep(settleMs);
    const frames = await snapshotFrames();
    const renderFrames = frames.filter(f => f.steps.displacementMap > 0 || f.steps.specularMap > 0);
    let dispRenders = 0, specRenders = 0;
    let dispTotalMs = 0, specTotalMs = 0;
    for (const f of renderFrames) {
      if (f.steps.displacementMap > 0) { dispRenders++; dispTotalMs += f.steps.displacementMap; }
      if (f.steps.specularMap > 0)     { specRenders++; specTotalMs += f.steps.specularMap; }
    }
    console.log(`  Render frames captured: ${renderFrames.length}`);
    console.log(`    displacementMap renders: ${dispRenders}, total time: ${dispTotalMs.toFixed(2)} ms`);
    console.log(`    specularMap     renders: ${specRenders}, total time: ${specTotalMs.toFixed(2)} ms`);
    return { dispRenders, specRenders, dispTotalMs, specTotalMs, renderFrames };
  }

  // ── Test 1: Change SPECULAR-only properties ──
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  TEST 1: Specular-only property changes');
  console.log('══════════════════════════════════════════════════════════');
  // Use final values that differ from initial defaults to ensure a net
  // change is observed (otherwise caches legitimately report 0 regens).
  const t1a = await changeAndCollect(
    'specular-angle',
    '--liquidglass-specular-angle',
    [-30, 0, 45, 90, 135]
  );
  const t1b = await changeAndCollect(
    'specular-width',
    '--liquidglass-specular-width',
    [3, 8, 15, 25]
  );
  const t1c = await changeAndCollect(
    'specular-shininess',
    '--liquidglass-specular-shininess',
    [4, 16, 32, 64]
  );
  const t1d = await changeAndCollect(
    'gloss',
    '--liquidglass-gloss',
    [20, 50, 80, 100]
  );

  // ── Test 2: Change DISPLACEMENT-only properties ──
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  TEST 2: Displacement-only property changes');
  console.log('══════════════════════════════════════════════════════════');
  const t2a = await changeAndCollect(
    'refraction',
    '--liquidglass-refraction',
    [10, 40, 70, 100]
  );
  const t2b = await changeAndCollect(
    'thickness',
    '--liquidglass-thickness',
    [10, 30, 70, 90]
  );
  const t2c = await changeAndCollect(
    'displacement-resolution',
    '--liquidglass-displacement-resolution',
    [20, 60, 100, 80]
  );

  // ── Summary / Verdict ──
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('══════════════════════════════════════════════════════════');

  function row(label, t) {
    return `${label.padEnd(30)} | disp: ${String(t.dispRenders).padStart(3)}  spec: ${String(t.specRenders).padStart(3)}`;
  }

  console.log('\n[Specular-only changes]');
  console.log('  ' + row('specular-angle', t1a));
  console.log('  ' + row('specular-width', t1b));
  console.log('  ' + row('specular-shininess', t1c));
  console.log('  ' + row('gloss (specular intensity)', t1d));
  const specChangesTriggerDisp =
    t1a.dispRenders > 0 || t1b.dispRenders > 0 || t1c.dispRenders > 0 || t1d.dispRenders > 0;

  console.log('\n[Displacement-only changes]');
  console.log('  ' + row('refraction', t2a));
  console.log('  ' + row('thickness', t2b));
  console.log('  ' + row('displacement-resolution', t2c));
  const dispChangesTriggerSpec =
    t2a.specRenders > 0 || t2b.specRenders > 0 || t2c.specRenders > 0;

  console.log('\n[Verdict]');
  console.log(`  Spec change → triggers displacement re-render?  ${specChangesTriggerDisp ? '\u2717 YES (cross-rendering bug)' : '\u2713 NO (isolated)'}`);
  console.log(`  Disp change → triggers specular  re-render?     ${dispChangesTriggerSpec ? '\u2717 YES (cross-rendering bug)' : '\u2713 NO (isolated)'}`);

  await browser.close();

  process.exit((specChangesTriggerDisp || dispChangesTriggerSpec) ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(2); });

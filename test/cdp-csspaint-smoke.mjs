#!/usr/bin/env node
/**
 * Smoke test: Verify the CSS Paint API specular path works end-to-end.
 *
 *   1. Page loads without console errors.
 *   2. The specular paint worklet registers successfully.
 *   3. The element gets `background-image: paint(liquid-glass-specular)`.
 *   4. Changing --liquidglass-specular-angle triggers a paint (visible
 *      pixel difference in screenshot).
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
  await page.setViewport({ width: 1280, height: 800 });

  const errors = [];
  const warns = [];
  page.on('console', msg => {
    const t = msg.type();
    if (t === 'error') { errors.push(msg.text()); console.log(`[err] ${msg.text()}`); }
    if (t === 'warning' || t === 'warn') { warns.push(msg.text()); }
  });
  page.on('pageerror', e => { errors.push(`pageerror: ${e.message}`); console.log(`[pageerr] ${e.message}`); });

  console.log(`Loading ${URL} ...`);
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1500);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  CSS Paint API Specular Smoke Test');
  console.log('══════════════════════════════════════════════════════════');

  // 1. Verify worklet API is supported
  const support = await page.evaluate(() => ({
    hasPaintWorklet: typeof CSS !== 'undefined' && typeof CSS.paintWorklet !== 'undefined',
    hasRegisterProperty: typeof CSS !== 'undefined' && typeof CSS.registerProperty !== 'undefined',
  }));
  console.log(`\n  CSS.paintWorklet:    ${support.hasPaintWorklet ? '\u2713' : '\u2717'}`);
  console.log(`  CSS.registerProperty: ${support.hasRegisterProperty ? '\u2713' : '\u2717'}`);

  // 2. Find a glass-panel and check background-image contains paint()
  const elState = await page.evaluate(() => {
    const el = document.querySelector('.glass-panel');
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    return {
      found: true,
      backgroundImage: el.style.backgroundImage,
      computedBg: cs.backgroundImage,
      borderRadius: cs.borderTopLeftRadius,
      lgRadius: el.style.getPropertyValue('--liquidglass-radius'),
      width: el.clientWidth,
      height: el.clientHeight,
    };
  });
  console.log(`\n  .glass-panel found:  ${elState.found ? '\u2713' : '\u2717'}`);
  if (elState.found) {
    const hasPaint = String(elState.backgroundImage).includes('paint(liquid-glass-specular)');
    console.log(`  bg-image has paint(): ${hasPaint ? '\u2713' : '\u2717'}  (${elState.backgroundImage || '(empty)'})`);
    console.log(`  --liquidglass-radius: ${elState.lgRadius || '(unset)'}`);
    console.log(`  Element size:        ${elState.width}x${elState.height}`);
    console.log(`  CS border-radius:    ${elState.borderRadius}`);
  }

  // 3. Take a screenshot and change angle, then take another, verify difference
  await page.evaluate(() => {
    const el = document.querySelector('.glass-panel');
    if (el) el.style.setProperty('--liquidglass-specular-angle', '90');
  });
  await sleep(300);
  const afterAngle = await page.screenshot({ encoding: 'base64' });

  await page.evaluate(() => {
    const el = document.querySelector('.glass-panel');
    if (el) el.style.setProperty('--liquidglass-specular-angle', '-90');
  });
  await sleep(300);
  const afterAngle2 = await page.screenshot({ encoding: 'base64' });

  const changed = afterAngle !== afterAngle2;
  console.log(`\n  Angle change → repaint: ${changed ? '\u2713' : '\u2717'}`);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Errors:   ${errors.length}`);
  console.log(`  Warnings: ${warns.length}`);
  console.log('══════════════════════════════════════════════════════════');

  if (errors.length > 0) {
    console.log('\n  First errors:');
    for (const e of errors.slice(0, 5)) console.log(`    ${e}`);
  }

  await browser.close();

  const ok = support.hasPaintWorklet && elState.found
          && String(elState.backgroundImage).includes('paint(liquid-glass-specular)')
          && changed
          && errors.filter(e => !e.includes('Failed to load resource')).length === 0;
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });

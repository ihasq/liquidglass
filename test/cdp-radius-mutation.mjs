#!/usr/bin/env node
/**
 * Verify that programmatic border-radius changes (no resize) are
 * propagated to --liquidglass-radius without delay.
 */

import puppeteer from 'puppeteer';

const URL = 'http://localhost:8787/demo/parameter-lab/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function readRadius(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.glass-panel');
    return {
      cssBorderRadius: getComputedStyle(el).borderTopLeftRadius,
      lgRadius: el.style.getPropertyValue('--liquidglass-radius'),
    };
  });
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await sleep(1500);

  console.log('\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('\u2551  Radius mutation propagation test                \u2551');
  console.log('\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D');

  const before = await readRadius(page);
  console.log(`\nInitial:  cs=${before.cssBorderRadius}  --lg=${before.lgRadius}`);

  // Test 1: change inline border-radius (NO size change)
  console.log('\n── Test 1: el.style.borderRadius = "60px" ──');
  await page.evaluate(() => {
    document.querySelector('.glass-panel').style.borderRadius = '60px';
  });
  await sleep(150);  // allow MutationObserver microtask to flush
  const after1 = await readRadius(page);
  console.log(`  After:    cs=${after1.cssBorderRadius}  --lg=${after1.lgRadius}`);
  const test1Pass = after1.lgRadius === '60px';
  console.log(`  Result:   ${test1Pass ? '\u2713 PASS' : '\u2717 FAIL'}`);

  // Test 2: change to a different value
  console.log('\n── Test 2: el.style.borderRadius = "8px" ──');
  await page.evaluate(() => {
    document.querySelector('.glass-panel').style.borderRadius = '8px';
  });
  await sleep(150);
  const after2 = await readRadius(page);
  console.log(`  After:    cs=${after2.cssBorderRadius}  --lg=${after2.lgRadius}`);
  const test2Pass = after2.lgRadius === '8px';
  console.log(`  Result:   ${test2Pass ? '\u2713 PASS' : '\u2717 FAIL'}`);

  // Test 3: rapid sequence (ensure no infinite loop)
  console.log('\n── Test 3: rapid radius changes (loop-safety) ──');
  for (const r of [10, 20, 30, 40, 50]) {
    await page.evaluate((v) => {
      document.querySelector('.glass-panel').style.borderRadius = `${v}px`;
    }, r);
  }
  await sleep(200);
  const after3 = await readRadius(page);
  console.log(`  After 5 changes:  cs=${after3.cssBorderRadius}  --lg=${after3.lgRadius}`);
  const test3Pass = after3.lgRadius === '50px';
  console.log(`  Result:   ${test3Pass ? '\u2713 PASS' : '\u2717 FAIL'}`);

  // Test 4: class change that affects border-radius
  console.log('\n── Test 4: class-driven radius change ──');
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.test-radius-class { border-radius: 12px !important; }';
    document.head.appendChild(style);
    const el = document.querySelector('.glass-panel');
    el.style.removeProperty('border-radius');  // let class take effect
    el.classList.add('test-radius-class');
  });
  await sleep(150);
  const after4 = await readRadius(page);
  console.log(`  After:    cs=${after4.cssBorderRadius}  --lg=${after4.lgRadius}`);
  const test4Pass = after4.lgRadius === '12px';
  console.log(`  Result:   ${test4Pass ? '\u2713 PASS' : '\u2717 FAIL'}`);

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  const total = [test1Pass, test2Pass, test3Pass, test4Pass].filter(Boolean).length;
  console.log(`  ${total} / 4 tests passed`);

  await browser.close();
  process.exit(total === 4 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });

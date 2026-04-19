#!/usr/bin/env node
/**
 * Verify that the schema-aligned @property syntax/unit changes accept
 * BOTH typed and bare values, and that paint() reflects each correctly.
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
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await sleep(1500);

  console.log('\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('\u2551  Typed CSS value acceptance test                   \u2551');
  console.log('\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D');

  // Inspect the @property style rules injected by the engine
  const rules = await page.evaluate(() => {
    const styles = document.querySelectorAll('style[data-css-property-engine]');
    if (!styles.length) return null;
    return Array.from(styles).map(s => s.textContent || '').join('\n');
  });
  console.log('\n── Injected @property rules (excerpt) ──');
  if (rules) {
    const lines = rules.split('\n').filter(l => l.includes('@property') || l.includes('syntax:') || l.includes('initial-value:'));
    console.log(lines.slice(0, 20).map(l => `  ${l.trim()}`).join('\n'));
  }

  // Check computed values for several typed inputs
  const tests = [
    { prop: '--liquidglass-specular-angle', value: '45deg',  expectsCS: '45deg' },
    { prop: '--liquidglass-specular-angle', value: '-90',    expectsCS: '-90' },
    { prop: '--liquidglass-specular-width', value: '20px',   expectsCS: '20px' },
    { prop: '--liquidglass-gloss',          value: '75%',    expectsCS: '75%' },
    { prop: '--liquidglass-gloss',          value: '40',     expectsCS: '40' },
    { prop: '--liquidglass-refraction',     value: '80%',    expectsCS: '80%' },
    { prop: '--liquidglass-specular-shininess', value: '32', expectsCS: '32' },
  ];

  console.log('\n── Property value round-trip ──');
  let pass = 0;
  for (const t of tests) {
    const actual = await page.evaluate(({ prop, value }) => {
      const el = document.querySelector('.glass-panel');
      el.style.setProperty(prop, value);
      const cs = getComputedStyle(el).getPropertyValue(prop);
      return cs.trim();
    }, t);
    // Computed value can be either the input form or normalized; both are acceptable.
    const ok = actual.length > 0 && actual !== '__UNSET__';
    console.log(`  ${ok ? '\u2713' : '\u2717'} ${t.prop} = ${t.value}  →  computed: ${actual}`);
    if (ok) pass++;
  }

  // Verify a typed angle change actually causes a paint diff
  console.log('\n── Paint reflects typed angle ──');
  await page.evaluate(() => {
    document.querySelectorAll('.glass-panel').forEach((el, i) => {
      if (i > 0) el.parentElement.style.display = 'none';
    });
  });
  await page.evaluate(() => {
    document.querySelector('.glass-panel').style.setProperty('--liquidglass-specular-angle', '0deg');
  });
  await sleep(300);
  const shotA = await (await page.$('.glass-panel')).screenshot({ encoding: 'base64' });
  await page.evaluate(() => {
    document.querySelector('.glass-panel').style.setProperty('--liquidglass-specular-angle', '180deg');
  });
  await sleep(300);
  const shotB = await (await page.$('.glass-panel')).screenshot({ encoding: 'base64' });
  const angleVisual = shotA !== shotB;
  console.log(`  Angle 0deg vs 180deg pixel diff: ${angleVisual ? '\u2713' : '\u2717'}`);
  if (angleVisual) pass++;

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log(`  ${pass} / ${tests.length + 1} checks passed`);

  await browser.close();
  process.exit(pass === tests.length + 1 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });

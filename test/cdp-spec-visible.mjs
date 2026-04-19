#!/usr/bin/env node
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const URL = 'http://localhost:8787/demo/parameter-lab/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  page.on('console', msg => {
    const t = msg.type();
    if (t === 'error' || t === 'warning' || t === 'warn') {
      console.log(`[page:${t}] ${msg.text()}`);
    }
  });
  page.on('pageerror', e => console.log(`[err] ${e.message}`));

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  // Crank gloss + isolate to a single visible element
  await page.evaluate(() => {
    document.querySelectorAll('.glass-panel').forEach((el, i) => {
      if (i > 0) {
        el.parentElement.style.display = 'none';
        return;
      }
      el.style.setProperty('--liquidglass-gloss', '100');
      el.style.setProperty('--liquidglass-specular-angle', '-90');
      el.style.setProperty('--liquidglass-specular-shininess', '4');
      el.style.setProperty('--liquidglass-specular-width', '12');
    });
    // also widen the element a bit
    const el = document.querySelector('.glass-panel');
    if (el) {
      el.parentElement.style.left = '50%';
      el.parentElement.style.top = '50%';
    }
  });
  await sleep(800);

  const buf = await page.screenshot({ fullPage: true });
  writeFileSync('/tmp/spec-isolate.png', buf);
  console.log('Saved /tmp/spec-isolate.png');

  // Also probe: what is computed style of the glass-panel?
  const probe = await page.evaluate(() => {
    const el = document.querySelector('.glass-panel');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      bgImage: cs.backgroundImage,
      bgColor: cs.backgroundColor,
      backdropFilter: cs.backdropFilter,
      width: el.clientWidth,
      height: el.clientHeight,
      lgRadius: el.style.getPropertyValue('--liquidglass-radius'),
      lgGloss: cs.getPropertyValue('--liquidglass-gloss'),
      lgAngle: cs.getPropertyValue('--liquidglass-specular-angle'),
      lgShin: cs.getPropertyValue('--liquidglass-specular-shininess'),
      lgWidth: cs.getPropertyValue('--liquidglass-specular-width'),
    };
  });
  console.log('Probe:', JSON.stringify(probe, null, 2));

  await browser.close();
})();

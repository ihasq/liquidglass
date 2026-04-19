#!/usr/bin/env node
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const URL = 'http://localhost:8787/demo/parameter-lab/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  // Try a few angles
  for (const angle of [-60, 0, 90, 180]) {
    await page.evaluate((a) => {
      document.querySelectorAll('.glass-panel').forEach(el => {
        el.style.setProperty('--liquidglass-specular-angle', String(a));
      });
    }, angle);
    await sleep(400);
    const el = await page.$('.glass-panel');
    if (el) {
      const buf = await el.screenshot();
      writeFileSync(`/tmp/spec-angle-${angle}.png`, buf);
      console.log(`Saved /tmp/spec-angle-${angle}.png`);
    }
  }

  await browser.close();
})();

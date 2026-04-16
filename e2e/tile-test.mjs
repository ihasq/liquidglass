import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 600 });

const htmlPath = path.resolve('e2e/tile-placement-test.html');
await page.goto('file://' + htmlPath);
await page.waitForSelector('#nineslice');

// Take screenshot
await page.screenshot({ path: '/tmp/tile-placement.png', fullPage: true });
console.log('Screenshot saved to /tmp/tile-placement.png');

await browser.close();

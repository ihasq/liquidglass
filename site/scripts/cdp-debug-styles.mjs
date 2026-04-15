/**
 * Debug CDP styles - check what Tailwind classes are actually applied
 */

import puppeteer from 'puppeteer';

async function debugStyles() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Force viewport to lg breakpoint
  await page.setViewport({ width: 1919, height: 997 });

  await page.goto('http://localhost:5176', { waitUntil: 'networkidle0' });
  await page.waitForSelector('h1');

  const debug = await page.evaluate(() => {
    const root = document.querySelector('div.min-h-screen');
    const leftCol = root?.children[0];
    const rightCol = root?.children[1];
    const title = document.querySelector('h1');

    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      leftCol: leftCol ? {
        className: leftCol.className,
        computedPaddingTop: getComputedStyle(leftCol).paddingTop,
        computedPaddingLeft: getComputedStyle(leftCol).paddingLeft,
        computedWidth: getComputedStyle(leftCol).width,
      } : null,
      rightCol: rightCol ? {
        className: rightCol.className,
        computedPaddingTop: getComputedStyle(rightCol).paddingTop,
      } : null,
      title: title ? {
        className: title.className,
        rect: title.getBoundingClientRect(),
      } : null,
    };
  });

  console.log('=== Debug Styles ===\n');
  console.log('Viewport:', debug.viewport);
  console.log('\nLeft Column:');
  console.log('  className:', debug.leftCol?.className);
  console.log('  paddingTop:', debug.leftCol?.computedPaddingTop);
  console.log('  paddingLeft:', debug.leftCol?.computedPaddingLeft);
  console.log('  width:', debug.leftCol?.computedWidth);
  console.log('\nRight Column:');
  console.log('  className:', debug.rightCol?.className);
  console.log('  paddingTop:', debug.rightCol?.computedPaddingTop);
  console.log('\nTitle:');
  console.log('  className:', debug.title?.className);
  console.log('  rect:', debug.title?.rect);

  await browser.close();
}

debugStyles().catch(console.error);

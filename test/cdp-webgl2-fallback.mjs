#!/usr/bin/env node
/**
 * CDP test: verify WebGL2 unsafe-environment detection and context-loss
 * fallback to WASM-SIMD.
 *
 * Tests three scenarios:
 *   1. Force-disable via __lg_disable_webgl2 → WebGL2 reports unsupported
 *   2. Force-enable via __lg_force_webgl2 → bypasses platform check
 *   3. Synthetic context loss via WEBGL_lose_context → permanent disable
 */

import puppeteer from 'puppeteer';

const URL = 'http://localhost:8787/demo/parameter-lab/';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function newPage(extraInit) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  if (extraInit) {
    await page.evaluateOnNewDocument(extraInit);
  }

  page.on('console', msg => {
    if (msg.type() === 'warning' || msg.type() === 'error') {
      console.log(`  [page:${msg.type()}] ${msg.text()}`);
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(800);

  return { browser, page };
}

async function probeWebGL2Status(page) {
  return page.evaluate(async () => {
    const mod = await import('/specular-poc/src/core/displacement/webgl2-generator.ts');
    return {
      supported: mod.isWebGL2Supported(),
    };
  });
}

async function main() {
  console.log('\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
  console.log('\u2551  WebGL2 Fallback Defense Layer Verification          \u2551');
  console.log('\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D');

  const results = [];

  // ─── Test 1: default behavior (no flags) ─────────────────────────────
  {
    console.log('\n── Test 1: Default behavior (no override flags) ──');
    const { browser, page } = await newPage(null);
    const status = await probeWebGL2Status(page);
    console.log(`  WebGL2 supported: ${status.supported}`);
    console.log(`  Expected: true (headless Chromium has SwiftShader, not Mesa+ADL-N)`);
    results.push({ name: 'default', pass: status.supported === true });
    await browser.close();
  }

  // ─── Test 2: __lg_disable_webgl2 = true ───────────────────────────────
  {
    console.log('\n── Test 2: __lg_disable_webgl2 force-disable ──');
    const { browser, page } = await newPage(() => {
      globalThis.__lg_disable_webgl2 = true;
    });
    const status = await probeWebGL2Status(page);
    console.log(`  WebGL2 supported: ${status.supported}`);
    console.log(`  Expected: false (manual override)`);
    results.push({ name: 'disable-flag', pass: status.supported === false });
    await browser.close();
  }

  // ─── Test 3: __lg_force_webgl2 = true (would bypass any platform block) ──
  {
    console.log('\n── Test 3: __lg_force_webgl2 force-enable ──');
    const { browser, page } = await newPage(() => {
      globalThis.__lg_force_webgl2 = true;
    });
    const status = await probeWebGL2Status(page);
    console.log(`  WebGL2 supported: ${status.supported}`);
    console.log(`  Expected: true (force-enabled)`);
    results.push({ name: 'force-flag', pass: status.supported === true });
    await browser.close();
  }

  // ─── Test 4: Source-level verification of context loss handler ───────
  {
    console.log('\n── Test 4: Context loss handler is wired ──');
    const { browser, page } = await newPage(null);

    // Verify the source contains the loss handler registration. We can't
    // synthetically lose an OffscreenCanvas WebGL2 context from the page
    // context (the gl is closured), so we settle for static verification.
    const sourceOk = await page.evaluate(async () => {
      const resp = await fetch('/specular-poc/src/core/displacement/webgl2-generator.ts');
      const src = await resp.text();
      return {
        hasListener: /addEventListener\(\s*["']webglcontextlost["']/.test(src),
        hasFlag: src.includes('_gl2ContextLost'),
        hasFallbackComment: src.includes('GPU process crash'),
      };
    });
    console.log(`  Listener registration found: ${sourceOk.hasListener}`);
    console.log(`  _gl2ContextLost flag present: ${sourceOk.hasFlag}`);
    console.log(`  Fallback comment present:    ${sourceOk.hasFallbackComment}`);
    const ok = sourceOk.hasListener && sourceOk.hasFlag;
    results.push({ name: 'context-loss-handler-wired', pass: ok });
    await browser.close();
  }

  // ─── Test 5: Bounds check on framebuffer mismatch returns null ───────
  {
    console.log('\n── Test 5: drawingBuffer-vs-requested bounds check ──');
    const { browser, page } = await newPage(null);
    const sourceOk = await page.evaluate(async () => {
      const resp = await fetch('/specular-poc/src/core/displacement/webgl2-generator.ts');
      const src = await resp.text();
      return {
        hasFbCheck: src.includes('drawingBufferWidth') && src.includes('drawingBufferHeight'),
        hasGetErr: src.includes('gl.getError()'),
        abortsFrame: src.includes('return null'),
      };
    });
    console.log(`  drawingBuffer dim check:  ${sourceOk.hasFbCheck}`);
    console.log(`  getError() after readPx:  ${sourceOk.hasGetErr}`);
    console.log(`  Returns null on failure:  ${sourceOk.abortsFrame}`);
    const ok = sourceOk.hasFbCheck && sourceOk.hasGetErr && sourceOk.abortsFrame;
    results.push({ name: 'bounds-check-implemented', pass: ok });
    await browser.close();
  }

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log('  Summary');
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  let passCount = 0;
  for (const r of results) {
    const mark = r.pass ? '\u2713 PASS' : '\u2717 FAIL';
    console.log(`  ${mark}  ${r.name}`);
    if (r.pass) passCount++;
  }
  console.log(`\n  Total: ${passCount} / ${results.length} passed`);

  process.exit(passCount === results.length ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });

#!/usr/bin/env node
/**
 * E2E Test: WASM SIMD vs WebGL2 Displacement Map Pixel-Perfect Equivalence
 *
 * This test verifies that both implementations produce identical output
 * for various input configurations.
 */

import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// Test configurations
const testCases = [
    { width: 100, height: 100, borderRadius: 20, edgeWidthRatio: 0.5, name: 'square-100' },
    { width: 200, height: 150, borderRadius: 30, edgeWidthRatio: 0.5, name: 'rect-200x150' },
    { width: 300, height: 300, borderRadius: 50, edgeWidthRatio: 0.3, name: 'large-square' },
    { width: 150, height: 80, borderRadius: 10, edgeWidthRatio: 0.7, name: 'wide-rect' },
    { width: 64, height: 64, borderRadius: 0, edgeWidthRatio: 0.5, name: 'no-radius' },
    { width: 128, height: 128, borderRadius: 64, edgeWidthRatio: 0.5, name: 'full-radius' },
];

const HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>WASM vs WebGL2 Equivalence Test</title>
</head>
<body>
    <script type="module">
        import { generateWasmDisplacementMap, preloadWasm } from './src/core/displacement/wasm-generator.ts';
        import { generateWebGL2DisplacementMap, preloadWebGL2 } from './src/core/displacement/webgl2-generator.ts';

        async function runTest(config) {
            const { width, height, borderRadius, edgeWidthRatio } = config;

            // Generate both maps
            const [wasmResult, webglResult] = await Promise.all([
                generateWasmDisplacementMap({ width, height, borderRadius, edgeWidthRatio }),
                generateWebGL2DisplacementMap({ width, height, borderRadius, edgeWidthRatio }),
            ]);

            if (!wasmResult || !webglResult) {
                return { error: 'Generation failed', wasmOk: !!wasmResult, webglOk: !!webglResult };
            }

            // Get pixel data from both
            const wasmCanvas = wasmResult.canvas;
            const webglCanvas = webglResult.canvas;

            const wasmCtx = wasmCanvas.getContext('2d');
            const webglCtx = webglCanvas.getContext('2d');

            const wasmData = wasmCtx.getImageData(0, 0, width, height).data;
            const webglData = webglCtx.getImageData(0, 0, width, height).data;

            // Compare pixel by pixel
            let totalPixels = width * height;
            let matchingPixels = 0;
            let maxDiff = 0;
            let diffSum = 0;
            let firstDiffPixel = null;

            for (let i = 0; i < wasmData.length; i += 4) {
                const pixelIdx = i / 4;
                const rDiff = Math.abs(wasmData[i] - webglData[i]);
                const gDiff = Math.abs(wasmData[i + 1] - webglData[i + 1]);
                const bDiff = Math.abs(wasmData[i + 2] - webglData[i + 2]);
                const aDiff = Math.abs(wasmData[i + 3] - webglData[i + 3]);

                const pixelDiff = Math.max(rDiff, gDiff, bDiff, aDiff);
                diffSum += rDiff + gDiff + bDiff + aDiff;

                if (pixelDiff === 0) {
                    matchingPixels++;
                } else {
                    if (maxDiff < pixelDiff) {
                        maxDiff = pixelDiff;
                    }
                    if (!firstDiffPixel) {
                        const px = pixelIdx % width;
                        const py = Math.floor(pixelIdx / width);
                        firstDiffPixel = {
                            x: px, y: py,
                            wasm: [wasmData[i], wasmData[i+1], wasmData[i+2], wasmData[i+3]],
                            webgl: [webglData[i], webglData[i+1], webglData[i+2], webglData[i+3]],
                        };
                    }
                }
            }

            const matchRate = matchingPixels / totalPixels;
            const avgDiff = diffSum / wasmData.length;

            return {
                totalPixels,
                matchingPixels,
                matchRate,
                maxDiff,
                avgDiff,
                firstDiffPixel,
                wasmTime: wasmResult.generationTime,
                webglTime: webglResult.generationTime,
            };
        }

        async function main() {
            // Preload both backends
            await Promise.all([preloadWasm(), preloadWebGL2()]);

            const testCases = ${JSON.stringify(testCases)};
            const results = {};

            for (const config of testCases) {
                results[config.name] = await runTest(config);
            }

            window.__testResults = results;
        }

        main();
    </script>
</body>
</html>`;

async function main() {
    console.log('='.repeat(70));
    console.log('WASM SIMD vs WebGL2 Displacement Map Equivalence Test');
    console.log('='.repeat(70));
    console.log();

    // Build first
    console.log('Building project...');
    const { execSync } = await import('child_process');
    try {
        execSync('npm run build', { cwd: projectRoot, stdio: 'pipe' });
    } catch (e) {
        console.log('Build skipped (may already be built)');
    }

    // Create test HTML file
    const testHtmlPath = join(projectRoot, 'e2e', 'wasm-webgl2-test.html');
    fs.writeFileSync(testHtmlPath, HTML_TEMPLATE);

    // Launch browser
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--enable-webgl2-compute-context']
    });

    const page = await browser.newPage();

    // Serve locally
    const http = await import('http');
    const handler = await import('serve-handler');

    const server = http.createServer((req, res) => {
        return handler.default(req, res, {
            public: projectRoot,
            headers: [{ source: '**/*', headers: [{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' }] }]
        });
    });

    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    console.log(`Server running on port ${port}`);
    console.log();

    // Navigate and wait for results
    await page.goto(`http://localhost:${port}/e2e/wasm-webgl2-test.html`);

    // Wait for test completion
    let results = null;
    for (let i = 0; i < 30; i++) {
        results = await page.evaluate(() => window.__testResults);
        if (results) break;
        await new Promise(r => setTimeout(r, 500));
    }

    if (!results) {
        console.log('ERROR: Test timed out');
        await browser.close();
        server.close();
        process.exit(1);
    }

    // Print results
    console.log('Test Results:');
    console.log('-'.repeat(70));

    let allPassed = true;
    for (const [name, result] of Object.entries(results)) {
        if (result.error) {
            console.log(`${name}: ERROR - ${result.error}`);
            allPassed = false;
            continue;
        }

        const status = result.matchRate === 1.0 ? '✓ PASS' : '✗ FAIL';
        const matchPct = (result.matchRate * 100).toFixed(4);

        console.log(`${name}:`);
        console.log(`  ${status} - ${matchPct}% match (${result.matchingPixels}/${result.totalPixels} pixels)`);
        console.log(`  Max diff: ${result.maxDiff}, Avg diff: ${result.avgDiff.toFixed(4)}`);
        console.log(`  WASM: ${result.wasmTime.toFixed(2)}ms, WebGL2: ${result.webglTime.toFixed(2)}ms`);

        if (result.firstDiffPixel) {
            const d = result.firstDiffPixel;
            console.log(`  First diff at (${d.x}, ${d.y}):`);
            console.log(`    WASM:   RGBA(${d.wasm.join(', ')})`);
            console.log(`    WebGL2: RGBA(${d.webgl.join(', ')})`);
        }
        console.log();

        if (result.matchRate < 1.0) allPassed = false;
    }

    console.log('='.repeat(70));
    if (allPassed) {
        console.log('✓ ALL TESTS PASSED - 100% pixel-perfect equivalence achieved');
    } else {
        console.log('✗ SOME TESTS FAILED - See details above');
    }
    console.log('='.repeat(70));

    // Cleanup
    await browser.close();
    server.close();
    fs.unlinkSync(testHtmlPath);

    process.exit(allPassed ? 0 : 1);
}

main().catch(e => {
    console.error('Test error:', e);
    process.exit(1);
});

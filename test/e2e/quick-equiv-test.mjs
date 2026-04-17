import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);

// Start vite dev server
const vite = spawn('npx', ['vite', '--port', '5174'], { 
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe']
});

let serverReady = false;
vite.stdout.on('data', d => { 
    if (d.toString().includes('ready')) serverReady = true; 
});

for (let i = 0; i < 30 && !serverReady; i++) {
    await new Promise(r => setTimeout(r, 500));
}

console.log('Vite server ready, launching browser...');

const browser = await puppeteer.launch({ 
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
    ]
});
const page = await browser.newPage();

await page.goto('http://localhost:5174/e2e/wasm-webgl2-quick-test.html');

let results = null;
for (let i = 0; i < 60 && !results; i++) {
    results = await page.evaluate(() => window.__testResults);
    await new Promise(r => setTimeout(r, 250));
}

await browser.close();
vite.kill();

if (!results) {
    console.log('ERROR: Test timed out');
    process.exit(1);
}

console.log('\n' + '='.repeat(70));
console.log('WASM vs WebGL2 Quadrant Equivalence Results');
console.log('='.repeat(70) + '\n');

let allPass = true;
for (const r of results) {
    if (r.error) {
        console.log(`${r.size}: ERROR (WASM: ${r.wasmOk}, WebGL2: ${r.webglOk})`);
        allPass = false;
        continue;
    }
    const pct = (r.match / r.total * 100).toFixed(2);
    const status = r.match === r.total ? '✓ PASS' : '✗ FAIL';
    console.log(`${r.size}: ${status} ${pct}% (${r.match}/${r.total}) max_diff=${r.maxDiff}`);
    if (r.firstDiff) {
        const d = r.firstDiff;
        console.log(`  First diff (${d.x},${d.y}): WASM=${JSON.stringify(d.wasm)} WebGL2=${JSON.stringify(d.webgl)}`);
    }
    if (r.match !== r.total) allPass = false;
}

console.log('\n' + '='.repeat(70));
console.log(allPass ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED');
console.log('='.repeat(70));

process.exit(allPass ? 0 : 1);

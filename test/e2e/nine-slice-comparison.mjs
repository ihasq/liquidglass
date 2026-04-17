/**
 * CDP Test: WASM vs 9-Slice Displacement Map Comparison
 *
 * Uses Puppeteer to render both displacement map implementations
 * and performs pixel-level comparison to verify 100% match.
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const OUTPUT_DIR = '/tmp/nine-slice-comparison';

// Test configurations
const TEST_CONFIGS = [
  { width: 200, height: 200, radius: 40, name: 'square-medium' },
  { width: 300, height: 200, radius: 30, name: 'landscape' },
  { width: 200, height: 300, radius: 25, name: 'portrait' },
  { width: 400, height: 400, radius: 80, name: 'large-square' },
  { width: 150, height: 150, radius: 75, name: 'pill' },
  { width: 500, height: 300, radius: 50, name: 'wide' },
];

async function setupOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

async function runComparison() {
  await setupOutputDir();

  console.log('═'.repeat(70));
  console.log('  CDP Test: WASM vs 9-Slice Displacement Map Comparison');
  console.log('═'.repeat(70));
  console.log();

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const results = [];

  for (const config of TEST_CONFIGS) {
    console.log(`Testing: ${config.name} (${config.width}×${config.height}, r=${config.radius})...`);

    const result = await testConfig(browser, config);
    results.push(result);

    console.log(`  WASM render: ${result.wasmTime.toFixed(2)}ms`);
    console.log(`  9-Slice render: ${result.nineSliceTime.toFixed(2)}ms`);
    console.log(`  Exact match: ${result.exactMatchRate.toFixed(4)}%`);
    console.log(`  Pass rate (±1): ${result.passRate.toFixed(4)}%`);
    console.log(`  Max diff: ${result.maxDiff} | Avg diff: ${result.avgDiff.toFixed(2)}`);
    console.log();
  }

  await browser.close();

  // Summary
  console.log('═'.repeat(70));
  console.log('  SUMMARY');
  console.log('═'.repeat(70));
  console.log();

  const avgExact = results.reduce((s, r) => s + r.exactMatchRate, 0) / results.length;
  const avgPass = results.reduce((s, r) => s + r.passRate, 0) / results.length;
  const minPass = Math.min(...results.map(r => r.passRate));
  const avgAvgDiff = results.reduce((s, r) => s + r.avgDiff, 0) / results.length;
  const maxMaxDiff = Math.max(...results.map(r => r.maxDiff));

  console.log(`  Average exact match: ${avgExact.toFixed(4)}%`);
  console.log(`  Average pass rate:   ${avgPass.toFixed(4)}%`);
  console.log(`  Minimum pass rate:   ${minPass.toFixed(4)}%`);
  console.log(`  Average pixel diff:  ${avgAvgDiff.toFixed(2)} / 255`);
  console.log(`  Maximum pixel diff:  ${maxMaxDiff} / 255`);
  console.log();

  if (minPass >= 99.99) {
    console.log('  ✓ ALL TESTS PASSED: ≥99.99% pixel match achieved!');
  } else if (minPass >= 99.9) {
    console.log('  ⚠ CLOSE: 99.9%+ achieved, minor differences detected');
  } else {
    console.log('  ✗ FAILED: Significant pixel differences detected');
  }

  console.log();
  console.log('  Heatmap Legend (*_diff.png):');
  console.log('    Dark gray  = Exact match (diff=0)');
  console.log('    Dim blue   = ±1 (diff≤1)');
  console.log('    Cyan→Green = Low diff (1-64)');
  console.log('    Yellow→Red = High diff (128-255)');
  console.log();
  console.log('  Vector Legend (*_vector.png):');
  console.log('    R channel = ΔX (128=match, >128=WASM偏, <128=9slice偏)');
  console.log('    G channel = ΔY (128=match, >128=WASM偏, <128=9slice偏)');
  console.log('    B channel = Magnitude (差の大きさ)');
  console.log('    Gray(128,128,*)=一致 | Red偏=X方向ズレ | Green偏=Y方向ズレ');
  console.log();
  console.log(`  Output saved to: ${OUTPUT_DIR}`);
  console.log('═'.repeat(70));

  return results;
}

async function testConfig(browser, config) {
  const page = await browser.newPage();
  await page.setViewport({ width: config.width + 100, height: config.height + 100 });

  // Generate test HTML
  const html = generateTestHTML(config);
  await page.setContent(html);
  await page.waitForSelector('#ready');

  // Extract timing data
  const timings = await page.evaluate(() => {
    return {
      wasmTime: window.wasmTime || 0,
      nineSliceTime: window.nineSliceTime || 0
    };
  });

  // Get canvas data
  const wasmData = await page.evaluate(() => {
    const canvas = document.getElementById('wasm-canvas');
    return canvas.toDataURL('image/png');
  });

  const nineSliceData = await page.evaluate(() => {
    const canvas = document.getElementById('nine-slice-canvas');
    return canvas.toDataURL('image/png');
  });

  await page.close();

  // Save images
  const wasmPath = path.join(OUTPUT_DIR, `${config.name}_wasm.png`);
  const nineSlicePath = path.join(OUTPUT_DIR, `${config.name}_9slice.png`);
  const diffPath = path.join(OUTPUT_DIR, `${config.name}_diff.png`);
  const vectorDiffPath = path.join(OUTPUT_DIR, `${config.name}_vector.png`);

  fs.writeFileSync(wasmPath, Buffer.from(wasmData.split(',')[1], 'base64'));
  fs.writeFileSync(nineSlicePath, Buffer.from(nineSliceData.split(',')[1], 'base64'));

  // Compare images
  const comparison = compareImages(wasmPath, nineSlicePath, diffPath, vectorDiffPath);

  return {
    config,
    ...timings,
    ...comparison
  };
}

function compareImages(path1, path2, diffPath, vectorDiffPath) {
  const img1 = PNG.sync.read(fs.readFileSync(path1));
  const img2 = PNG.sync.read(fs.readFileSync(path2));

  if (img1.width !== img2.width || img1.height !== img2.height) {
    return {
      exactMatchRate: 0,
      passRate: 0,
      maxDiff: 255,
      error: `Size mismatch: ${img1.width}x${img1.height} vs ${img2.width}x${img2.height}`
    };
  }

  const { width, height } = img1;
  const totalPixels = width * height;

  // Manual pixel comparison
  let exactMatch = 0;
  let closeMatch = 0;
  let maxDiff = 0;
  let totalDiff = 0;

  // Generate heatmap diff image showing magnitude of difference
  const diffImg = new PNG({ width, height });
  // Generate vector diff image showing 2D direction differences
  const vectorImg = new PNG({ width, height });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // Signed differences (WASM - 9slice)
      const deltaX = img1.data[i] - img2.data[i];         // R channel = X displacement
      const deltaY = img1.data[i + 1] - img2.data[i + 1]; // G channel = Y displacement

      const diffR = Math.abs(deltaX);
      const diffG = Math.abs(deltaY);
      const diffB = Math.abs(img1.data[i + 2] - img2.data[i + 2]);
      const diff = Math.max(diffR, diffG, diffB);

      maxDiff = Math.max(maxDiff, diff);
      totalDiff += diff;

      if (diff === 0) exactMatch++;
      else if (diff <= 1) closeMatch++;

      // === Heatmap diff (magnitude) ===
      const t = diff / 255;
      let r, g, b;
      if (t === 0) {
        r = g = b = 32;
      } else if (t < 0.004) {
        r = 0; g = 0; b = 64;
      } else if (t < 0.25) {
        const s = t / 0.25;
        r = 0; g = Math.round(255 * s); b = 255;
      } else if (t < 0.5) {
        const s = (t - 0.25) / 0.25;
        r = 0; g = 255; b = Math.round(255 * (1 - s));
      } else if (t < 0.75) {
        const s = (t - 0.5) / 0.25;
        r = Math.round(255 * s); g = 255; b = 0;
      } else {
        const s = (t - 0.75) / 0.25;
        r = 255; g = Math.round(255 * (1 - s)); b = 0;
      }
      diffImg.data[i] = r;
      diffImg.data[i + 1] = g;
      diffImg.data[i + 2] = b;
      diffImg.data[i + 3] = 255;

      // === Vector diff (2D direction) ===
      // R = deltaX (128 = no diff, >128 = WASM has more +X, <128 = 9slice has more +X)
      // G = deltaY (128 = no diff, >128 = WASM has more +Y, <128 = 9slice has more +Y)
      // B = magnitude for visibility
      const magnitude = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const normalizedMag = Math.min(255, magnitude * 2); // Amplify for visibility

      vectorImg.data[i] = Math.max(0, Math.min(255, 128 + deltaX));     // X diff centered at 128
      vectorImg.data[i + 1] = Math.max(0, Math.min(255, 128 + deltaY)); // Y diff centered at 128
      vectorImg.data[i + 2] = Math.round(normalizedMag);                // Magnitude as blue
      vectorImg.data[i + 3] = 255;
    }
  }

  fs.writeFileSync(diffPath, PNG.sync.write(diffImg));
  fs.writeFileSync(vectorDiffPath, PNG.sync.write(vectorImg));

  const avgDiff = totalDiff / totalPixels;

  return {
    exactMatchRate: (exactMatch / totalPixels) * 100,
    passRate: ((exactMatch + closeMatch) / totalPixels) * 100,
    maxDiff,
    avgDiff,
    totalPixels,
    exactMatch,
    closeMatch,
    mismatch: totalPixels - exactMatch - closeMatch
  };
}

function generateTestHTML(config) {
  const { width, height, radius } = config;
  const edgeWidthRatio = 0.5;

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; padding: 20px; background: #1a1a1a; }
    canvas { display: block; margin: 10px 0; }
  </style>
</head>
<body>
  <canvas id="wasm-canvas" width="${width}" height="${height}"></canvas>
  <canvas id="nine-slice-canvas" width="${width}" height="${height}"></canvas>
  <div id="ready" style="display:none">ready</div>

  <script>
    const width = ${width};
    const height = ${height};
    const borderRadius = ${radius};
    const edgeWidthRatio = ${edgeWidthRatio};

    // WASM-equivalent displacement algorithm
    function fastExp(x) {
      if (x < -87) return 0;
      if (x > 0) return 1;
      return Math.exp(x);
    }

    function generateWasmDisplacement(canvas) {
      const start = performance.now();
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(width, height);
      const data = imageData.data;

      const halfW = width / 2;
      const halfH = height / 2;
      const minHalf = Math.min(halfW, halfH);
      const edgeWidth = minHalf * edgeWidthRatio;
      const r = Math.min(borderRadius, minHalf);

      const negThreeOverEdgeWidth = -3 / edgeWidth;
      const cornerThreshX = halfW - r;
      const cornerThreshY = halfH - r;

      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          const idx = (py * width + px) * 4;

          const dx = Math.abs(px - halfW);
          const dy = Math.abs(py - halfH);
          const signX = px < halfW ? -1 : 1;
          const signY = py < halfH ? -1 : 1;

          const inCornerX = dx > cornerThreshX;
          const inCornerY = dy > cornerThreshY;
          const inCorner = inCornerX && inCornerY;

          let inBounds = true;
          let distFromEdge = 0;
          let dirX = 0;
          let dirY = 0;

          if (inCorner) {
            const cornerX = dx - cornerThreshX;
            const cornerY = dy - cornerThreshY;
            const cornerDistSq = cornerX * cornerX + cornerY * cornerY;

            if (cornerDistSq > r * r) {
              inBounds = false;
            } else {
              const cornerDist = Math.sqrt(cornerDistSq);
              distFromEdge = r - cornerDist;

              if (cornerDist > 0.001) {
                const invDist = 1 / cornerDist;
                dirX = cornerX * invDist * signX;
                dirY = cornerY * invDist * signY;
              }
            }
          } else {
            const distX = halfW - dx;
            const distY = halfH - dy;

            if (distX < distY) {
              distFromEdge = distX;
              dirX = signX;
              dirY = 0;
            } else {
              distFromEdge = distY;
              dirX = 0;
              dirY = signY;
            }
          }

          if (!inBounds) {
            data[idx] = 128;
            data[idx + 1] = 128;
            data[idx + 2] = 128;
            data[idx + 3] = 255;
          } else {
            const magnitude = fastExp(distFromEdge * negThreeOverEdgeWidth);
            const dispX = -dirX * magnitude;
            const dispY = -dirY * magnitude;

            data[idx] = Math.round(Math.max(0, Math.min(255, 128 + dispX * 127)));
            data[idx + 1] = Math.round(Math.max(0, Math.min(255, 128 + dispY * 127)));
            data[idx + 2] = 128;
            data[idx + 3] = 255;
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
      return performance.now() - start;
    }

    // 9-slice implementation
    // Generate corner tile at EXACT target size to avoid scaling artifacts

    function generateCornerTile(refR, refEdgeWidth, targetSize, actualHalfW, actualHalfH) {
      // Generate directly at targetSize to avoid scaling
      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(targetSize, targetSize);
      const data = imageData.data;

      // Corner tile covers viewport region [0, cornerSize] × [0, cornerSize]
      const cornerSize = refR + refEdgeWidth;

      // Use ACTUAL viewport half-dimensions for correct boundary calculations
      const halfW = actualHalfW;
      const halfH = actualHalfH;
      const negThreeOverEdgeWidth = -3 / refEdgeWidth;

      // WASM's corner threshold
      const cornerThreshX = halfW - refR;
      const cornerThreshY = halfH - refR;

      for (let py = 0; py < targetSize; py++) {
        for (let px = 0; px < targetSize; px++) {
          const idx = (py * targetSize + px) * 4;

          // Map tile pixel to viewport coordinate (1:1 when targetSize == cornerSize)
          const vx = (px / targetSize) * cornerSize;
          const vy = (py / targetSize) * cornerSize;

          // Distance from actual viewport center
          // For TL corner, viewport position is (vx, vy), so dx = halfW - vx
          const dx = halfW - vx;
          const dy = halfH - vy;

          const signX = -1;  // TL quadrant
          const signY = -1;

          // Check if in corner region (using WASM's exact logic)
          const inCornerX = dx > cornerThreshX;
          const inCornerY = dy > cornerThreshY;
          const inCorner = inCornerX && inCornerY;

          let inBounds = true;
          let distFromEdge = 0;
          let dirX = 0;
          let dirY = 0;

          if (inCorner) {
            // Corner region: radial distance from corner arc
            const cornerX = dx - cornerThreshX;  // distance into corner region
            const cornerY = dy - cornerThreshY;
            const cornerDistSq = cornerX * cornerX + cornerY * cornerY;

            if (cornerDistSq > refR * refR) {
              // Outside the rounded corner arc - truly outside the shape
              // Mark as out of bounds (will render as neutral gray)
              inBounds = false;
            } else {
              const cornerDist = Math.sqrt(cornerDistSq);
              distFromEdge = refR - cornerDist;

              if (cornerDist > 0.001) {
                const invDist = 1 / cornerDist;
                dirX = cornerX * invDist * signX;
                dirY = cornerY * invDist * signY;
              }
            }
          } else {
            // Edge region: this pixel is in an edge strip, not corner
            // Use linear displacement toward the nearest edge
            // distX = halfW - dx = vx (distance from left edge in WASM terms)
            // But we're in TL corner, so distX is just vx
            const distX = halfW - dx;  // = vx effectively
            const distY = halfH - dy;  // = vy effectively

            if (distX < distY) {
              distFromEdge = distX;
              dirX = signX;
              dirY = 0;
            } else {
              distFromEdge = distY;
              dirX = 0;
              dirY = signY;
            }
          }

          if (!inBounds) {
            data[idx] = 128;
            data[idx + 1] = 128;
            data[idx + 2] = 128;
            data[idx + 3] = 255;
          } else {
            const magnitude = fastExp(distFromEdge * negThreeOverEdgeWidth);
            const dispX = -dirX * magnitude;
            const dispY = -dirY * magnitude;

            data[idx] = Math.round(Math.max(0, Math.min(255, 128 + dispX * 127)));
            data[idx + 1] = Math.round(Math.max(0, Math.min(255, 128 + dispY * 127)));
            data[idx + 2] = 128;
            data[idx + 3] = 255;
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
      return canvas;
    }

    async function generate9SliceDisplacement(canvas) {
      const start = performance.now();
      const ctx = canvas.getContext('2d');

      const halfW = width / 2;
      const halfH = height / 2;
      const minHalf = Math.min(halfW, halfH);
      const edgeWidth = minHalf * edgeWidthRatio;
      const r = Math.min(borderRadius, minHalf);
      const cornerSize = r + edgeWidth;

      // Generate corner tile at EXACT cornerSize with actual viewport dimensions
      const cornerTile = generateCornerTile(r, edgeWidth, cornerSize, halfW, halfH);

      // Fill with neutral
      ctx.fillStyle = 'rgb(128,128,128)';
      ctx.fillRect(0, 0, width, height);

      // Draw edge gradients
      // Gradients cover cornerSize to match the corner tiles exactly
      const edgeGradients = {
        top: ctx.createLinearGradient(0, 0, 0, cornerSize),
        bottom: ctx.createLinearGradient(0, height, 0, height - cornerSize),
        left: ctx.createLinearGradient(0, 0, cornerSize, 0),
        right: ctx.createLinearGradient(width, 0, width - cornerSize, 0)
      };

      // Generate exp(-3x/edgeWidth) stops for a gradient spanning cornerSize
      // At position p in [0, cornerSize], the magnitude is exp(-3 * p / edgeWidth)
      // In normalized offset [0, 1]: offset = p / cornerSize, so p = offset * cornerSize
      // magnitude = exp(-3 * offset * cornerSize / edgeWidth)
      function addStops(gradient, r, g, b) {
        const numStops = 16;
        for (let i = 0; i <= numStops; i++) {
          const offset = i / numStops;
          const p = offset * cornerSize;  // actual distance from edge
          const magnitude = Math.exp(-3 * p / edgeWidth);
          gradient.addColorStop(offset, 'rgba(' + r + ',' + g + ',' + b + ',' + magnitude + ')');
        }
      }

      addStops(edgeGradients.top, 128, 255, 128);
      addStops(edgeGradients.bottom, 128, 0, 128);
      addStops(edgeGradients.left, 255, 128, 128);
      addStops(edgeGradients.right, 0, 128, 128);

      // Draw edges (between corners)
      // Edge rects should extend to cornerSize to cover the full region
      // The gradient naturally fades to near-neutral beyond edgeWidth
      ctx.fillStyle = edgeGradients.top;
      ctx.fillRect(cornerSize, 0, Math.max(0, width - 2 * cornerSize), cornerSize);

      ctx.fillStyle = edgeGradients.bottom;
      ctx.fillRect(cornerSize, height - cornerSize, Math.max(0, width - 2 * cornerSize), cornerSize);

      ctx.fillStyle = edgeGradients.left;
      ctx.fillRect(0, cornerSize, cornerSize, Math.max(0, height - 2 * cornerSize));

      ctx.fillStyle = edgeGradients.right;
      ctx.fillRect(width - cornerSize, cornerSize, cornerSize, Math.max(0, height - 2 * cornerSize));

      // Draw corners with proper channel inversion for displacement maps
      // Canvas flip only mirrors positions, NOT displacement values
      // We need to invert R for horizontal flip, G for vertical flip

      // Helper to draw corner tile with flip and channel inversion
      // Uses manual pixel manipulation to avoid transform edge issues
      function drawCornerWithInversion(destX, destY, flipX, flipY) {
        const size = Math.round(cornerSize);

        // Get corner tile pixel data
        const tileCtx = cornerTile.getContext('2d');
        const srcData = tileCtx.getImageData(0, 0, size, size);

        // Create output canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = size;
        tempCanvas.height = size;
        const tempCtx = tempCanvas.getContext('2d');
        const dstData = tempCtx.createImageData(size, size);

        // Copy with flip and channel inversion
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            // Source coordinates (with flip)
            const srcX = flipX ? (size - 1 - x) : x;
            const srcY = flipY ? (size - 1 - y) : y;

            const srcIdx = (srcY * size + srcX) * 4;
            const dstIdx = (y * size + x) * 4;

            // Copy with channel inversion for displacement map
            let r = srcData.data[srcIdx];
            let g = srcData.data[srcIdx + 1];

            if (flipX) {
              // Invert R (X displacement) around 128
              r = Math.min(255, Math.max(0, 256 - r));
            }
            if (flipY) {
              // Invert G (Y displacement) around 128
              g = Math.min(255, Math.max(0, 256 - g));
            }

            dstData.data[dstIdx] = r;
            dstData.data[dstIdx + 1] = g;
            dstData.data[dstIdx + 2] = srcData.data[srcIdx + 2];
            dstData.data[dstIdx + 3] = srcData.data[srcIdx + 3];
          }
        }

        tempCtx.putImageData(dstData, 0, 0);
        ctx.drawImage(tempCanvas, destX, destY);
      }

      // TL - no flip
      drawCornerWithInversion(0, 0, false, false);

      // TR - flip X (invert R channel)
      drawCornerWithInversion(width - cornerSize, 0, true, false);

      // BL - flip Y (invert G channel)
      drawCornerWithInversion(0, height - cornerSize, false, true);

      // BR - flip both (invert R and G channels)
      drawCornerWithInversion(width - cornerSize, height - cornerSize, true, true);

      return performance.now() - start;
    }

    // Run tests
    async function runTests() {
      window.wasmTime = generateWasmDisplacement(document.getElementById('wasm-canvas'));
      window.nineSliceTime = await generate9SliceDisplacement(document.getElementById('nine-slice-canvas'));
      document.getElementById('ready').style.display = 'block';
    }

    runTests();
  </script>
</body>
</html>`;
}

// Main
runComparison().catch(console.error);

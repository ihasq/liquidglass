/**
 * True Displacement Map Formula Derivation
 * Based on reverse engineering of kube.io's actual implementation
 */

import { PNG } from 'pngjs';
import fs from 'fs';

async function loadMap(path) {
  const data = fs.readFileSync(path);
  const png = PNG.sync.read(data);
  return {
    width: png.width,
    height: png.height,
    getPixel(x, y) {
      const idx = (y * png.width + x) * 4;
      return {
        r: png.data[idx],
        g: png.data[idx + 1],
        dx: (png.data[idx] - 128) / 127,
        dy: (png.data[idx + 1] - 128) / 127
      };
    }
  };
}

// Analyze the edge falloff curve
async function analyzeEdgeFalloff() {
  const map = await loadMap('e2e/reference/kube-assets/displacement-map-searchbox.png');
  const { width, height } = map;
  const cx = Math.floor(width / 2);

  console.log('=== Edge Falloff Analysis (Searchbox) ===\n');
  console.log('Sampling vertical center line (x = center):\n');
  console.log('dist_from_top\tdy\t\tnormalized_mag');
  console.log('-'.repeat(50));

  // Find max magnitude for normalization
  let maxMag = 0;
  for (let y = 0; y < height; y++) {
    const p = map.getPixel(cx, y);
    maxMag = Math.max(maxMag, Math.abs(p.dy));
  }

  // Sample from top edge
  const samples = [];
  for (let y = 0; y < Math.floor(height / 2); y++) {
    const p = map.getPixel(cx, y);
    const distFromEdge = y;
    const normalizedMag = Math.abs(p.dy) / maxMag;
    samples.push({ dist: distFromEdge, mag: normalizedMag, raw: p.dy });

    if (y < 30 || y % 10 === 0) {
      console.log(`${distFromEdge}\t\t${p.dy.toFixed(3)}\t\t${normalizedMag.toFixed(3)}`);
    }
  }

  // Fit the falloff curve
  console.log('\n=== Curve Fitting ===\n');

  // Test different falloff models
  const models = [
    {
      name: 'Linear',
      fn: (d, E) => Math.max(0, 1 - d / E)
    },
    {
      name: 'Quadratic',
      fn: (d, E) => Math.max(0, Math.pow(1 - d / E, 2))
    },
    {
      name: 'Cubic',
      fn: (d, E) => Math.max(0, Math.pow(1 - d / E, 3))
    },
    {
      name: 'Squircle',
      fn: (d, E) => {
        const t = Math.min(1, d / E);
        return Math.pow(1 - Math.pow(t, 4), 0.25);
      }
    },
    {
      name: 'Kube-style (saturation + cubic)',
      fn: (d, E) => {
        if (d <= 2) return 1.0;  // Saturation zone
        if (d <= 4) return 1.0 - (d - 2) / 2 * 0.1;  // Transition
        const t = (d - 4) / (E - 4);
        if (t >= 1) return 0;
        return Math.pow(1 - t, 3);  // Cubic falloff
      }
    },
    {
      name: 'Exponential decay',
      fn: (d, E) => Math.exp(-3 * d / E)
    }
  ];

  // Estimate edge width from data (where magnitude drops to ~5%)
  let edgeWidth = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].mag < 0.05) {
      edgeWidth = samples[i].dist;
      break;
    }
  }
  console.log(`Estimated edge width: ${edgeWidth} pixels`);
  console.log(`As percentage of half-height: ${(edgeWidth / (height / 2) * 100).toFixed(1)}%\n`);

  for (const model of models) {
    let totalError = 0;
    for (const s of samples) {
      const predicted = model.fn(s.dist, edgeWidth);
      totalError += Math.pow(predicted - s.mag, 2);
    }
    const rmse = Math.sqrt(totalError / samples.length);
    console.log(`${model.name}: RMSE = ${rmse.toFixed(4)}`);
  }

  // Best fit parameters for Kube-style
  console.log('\n=== Best Fit: Kube-style Model ===\n');

  let bestParams = { satZone: 2, transZone: 4, power: 3, error: Infinity };

  for (let sat = 1; sat <= 5; sat++) {
    for (let trans = sat + 1; trans <= 10; trans++) {
      for (let pow = 2; pow <= 5; pow += 0.5) {
        let totalError = 0;
        for (const s of samples) {
          let predicted;
          if (s.dist <= sat) {
            predicted = 1.0;
          } else if (s.dist <= trans) {
            predicted = 1.0 - (s.dist - sat) / (trans - sat) * 0.15;
          } else {
            const t = (s.dist - trans) / (edgeWidth - trans);
            predicted = t >= 1 ? 0 : Math.pow(1 - t, pow) * 0.85;
          }
          totalError += Math.pow(predicted - s.mag, 2);
        }
        const rmse = Math.sqrt(totalError / samples.length);
        if (rmse < bestParams.error) {
          bestParams = { satZone: sat, transZone: trans, power: pow, error: rmse };
        }
      }
    }
  }

  console.log(`Best parameters found:`);
  console.log(`  Saturation zone: ${bestParams.satZone} pixels`);
  console.log(`  Transition zone: ${bestParams.transZone} pixels`);
  console.log(`  Falloff power: ${bestParams.power}`);
  console.log(`  RMSE: ${bestParams.error.toFixed(4)}`);

  // Final formula
  console.log('\n' + '='.repeat(60));
  console.log('DERIVED TRUE FORMULA');
  console.log('='.repeat(60));
  console.log(`
The kube.io displacement map uses a THREE-ZONE model:

┌──────────────────────────────────────────────────────────┐
│  Zone 1: SATURATION (0-${bestParams.satZone}px from edge)                   │
│    magnitude = 1.0 (full displacement)                   │
│                                                          │
│  Zone 2: TRANSITION (${bestParams.satZone}-${bestParams.transZone}px from edge)                  │
│    magnitude = 1.0 - (d - ${bestParams.satZone}) / ${bestParams.transZone - bestParams.satZone} × 0.15       │
│    (gentle slope, ~15% drop)                             │
│                                                          │
│  Zone 3: FALLOFF (${bestParams.transZone}px - edgeWidth)                       │
│    t = (d - ${bestParams.transZone}) / (edgeWidth - ${bestParams.transZone})                │
│    magnitude = (1 - t)^${bestParams.power} × 0.85                       │
│    (cubic decay to zero)                                 │
│                                                          │
│  Beyond edgeWidth: magnitude = 0                         │
└──────────────────────────────────────────────────────────┘

Where:
  - d = distance from nearest edge (pixels)
  - edgeWidth ≈ 25% of min(width/2, height/2)
  - Direction = normalize(vector toward nearest edge)

RGB Encoding:
  R = 128 + direction.x × magnitude × 127
  G = 128 + direction.y × magnitude × 127
`);

  return { edgeWidth, bestParams };
}

// Verify direction calculation for rounded rect
async function verifyDirections() {
  const map = await loadMap('e2e/reference/kube-assets/displacement-map-searchbox.png');
  const { width, height } = map;

  console.log('\n=== Direction Verification ===\n');
  console.log('Checking if displacement points toward nearest edge:\n');

  const testPoints = [
    { x: 10, y: height / 2, expected: 'left edge → dx > 0' },
    { x: width - 10, y: height / 2, expected: 'right edge → dx < 0' },
    { x: width / 2, y: 10, expected: 'top edge → dy > 0' },
    { x: width / 2, y: height - 10, expected: 'bottom edge → dy < 0' },
    { x: 10, y: 10, expected: 'top-left corner → dx > 0, dy > 0' },
  ];

  for (const tp of testPoints) {
    const p = map.getPixel(Math.floor(tp.x), Math.floor(tp.y));
    const actual = `dx=${p.dx.toFixed(2)}, dy=${p.dy.toFixed(2)}`;
    console.log(`(${tp.x}, ${tp.y}): ${actual}`);
    console.log(`  Expected: ${tp.expected}`);
    console.log();
  }
}

async function main() {
  await analyzeEdgeFalloff();
  await verifyDirections();
}

main().catch(console.error);

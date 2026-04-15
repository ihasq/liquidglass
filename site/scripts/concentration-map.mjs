import { PNG } from 'pngjs';
import fs from 'fs';

const MOCKUP_PATH = '../../e2e/mockup/Screenshot 2026-04-16 03.26.06.png';
const SCREENSHOT_PATH = './screenshots/current.png';
const OUTPUT_PATH = './screenshots/concentration.png';

const mockup = PNG.sync.read(fs.readFileSync(MOCKUP_PATH));
const screenshot = PNG.sync.read(fs.readFileSync(SCREENSHOT_PATH));

const { width, height } = mockup;

// Step 1: Create binary mismatch map
const mismatchMap = new Array(width * height).fill(0);

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const mr = mockup.data[idx];
    const mg = mockup.data[idx + 1];
    const mb = mockup.data[idx + 2];
    const sr = screenshot.data[idx];
    const sg = screenshot.data[idx + 1];
    const sb = screenshot.data[idx + 2];

    const dist = Math.sqrt((mr-sr)**2 + (mg-sg)**2 + (mb-sb)**2);
    mismatchMap[y * width + x] = dist > 15 ? 1 : 0;
  }
}

// Step 2: Calculate concentration (mismatch density in NxN window)
const WINDOW_SIZE = 15; // 15x15 window
const HALF = Math.floor(WINDOW_SIZE / 2);

const concentrationMap = new Array(width * height).fill(0);

console.log('Calculating concentration map...');

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    let count = 0;
    let total = 0;

    for (let dy = -HALF; dy <= HALF; dy++) {
      for (let dx = -HALF; dx <= HALF; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          count += mismatchMap[ny * width + nx];
          total++;
        }
      }
    }

    // Concentration = ratio of mismatches in window
    concentrationMap[y * width + x] = count / total;
  }
}

// Step 3: Find threshold for "problematic" concentration
// Only highlight areas where concentration is significantly above average
const concentrations = concentrationMap.filter(c => c > 0);
const avgConcentration = concentrations.reduce((a, b) => a + b, 0) / concentrations.length;
const threshold = avgConcentration * 2; // Areas with 2x average concentration

console.log(`Average concentration: ${(avgConcentration * 100).toFixed(2)}%`);
console.log(`Threshold for highlighting: ${(threshold * 100).toFixed(2)}%`);

// Step 4: Generate output image
const output = new PNG({ width, height });

// Find max concentration for normalization
let maxConcentration = 0;
for (let i = 0; i < concentrationMap.length; i++) {
  if (concentrationMap[i] > maxConcentration) maxConcentration = concentrationMap[i];
}

// Find problem hotspots (areas with high concentration)
const hotspots = [];

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const concentration = concentrationMap[y * width + x];

    if (concentration > threshold) {
      // Hot area - show in red, intensity based on concentration
      const intensity = Math.min(255, Math.floor((concentration / maxConcentration) * 255));
      output.data[idx] = intensity;
      output.data[idx + 1] = 0;
      output.data[idx + 2] = 0;

      // Record hotspots
      if (concentration > threshold * 1.5) {
        hotspots.push({ x, y, concentration });
      }
    } else if (concentration > avgConcentration) {
      // Moderate - yellow
      const intensity = Math.min(255, Math.floor((concentration / threshold) * 128));
      output.data[idx] = intensity;
      output.data[idx + 1] = intensity;
      output.data[idx + 2] = 0;
    } else {
      // Good area - dark green
      output.data[idx] = 0;
      output.data[idx + 1] = 30;
      output.data[idx + 2] = 0;
    }
    output.data[idx + 3] = 255;
  }
}

fs.writeFileSync(OUTPUT_PATH, PNG.sync.write(output));

// Cluster hotspots to find distinct problem areas
console.log('\n=== PROBLEM AREA CLUSTERS ===');

// Simple clustering: group nearby hotspots
const clusters = [];
const visited = new Set();

hotspots.forEach(hs => {
  const key = `${hs.x},${hs.y}`;
  if (visited.has(key)) return;

  // Find all hotspots within 50px
  const cluster = hotspots.filter(h => {
    const dist = Math.sqrt((h.x - hs.x)**2 + (h.y - hs.y)**2);
    return dist < 50;
  });

  cluster.forEach(h => visited.add(`${h.x},${h.y}`));

  if (cluster.length > 10) {
    const avgX = Math.floor(cluster.reduce((a, h) => a + h.x, 0) / cluster.length);
    const avgY = Math.floor(cluster.reduce((a, h) => a + h.y, 0) / cluster.length);
    const maxC = Math.max(...cluster.map(h => h.concentration));
    clusters.push({ x: avgX, y: avgY, size: cluster.length, maxConcentration: maxC });
  }
});

clusters.sort((a, b) => b.maxConcentration - a.maxConcentration);

clusters.slice(0, 10).forEach((c, i) => {
  console.log(`#${i+1}: Center (${c.x}, ${c.y}), size=${c.size}, concentration=${(c.maxConcentration * 100).toFixed(1)}%`);
});

console.log(`\nConcentration map saved to: ${OUTPUT_PATH}`);

/**
 * Pixel-level comparison between WASM (atlas) and JS (canvas-generator)
 * displacement map generation.
 */

const { createCanvas } = require('canvas');

// Simulate the canvas-generator algorithm
function generateCanvasDisplacementJS(width, height, borderRadius, edgeWidthRatio) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  const centerX = width / 2;
  const centerY = height / 2;
  const maxDist = Math.min(width, height) / 2;
  const edgeWidth = maxDist * edgeWidthRatio;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // Calculate distance from edges
      const distLeft = x;
      const distRight = width - 1 - x;
      const distTop = y;
      const distBottom = height - 1 - y;

      // Apply border radius adjustment
      let effectiveRadius = borderRadius;
      let cornerDist = Infinity;

      // Check corners
      if (x < borderRadius && y < borderRadius) {
        // Top-left corner
        const dx = borderRadius - x;
        const dy = borderRadius - y;
        cornerDist = Math.sqrt(dx * dx + dy * dy) - borderRadius;
      } else if (x >= width - borderRadius && y < borderRadius) {
        // Top-right corner
        const dx = x - (width - 1 - borderRadius);
        const dy = borderRadius - y;
        cornerDist = Math.sqrt(dx * dx + dy * dy) - borderRadius;
      } else if (x < borderRadius && y >= height - borderRadius) {
        // Bottom-left corner
        const dx = borderRadius - x;
        const dy = y - (height - 1 - borderRadius);
        cornerDist = Math.sqrt(dx * dx + dy * dy) - borderRadius;
      } else if (x >= width - borderRadius && y >= height - borderRadius) {
        // Bottom-right corner
        const dx = x - (width - 1 - borderRadius);
        const dy = y - (height - 1 - borderRadius);
        cornerDist = Math.sqrt(dx * dx + dy * dy) - borderRadius;
      }

      // Minimum distance to any edge
      let minEdgeDist = Math.min(distLeft, distRight, distTop, distBottom);
      if (cornerDist < Infinity && cornerDist < 0) {
        minEdgeDist = -cornerDist; // Outside rounded corner
      } else if (cornerDist < Infinity) {
        minEdgeDist = Math.min(minEdgeDist, cornerDist > 0 ? Infinity : -cornerDist);
      }

      // Calculate displacement based on edge proximity
      let dispX = 0;
      let dispY = 0;

      if (minEdgeDist < edgeWidth) {
        const edgeFactor = 1 - (minEdgeDist / edgeWidth);
        const strength = edgeFactor * edgeFactor * 0.5; // Quadratic falloff

        // Direction away from nearest edge
        if (distLeft <= distRight && distLeft < edgeWidth) {
          dispX += strength;
        }
        if (distRight < distLeft && distRight < edgeWidth) {
          dispX -= strength;
        }
        if (distTop <= distBottom && distTop < edgeWidth) {
          dispY += strength;
        }
        if (distBottom < distTop && distBottom < edgeWidth) {
          dispY -= strength;
        }
      }

      // Convert to 0-255 range (128 = no displacement)
      const r = Math.round(128 + dispX * 127);
      const g = Math.round(128 + dispY * 127);

      data[idx] = Math.max(0, Math.min(255, r));     // R
      data[idx + 1] = Math.max(0, Math.min(255, g)); // G
      data[idx + 2] = 128;                            // B (unused)
      data[idx + 3] = 255;                            // A
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// Test parameters
const testCases = [
  { width: 200, height: 100, borderRadius: 16, edgeWidthRatio: 0.5 },
  { width: 300, height: 200, borderRadius: 24, edgeWidthRatio: 0.5 },
  { width: 100, height: 100, borderRadius: 50, edgeWidthRatio: 0.5 },
];

console.log('=== Displacement Map Pixel Test ===\n');

for (const tc of testCases) {
  console.log(`Test: ${tc.width}x${tc.height}, radius=${tc.borderRadius}, edge=${tc.edgeWidthRatio}`);

  const canvas = generateCanvasDisplacementJS(tc.width, tc.height, tc.borderRadius, tc.edgeWidthRatio);
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, tc.width, tc.height).data;

  // Sample key pixels
  const samples = [
    { name: 'center', x: Math.floor(tc.width/2), y: Math.floor(tc.height/2) },
    { name: 'top-left', x: 5, y: 5 },
    { name: 'top-center', x: Math.floor(tc.width/2), y: 5 },
    { name: 'left-center', x: 5, y: Math.floor(tc.height/2) },
  ];

  for (const s of samples) {
    const idx = (s.y * tc.width + s.x) * 4;
    console.log(`  ${s.name} (${s.x},${s.y}): R=${data[idx]} G=${data[idx+1]}`);
  }
  console.log('');
}

console.log('This JS algorithm should produce similar results to the WASM version.');
console.log('If they differ significantly, the WASM implementation needs to match.');

/**
 * Displacement Map Discontinuity Analysis
 *
 * Analyzes the mathematical discontinuities in the current displacement algorithm.
 * Uses symbolic analysis rather than fuzzy image inspection.
 */

// Simulate the current algorithm
function currentAlgorithm(px, py, width, height, borderRadius) {
  const halfW = width / 2;
  const halfH = height / 2;
  const r = Math.min(borderRadius, halfW, halfH);
  const edgeWidth = Math.min(halfW, halfH) * 0.5;

  const dx = Math.abs(px - halfW);
  const dy = Math.abs(py - halfH);

  // Check bounds
  const inCorner = dx > halfW - r && dy > halfH - r;

  if (inCorner) {
    const cornerX = dx - (halfW - r);
    const cornerY = dy - (halfH - r);
    if (cornerX * cornerX + cornerY * cornerY > r * r) {
      return { inBounds: false };
    }
  }

  let distFromEdge, dirX = 0, dirY = 0;
  let region;

  if (inCorner) {
    region = 'corner';
    const cornerX = dx - (halfW - r);
    const cornerY = dy - (halfH - r);
    const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
    distFromEdge = r - cornerDist;

    if (cornerDist > 0.001) {
      dirX = (cornerX / cornerDist) * Math.sign(px - halfW);
      dirY = (cornerY / cornerDist) * Math.sign(py - halfH);
    }
  } else {
    const distX = halfW - dx;
    const distY = halfH - dy;

    if (distX < distY) {
      region = 'edge-x';
      distFromEdge = distX;
      dirX = Math.sign(px - halfW);
    } else {
      region = 'edge-y';
      distFromEdge = distY;
      dirY = Math.sign(py - halfH);
    }
  }

  const magnitude = distFromEdge < 0 ? 0 : Math.exp(-3 * distFromEdge / edgeWidth);
  const dispX = -dirX * magnitude;
  const dispY = -dirY * magnitude;

  return { inBounds: true, region, dirX, dirY, distFromEdge, magnitude, dispX, dispY };
}

// Analyze discontinuities
function analyzeDiscontinuities(width, height, borderRadius) {
  const halfW = width / 2;
  const halfH = height / 2;
  const r = Math.min(borderRadius, halfW, halfH);

  console.log('=== Displacement Map Discontinuity Analysis ===\n');
  console.log(`Dimensions: ${width}x${height}, Border Radius: ${borderRadius}`);
  console.log(`Half dimensions: halfW=${halfW}, halfH=${halfH}, effective r=${r}\n`);

  // Critical boundaries
  console.log('--- Critical Boundaries ---\n');

  // 1. Corner region boundary
  const cornerBoundaryX = halfW - r;
  const cornerBoundaryY = halfH - r;
  console.log(`Corner region starts at: dx > ${cornerBoundaryX}, dy > ${cornerBoundaryY}`);
  console.log(`In pixel coordinates: x < ${halfW - cornerBoundaryX} or x > ${halfW + cornerBoundaryX}`);
  console.log(`                      y < ${halfH - cornerBoundaryY} or y > ${halfH + cornerBoundaryY}\n`);

  // 2. Diagonal discontinuity (distX == distY)
  console.log('--- Diagonal Discontinuity (distX == distY line) ---\n');
  console.log('The algorithm switches between edge-x and edge-y regions where distX == distY');
  console.log('This creates a 45-degree discontinuity line in each quadrant.\n');

  // Sample points along the discontinuity
  console.log('--- Discontinuity at Corner/Edge Boundary ---\n');

  // Test points just inside and outside corner boundary (first quadrant, bottom-right)
  const testY = halfH + cornerBoundaryY; // At corner boundary Y

  for (let offset = -2; offset <= 2; offset++) {
    const testX = halfW + cornerBoundaryX + offset;
    const result = currentAlgorithm(testX, testY, width, height, borderRadius);
    if (result.inBounds) {
      console.log(`  x=${testX.toFixed(1)}, y=${testY.toFixed(1)}: region=${result.region}, dir=(${result.dirX.toFixed(3)}, ${result.dirY.toFixed(3)})`);
    }
  }

  console.log('\n--- Discontinuity at Diagonal (distX == distY) ---\n');

  // Test points along the diagonal in the edge region
  const diagDist = 30; // Test at 30 pixels from center
  for (let offset = -5; offset <= 5; offset++) {
    const testX = halfW + diagDist + offset;
    const testY = halfH + diagDist - offset;
    const result = currentAlgorithm(testX, testY, width, height, borderRadius);
    if (result.inBounds) {
      console.log(`  x=${testX.toFixed(1)}, y=${testY.toFixed(1)}: region=${result.region}, dir=(${result.dirX.toFixed(3)}, ${result.dirY.toFixed(3)}), disp=(${result.dispX.toFixed(4)}, ${result.dispY.toFixed(4)})`);
    }
  }

  // Mathematical analysis
  console.log('\n=== Root Cause Analysis ===\n');
  console.log('DISCONTINUITY TYPE 1: Corner/Edge Boundary');
  console.log('  Location: Along the lines dx = halfW - r and dy = halfH - r');
  console.log('  Problem: Direction vector changes abruptly from:');
  console.log('    - Edge region: dir = (±1, 0) or (0, ±1) [axis-aligned]');
  console.log('    - Corner region: dir = radial from corner center');
  console.log('  At boundary: The radial direction at (r, 0) is (1, 0), which matches.');
  console.log('               But at (r, ε) the radial direction is (cos(θ), sin(θ))');
  console.log('               where θ = atan2(ε, r) ≈ ε/r, causing a small but visible jump.\n');

  console.log('DISCONTINUITY TYPE 2: Diagonal Line (distX == distY)');
  console.log('  Location: Along the 45° diagonal in each quadrant');
  console.log('  Problem: Hard switch between edge-x and edge-y regions');
  console.log('    - Just above diagonal: dir = (0, ±1), disp affects Y only');
  console.log('    - Just below diagonal: dir = (±1, 0), disp affects X only');
  console.log('  This creates a visible seam along the diagonal.\n');

  // Quantify the discontinuity
  console.log('=== Discontinuity Magnitude ===\n');

  const testPoints = [
    { x: halfW + 50.001, y: halfH + 50, name: 'Just right of diagonal' },
    { x: halfW + 50, y: halfH + 50.001, name: 'Just above diagonal' },
  ];

  for (const pt of testPoints) {
    const result = currentAlgorithm(pt.x, pt.y, width, height, borderRadius);
    if (result.inBounds) {
      console.log(`${pt.name}:`);
      console.log(`  Position: (${pt.x}, ${pt.y})`);
      console.log(`  Region: ${result.region}`);
      console.log(`  Direction: (${result.dirX.toFixed(4)}, ${result.dirY.toFixed(4)})`);
      console.log(`  Displacement: (${result.dispX.toFixed(6)}, ${result.dispY.toFixed(6)})`);
      console.log();
    }
  }

  console.log('=== Proposed Fix ===\n');
  console.log('The diagonal discontinuity can be eliminated by:');
  console.log('1. Using gradient-based direction instead of nearest-edge selection');
  console.log('2. Blending X and Y contributions based on relative distances');
  console.log('3. Using signed distance field (SDF) with proper gradient calculation\n');

  console.log('Correct formula for edge region direction:');
  console.log('  distX = halfW - |px - halfW|');
  console.log('  distY = halfH - |py - halfH|');
  console.log('  ');
  console.log('  // Instead of: if (distX < distY) use X else use Y');
  console.log('  // Use: blend based on inverse distances');
  console.log('  ');
  console.log('  wX = 1 / (distX + ε)');
  console.log('  wY = 1 / (distY + ε)');
  console.log('  totalW = wX + wY');
  console.log('  ');
  console.log('  dirX = (wX / totalW) * sign(px - halfW)');
  console.log('  dirY = (wY / totalW) * sign(py - halfH)');
  console.log('  distFromEdge = min(distX, distY)  // or use SDF');
}

// Run analysis with typical values
analyzeDiscontinuities(320, 200, 24);

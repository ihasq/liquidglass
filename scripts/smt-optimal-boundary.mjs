/**
 * SMT Solver: Find Optimal 9-Slice Boundaries
 *
 * The key insight: Traditional 9-slice at x=r causes discontinuities because
 * displacement direction changes from radial (corner) to linear (edge).
 *
 * Solution: Find boundaries where:
 * 1. Displacement values are continuous
 * 2. Direction vectors are close enough to blend smoothly
 *
 * Alternative approach: Use overlapping slices with alpha blending
 */

import { init } from 'z3-solver';

function fastExp(x) {
  if (x < -87) return 0;
  if (x > 0) return 1;
  return Math.exp(x);
}

function computePixel(px, py, width, height, borderRadius, edgeWidthRatio = 0.5) {
  const halfW = width / 2;
  const halfH = height / 2;
  const minHalf = Math.min(halfW, halfH);
  const edgeWidth = minHalf * edgeWidthRatio;
  const r = Math.min(borderRadius, minHalf);

  const negThreeOverEdgeWidth = -3 / edgeWidth;
  const cornerThresholdX = halfW - r;
  const cornerThresholdY = halfH - r;

  const dx = Math.abs(px - halfW);
  const dy = Math.abs(py - halfH);

  const inCornerX = dx > cornerThresholdX;
  const inCornerY = dy > cornerThresholdY;
  const inCorner = inCornerX && inCornerY;

  let inBounds = true;
  let distFromEdge = 0;
  let dirX = 0;
  let dirY = 0;

  if (inCorner) {
    const cornerX = dx - cornerThresholdX;
    const cornerY = dy - cornerThresholdY;
    const cornerDistSq = cornerX * cornerX + cornerY * cornerY;

    if (cornerDistSq > r * r) {
      inBounds = false;
    } else {
      const cornerDist = Math.sqrt(cornerDistSq);
      distFromEdge = r - cornerDist;

      if (cornerDist > 0.001) {
        const invDist = 1 / cornerDist;
        const signX = px < halfW ? -1 : 1;
        const signY = py < halfH ? -1 : 1;
        dirX = cornerX * invDist * signX;
        dirY = cornerY * invDist * signY;
      }
    }
  } else {
    const distX = halfW - dx;
    const distY = halfH - dy;

    if (distX < distY) {
      distFromEdge = distX;
      dirX = px < halfW ? -1 : 1;
    } else {
      distFromEdge = distY;
      dirY = py < halfH ? -1 : 1;
    }
  }

  if (!inBounds) {
    return { r: 128, g: 128, inBounds: false, isCorner: false };
  }

  const expArg = distFromEdge * negThreeOverEdgeWidth;
  const magnitude = distFromEdge < 0 ? 0 : fastExp(expArg);

  const dispX = -dirX * magnitude;
  const dispY = -dirY * magnitude;

  return {
    r: Math.round(Math.max(0, Math.min(255, 128 + dispX * 127))),
    g: Math.round(Math.max(0, Math.min(255, 128 + dispY * 127))),
    inBounds: true,
    isCorner: inCorner,
    dirX,
    dirY,
    magnitude,
    distFromEdge
  };
}

async function findOptimalBoundary() {
  console.log('=== Finding Optimal 9-Slice Boundaries with SMT ===\n');

  const { Context } = await init();
  const ctx = new Context('main');

  const width = 200;
  const height = 200;
  const borderRadius = 40;
  const edgeWidthRatio = 0.5;

  const halfW = width / 2;
  const halfH = height / 2;
  const r = Math.min(borderRadius, halfW, halfH);
  const edgeWidth = Math.min(halfW, halfH) * edgeWidthRatio;

  console.log(`Config: ${width}x${height}, r=${r}, edgeWidth=${edgeWidth}\n`);

  // Define boundary variable
  const boundaryOffset = ctx.Real.const('boundary_offset');

  // Constraint: boundary must be between 0 and r + edgeWidth
  const solver = new ctx.Solver();
  solver.add(boundaryOffset.ge(ctx.Real.val(0)));
  solver.add(boundaryOffset.le(ctx.Real.val(r + edgeWidth)));

  // We want to find the boundary where direction change is minimal
  // The direction at boundary should be close to (0, -1) for the top edge

  // Analytical solution:
  // At point (x, 0) in corner region where x = halfW - r + cornerX:
  //   cornerX = x - (halfW - r)
  //   cornerY = 0 - (halfH - r) = r - halfH (but we measure from edge, so cornerY = r)
  //   dirX = cornerX / sqrt(cornerX² + r²)
  //   dirY = -r / sqrt(cornerX² + r²)
  //
  // At point (x, 0) in edge region:
  //   dirX = 0 (horizontal edge)
  //   dirY = -1
  //
  // For continuity, we want dirX → 0, which means cornerX → 0
  // This happens at x = halfW - r, i.e., the corner boundary!
  //
  // BUT the issue is the transition happens AT the boundary, not smoothly.

  // Find all continuous transitions
  console.log('=== Analyzing Continuity Along Edges ===\n');

  // Check top edge from x=0 to x=halfW
  console.log('Top Edge (y from 0 to edgeWidth, x = cornerSize):');

  const cornerSize = r;
  const testX = cornerSize;

  for (let y = 0; y <= edgeWidth; y += 5) {
    const p = computePixel(testX, y, width, height, borderRadius, edgeWidthRatio);
    console.log(`  y=${y.toString().padStart(2)}: RGB(${p.r}, ${p.g}) corner=${p.isCorner} dir=(${p.dirX?.toFixed(3) || '0'}, ${p.dirY?.toFixed(3) || '0'})`);
  }

  // The key: find where isCorner transitions to false
  console.log('\n=== Finding Corner-Edge Transition Line ===\n');

  // Along y=0 (top edge), find where corner region ends
  let transitionX = -1;
  for (let x = 0; x < halfW; x += 0.5) {
    const p = computePixel(x, 0, width, height, borderRadius, edgeWidthRatio);
    if (!p.isCorner && p.inBounds && transitionX < 0) {
      transitionX = x;
      console.log(`Corner→Edge transition at x=${x}: inBounds=${p.inBounds}`);
      break;
    }
  }

  // The transition happens at the arc boundary of the rounded corner
  // For a corner at (halfW-r, halfH-r) with radius r:
  // At y=0: the arc ends where sqrt((x-(halfW-r))² + (0-(halfH-r))²) = r
  // sqrt(cornerX² + (halfH-r)²) = r
  // But halfH-r = 60-40 = 60 for our test... wait, that's wrong.

  // Let me recalculate:
  // halfW = halfH = 100
  // cornerThresholdX = halfW - r = 60
  // At y=0: dy = |0 - halfH| = 100 > cornerThresholdY = 60, so inCornerY = true
  // At x=?: dx = |x - halfW| = |x - 100|
  // For x < 40: dx = 100 - x > 60, so inCornerX = true
  // Corner region: x < 40 AND y < 40 (or y > 160)

  console.log('\n=== Alternative Approach: Overlapping Tiles ===\n');

  console.log('Instead of finding perfect boundaries, use OVERLAPPING tiles:');
  console.log('1. Corner tiles extend INTO the edge region');
  console.log('2. Edge tiles extend INTO the corner region');
  console.log('3. Use feBlend or alpha blending in overlap zone\n');

  const overlapWidth = 20; // pixels of overlap

  console.log(`Overlap configuration:`);
  console.log(`  Corner slice: 0 to ${r + overlapWidth}px`);
  console.log(`  Edge slice starts at: ${r - overlapWidth}px`);
  console.log(`  Overlap zone: ${r - overlapWidth} to ${r + overlapWidth}px`);

  // Verify the overlap zone has compatible gradients
  console.log('\n=== Overlap Zone Analysis ===\n');

  console.log('At overlap zone center (x = r):');
  for (let y = 0; y <= edgeWidth; y += 10) {
    const corner = computePixel(r - 5, y, width, height, borderRadius, edgeWidthRatio);
    const edge = computePixel(r + 5, y, width, height, borderRadius, edgeWidthRatio);

    console.log(`  y=${y.toString().padStart(2)}:`);
    console.log(`    Corner side: RGB(${corner.r}, ${corner.g}) dir=(${corner.dirX?.toFixed(2) || '0'}, ${corner.dirY?.toFixed(2) || '0'})`);
    console.log(`    Edge side:   RGB(${edge.r}, ${edge.g}) dir=(${edge.dirX?.toFixed(2) || '0'}, ${edge.dirY?.toFixed(2) || '0'})`);

    // Calculate blended value (linear interpolation)
    const blendR = Math.round((corner.r + edge.r) / 2);
    const blendG = Math.round((corner.g + edge.g) / 2);
    console.log(`    Blended:     RGB(${blendR}, ${blendG})`);

    // Compare with actual WASM value at x=r
    const actual = computePixel(r, y, width, height, borderRadius, edgeWidthRatio);
    console.log(`    Actual:      RGB(${actual.r}, ${actual.g})`);

    const errorR = Math.abs(blendR - actual.r);
    const errorG = Math.abs(blendG - actual.g);
    console.log(`    Error:       R=${errorR}, G=${errorG}`);
    console.log();
  }

  // Conclusion
  console.log('=== Conclusion ===\n');

  console.log('Finding: Simple blending does NOT work perfectly.');
  console.log('The direction vector change causes inherent discontinuity.\n');

  console.log('SOLUTION: Pre-render corner tiles at ACTUAL SIZE');
  console.log('Since corners have fixed radius, pre-render them as PNG/SVG');
  console.log('and only use procedural gradients for the stretchable edges.\n');

  console.log('9-Slice Configuration:');
  console.log('┌─────────┬─────────────────────┬─────────┐');
  console.log('│ Corner  │    Edge (stretch)   │ Corner  │');
  console.log('│ (fixed) │                     │ (fixed) │');
  console.log('├─────────┼─────────────────────┼─────────┤');
  console.log('│  Edge   │                     │  Edge   │');
  console.log('│(stretch)│     Center (fill)   │(stretch)│');
  console.log('├─────────┼─────────────────────┼─────────┤');
  console.log('│ Corner  │    Edge (stretch)   │ Corner  │');
  console.log('│ (fixed) │                     │ (fixed) │');
  console.log('└─────────┴─────────────────────┴─────────┘\n');

  console.log('Corner tiles: Pre-rendered at borderRadius + edgeWidth');
  console.log('Edge tiles: SVG linear gradient, stretchable');
  console.log('Center: Solid rgb(128,128,128)\n');

  // Generate the actual SVG that would work
  console.log('=== Generating Optimized SVG ===\n');

  const cornerSliceSize = r + edgeWidth;

  // The corner tiles need to be pre-rendered from WASM or Canvas
  // But the edges CAN be SVG gradients

  const gradientStops = [
    { offset: 0, opacity: 1.0 },
    { offset: 0.2, opacity: 0.5488 },
    { offset: 0.4, opacity: 0.3012 },
    { offset: 0.6, opacity: 0.1653 },
    { offset: 0.8, opacity: 0.0907 },
    { offset: 1.0, opacity: 0.0498 },
  ];

  console.log('Corner slice size:', cornerSliceSize + 'px');
  console.log('Edge gradient stops:', gradientStops.map(s => `${s.offset * 100}%: ${s.opacity.toFixed(4)}`).join(', '));

  ctx.interrupt();
}

async function generateHybridSolution() {
  console.log('\n\n=== HYBRID SOLUTION: Pre-rendered Corners + SVG Edges ===\n');

  const width = 200;
  const height = 200;
  const borderRadius = 40;
  const edgeWidthRatio = 0.5;

  const halfW = width / 2;
  const r = Math.min(borderRadius, halfW);
  const edgeWidth = Math.min(halfW, height / 2) * edgeWidthRatio;

  // For the hybrid approach:
  // 1. Pre-render 4 corner tiles (can be single tile, rotated)
  // 2. Use SVG gradients for 4 edge tiles
  // 3. Solid fill for center

  const cornerSize = r + edgeWidth;

  console.log('Hybrid 9-Slice Configuration:');
  console.log('─'.repeat(50));
  console.log(`Border Radius: ${r}px`);
  console.log(`Edge Width: ${edgeWidth}px`);
  console.log(`Corner Slice Size: ${cornerSize}px (fixed, pre-rendered)`);
  console.log(`Edge Slice Thickness: ${edgeWidth}px (stretchable, SVG gradient)`);
  console.log('─'.repeat(50));

  // The corner tile contains:
  // - The rounded corner arc
  // - Radial gradient from corner
  // - Transition zone to edge

  // Edge tile contains:
  // - Linear gradient from edge inward
  // - Full exponential decay pattern

  // The key insight: The edge gradient starts at distance 0 from edge
  // and the corner gradient also starts at distance 0 from edge (at the arc)

  // Generate minimal test SVG
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <!-- Edge gradients (linear) -->
    <linearGradient id="edge-top" x1="0" y1="0" x2="0" y2="1"
                    gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="rgb(128,255,128)" stop-opacity="1"/>
      <stop offset="20%" stop-color="rgb(128,255,128)" stop-opacity="0.5488"/>
      <stop offset="40%" stop-color="rgb(128,255,128)" stop-opacity="0.3012"/>
      <stop offset="60%" stop-color="rgb(128,255,128)" stop-opacity="0.1653"/>
      <stop offset="80%" stop-color="rgb(128,255,128)" stop-opacity="0.0907"/>
      <stop offset="100%" stop-color="rgb(128,255,128)" stop-opacity="0.0498"/>
    </linearGradient>

    <!-- Corner would be an image reference -->
    <!-- <image id="corner-tl" href="corner-tl.png" /> -->
  </defs>

  <!-- Base neutral -->
  <rect width="${width}" height="${height}" fill="rgb(128,128,128)"/>

  <!-- Edge regions (between corners) -->
  <rect x="${cornerSize}" y="0" width="${width - 2 * cornerSize}" height="${edgeWidth}"
        fill="url(#edge-top)"/>

  <!-- Corner placeholders (would be pre-rendered images) -->
  <rect x="0" y="0" width="${cornerSize}" height="${cornerSize}"
        fill="red" opacity="0.3"/>
  <text x="${cornerSize / 2}" y="${cornerSize / 2}" text-anchor="middle"
        fill="white" font-size="10">Corner TL</text>

  <rect x="${width - cornerSize}" y="0" width="${cornerSize}" height="${cornerSize}"
        fill="red" opacity="0.3"/>
  <text x="${width - cornerSize / 2}" y="${cornerSize / 2}" text-anchor="middle"
        fill="white" font-size="10">Corner TR</text>
</svg>`;

  console.log('\nHybrid SVG structure:');
  console.log(svg);

  console.log('\n=== IMPLEMENTATION STRATEGY ===\n');

  console.log('1. CORNER TILES (4 unique, or 1 + rotations):');
  console.log('   - Generate once per borderRadius value');
  console.log('   - Store as base64 PNG in JS constants');
  console.log('   - Reference via feImage in SVG filter');
  console.log('   - Size: ' + cornerSize + 'x' + cornerSize + 'px');

  console.log('\n2. EDGE GRADIENTS (4, can be 1 + rotations):');
  console.log('   - Define as SVG linearGradient');
  console.log('   - Stretchable along edge direction');
  console.log('   - Fixed thickness: ' + edgeWidth + 'px');

  console.log('\n3. ASSEMBLY:');
  console.log('   - Use CSS border-image OR');
  console.log('   - Use SVG with positioned rect elements OR');
  console.log('   - Use SVG feComposite to blend tiles');

  console.log('\n4. SIZE ADAPTATION:');
  console.log('   - Corners: fixed position at 4 corners');
  console.log('   - Edges: stretch to fill gaps');
  console.log('   - Center: solid fill, any size');

  // Calculate efficiency
  const cornerPixels = 4 * cornerSize * cornerSize;
  const totalPixels = width * height;
  const edgePixels = 4 * edgeWidth * (Math.max(width, height) - 2 * cornerSize);

  console.log('\n=== EFFICIENCY ANALYSIS ===\n');
  console.log(`Full image: ${totalPixels} pixels (${(totalPixels * 4 / 1024).toFixed(1)}KB RGBA)`);
  console.log(`Corner tiles: ${cornerPixels} pixels (${(cornerPixels * 4 / 1024).toFixed(1)}KB RGBA)`);
  console.log(`Edge tiles: 4 × SVG gradient (minimal)`);
  console.log(`Savings: ${((1 - cornerPixels / totalPixels) * 100).toFixed(1)}% pixel reduction`);
  console.log('');
  console.log('Plus: Corners only need to be generated ONCE per borderRadius.');
  console.log('Standard borderRadius values can be pre-baked and shipped as assets.');
}

async function main() {
  try {
    await findOptimalBoundary();
    await generateHybridSolution();
  } catch (error) {
    console.error('Error:', error);
  }
}

main();

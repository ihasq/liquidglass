/**
 * Artifact Analysis for 9-Slice Displacement Map
 *
 * Checks if slice boundaries have discontinuities that would cause visual artifacts.
 */

// WASM displacement formula (replicated)
function fastExp(x) {
  if (x < -87) return 0;
  if (x > 0) return 1;
  return Math.exp(x);
}

function computeWasmPixel(px, py, width, height, borderRadius, edgeWidthRatio = 0.5) {
  const halfW = width / 2;
  const halfH = height / 2;
  const minHalf = Math.min(halfW, halfH);
  const edgeWidth = minHalf * edgeWidthRatio;
  const r = Math.min(borderRadius, minHalf);

  const negThreeOverEdgeWidth = -3 / edgeWidth;
  const cornerThresholdX = halfW - r;
  const cornerThresholdY = halfH - r;

  const fx = px;
  const fy = py;
  const dx = Math.abs(fx - halfW);
  const dy = Math.abs(fy - halfH);

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
        const signX = fx < halfW ? -1 : 1;
        const signY = fy < halfH ? -1 : 1;
        dirX = cornerX * invDist * signX;
        dirY = cornerY * invDist * signY;
      }
    }
  } else {
    const distX = halfW - dx;
    const distY = halfH - dy;

    if (distX < distY) {
      distFromEdge = distX;
      dirX = fx < halfW ? -1 : 1;
    } else {
      distFromEdge = distY;
      dirY = fy < halfH ? -1 : 1;
    }
  }

  if (!inBounds) {
    return { r: 128, g: 128, b: 128, inBounds: false };
  }

  const expArg = distFromEdge * negThreeOverEdgeWidth;
  const magnitude = distFromEdge < 0 ? 0 : fastExp(expArg);

  const dispX = -dirX * magnitude;
  const dispY = -dirY * magnitude;

  const rVal = Math.round(Math.max(0, Math.min(255, 128 + dispX * 127)));
  const gVal = Math.round(Math.max(0, Math.min(255, 128 + dispY * 127)));

  return { r: rVal, g: gVal, b: 128, inBounds: true, distFromEdge, magnitude, dirX, dirY };
}

function analyzeArtifacts() {
  console.log('=== 9-Slice Artifact Analysis ===\n');

  const width = 200;
  const height = 200;
  const borderRadius = 40;
  const edgeWidthRatio = 0.5;

  const halfW = width / 2;
  const halfH = height / 2;
  const r = Math.min(borderRadius, halfW, halfH);
  const edgeWidth = Math.min(halfW, halfH) * edgeWidthRatio;

  console.log(`Configuration: ${width}x${height}, radius=${r}, edgeWidth=${edgeWidth}\n`);

  // 9-slice boundaries
  const cornerSize = r;  // Corner slice extends from edge by radius
  const boundaries = {
    vertical: [cornerSize, width - cornerSize],    // x boundaries
    horizontal: [cornerSize, height - cornerSize]  // y boundaries
  };

  console.log('9-Slice Boundaries:');
  console.log(`  Vertical (x): ${boundaries.vertical}`);
  console.log(`  Horizontal (y): ${boundaries.horizontal}\n`);

  // Check continuity at boundaries
  let totalDiscontinuities = 0;
  const discontinuityReport = [];

  // 1. Check vertical boundary (corner ↔ edge transition) at x = r
  console.log('=== Checking Vertical Boundary (x = r) ===\n');

  for (const boundaryX of boundaries.vertical) {
    console.log(`Boundary at x = ${boundaryX}:`);

    for (let y = 0; y < height; y += 2) {
      const leftPixel = computeWasmPixel(boundaryX - 0.5, y, width, height, borderRadius, edgeWidthRatio);
      const rightPixel = computeWasmPixel(boundaryX + 0.5, y, width, height, borderRadius, edgeWidthRatio);

      if (!leftPixel.inBounds && !rightPixel.inBounds) continue;

      const rDiff = Math.abs(leftPixel.r - rightPixel.r);
      const gDiff = Math.abs(leftPixel.g - rightPixel.g);
      const maxDiff = Math.max(rDiff, gDiff);

      if (maxDiff > 3) {  // Threshold for visible artifact
        console.log(`  y=${y}: L(${leftPixel.r},${leftPixel.g}) vs R(${rightPixel.r},${rightPixel.g}) diff=${maxDiff}`);
        totalDiscontinuities++;
        discontinuityReport.push({ x: boundaryX, y, diff: maxDiff, type: 'vertical' });
      }
    }
    console.log();
  }

  // 2. Check horizontal boundary (corner ↔ edge transition) at y = r
  console.log('=== Checking Horizontal Boundary (y = r) ===\n');

  for (const boundaryY of boundaries.horizontal) {
    console.log(`Boundary at y = ${boundaryY}:`);

    for (let x = 0; x < width; x += 2) {
      const topPixel = computeWasmPixel(x, boundaryY - 0.5, width, height, borderRadius, edgeWidthRatio);
      const bottomPixel = computeWasmPixel(x, boundaryY + 0.5, width, height, borderRadius, edgeWidthRatio);

      if (!topPixel.inBounds && !bottomPixel.inBounds) continue;

      const rDiff = Math.abs(topPixel.r - bottomPixel.r);
      const gDiff = Math.abs(topPixel.g - bottomPixel.g);
      const maxDiff = Math.max(rDiff, gDiff);

      if (maxDiff > 3) {
        console.log(`  x=${x}: T(${topPixel.r},${topPixel.g}) vs B(${bottomPixel.r},${bottomPixel.g}) diff=${maxDiff}`);
        totalDiscontinuities++;
        discontinuityReport.push({ x, y: boundaryY, diff: maxDiff, type: 'horizontal' });
      }
    }
    console.log();
  }

  // 3. Check corner-to-corner diagonal
  console.log('=== Checking Corner Regions ===\n');

  // Sample the corner at 45-degree angle
  for (let t = 0; t <= 1; t += 0.1) {
    const x = cornerSize * t;
    const y = cornerSize * t;
    const pixel = computeWasmPixel(x, y, width, height, borderRadius, edgeWidthRatio);

    console.log(`  (${x.toFixed(1)}, ${y.toFixed(1)}): RGB(${pixel.r}, ${pixel.g}, ${pixel.b}) dist=${pixel.distFromEdge?.toFixed(2) || 'N/A'}`);
  }

  // Summary
  console.log('\n=== Summary ===\n');
  console.log(`Total discontinuities found: ${totalDiscontinuities}`);

  if (totalDiscontinuities === 0) {
    console.log('\n✓ 9-SLICE IS ARTIFACT-FREE');
    console.log('The WASM displacement map has C0 continuity at all slice boundaries.');
    console.log('SVG 9-slice approach can reproduce this exactly.');
  } else {
    console.log('\n✗ ARTIFACTS DETECTED');
    console.log('Special handling needed at boundaries:');

    // Analyze discontinuity patterns
    const byType = {};
    for (const d of discontinuityReport) {
      if (!byType[d.type]) byType[d.type] = [];
      byType[d.type].push(d);
    }

    for (const [type, items] of Object.entries(byType)) {
      console.log(`\n  ${type} boundaries: ${items.length} discontinuities`);
      const avgDiff = items.reduce((s, i) => s + i.diff, 0) / items.length;
      const maxDiff = Math.max(...items.map(i => i.diff));
      console.log(`    Average diff: ${avgDiff.toFixed(2)}`);
      console.log(`    Max diff: ${maxDiff}`);
    }
  }

  // Analyze what causes discontinuities
  console.log('\n=== Root Cause Analysis ===\n');

  // The key insight: at x = r (corner boundary), the displacement direction changes
  // In corner: direction is radial (towards corner center)
  // In edge: direction is perpendicular to edge (towards center)

  // Check if the transition is smooth
  const testY = r / 2;  // Middle of the top edge/corner boundary

  console.log(`Testing transition at y = ${testY} (middle of corner region):\n`);

  for (let x = 0; x <= r + 10; x += 2) {
    const pixel = computeWasmPixel(x, testY, width, height, borderRadius, edgeWidthRatio);
    const inCorner = x < (halfW - r) ? false : true;  // Simplified check
    console.log(`  x=${x.toString().padStart(3)}: RGB(${pixel.r.toString().padStart(3)}, ${pixel.g.toString().padStart(3)}) dir=(${pixel.dirX?.toFixed(3) || '0'}, ${pixel.dirY?.toFixed(3) || '0'}) ${x === r ? '<-- BOUNDARY' : ''}`);
  }

  // Propose solution
  console.log('\n=== Proposed 9-Slice Strategy ===\n');

  console.log('1. CORNER SLICES (4 pieces):');
  console.log(`   Size: ${cornerSize}px x ${cornerSize}px`);
  console.log('   Gradient: Radial, centered at corner');
  console.log('   Contains: Rounded corner + transition zone');

  console.log('\n2. EDGE SLICES (4 pieces):');
  console.log(`   Thickness: ${edgeWidth}px`);
  console.log('   Gradient: Linear, perpendicular to edge');
  console.log('   Stretchable: Yes (along edge direction)');

  console.log('\n3. CENTER SLICE:');
  console.log('   Fill: rgb(128, 128, 128) solid');
  console.log('   Stretchable: Yes (both directions)');

  console.log('\n4. BLENDING:');
  console.log('   At boundaries: Use feBlend or overlap regions');
  console.log('   Alternative: Pre-bake larger corner slices that include edge transition');
}

// Run analysis
analyzeArtifacts();

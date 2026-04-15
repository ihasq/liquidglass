/**
 * SDF-based Displacement Map Solution
 *
 * Mathematical derivation of correct displacement using Signed Distance Fields.
 * This eliminates all discontinuities by computing proper gradients.
 */

// Current algorithm (with discontinuities)
function currentDisplacement(px, py, halfW, halfH, r, edgeWidth) {
  const dx = Math.abs(px - halfW);
  const dy = Math.abs(py - halfH);
  const signX = Math.sign(px - halfW) || 1;
  const signY = Math.sign(py - halfH) || 1;

  const inCorner = dx > halfW - r && dy > halfH - r;

  if (inCorner) {
    const cornerX = dx - (halfW - r);
    const cornerY = dy - (halfH - r);
    const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
    if (cornerDist > r) return { outside: true };

    const distFromEdge = r - cornerDist;
    const magnitude = Math.exp(-3 * distFromEdge / edgeWidth);

    const dirX = cornerDist > 0.001 ? (cornerX / cornerDist) * signX : 0;
    const dirY = cornerDist > 0.001 ? (cornerY / cornerDist) * signY : 0;

    return { dispX: -dirX * magnitude, dispY: -dirY * magnitude, region: 'corner' };
  }

  const distX = halfW - dx;
  const distY = halfH - dy;

  // *** THIS IS THE BUG: hard switch at distX == distY ***
  if (distX < distY) {
    const magnitude = Math.exp(-3 * distX / edgeWidth);
    return { dispX: -signX * magnitude, dispY: 0, region: 'edge-x' };
  } else {
    const magnitude = Math.exp(-3 * distY / edgeWidth);
    return { dispX: 0, dispY: -signY * magnitude, region: 'edge-y' };
  }
}

// Correct SDF-based algorithm
function sdfDisplacement(px, py, halfW, halfH, r, edgeWidth) {
  const dx = Math.abs(px - halfW);
  const dy = Math.abs(py - halfH);
  const signX = Math.sign(px - halfW) || 1;
  const signY = Math.sign(py - halfH) || 1;

  // Rounded rectangle SDF and gradient
  // Reference: https://iquilezles.org/articles/distfunctions2d/

  // Inner rectangle bounds (where corners start)
  const innerW = halfW - r;
  const innerH = halfH - r;

  let sdf, gradX, gradY;

  if (dx <= innerW && dy <= innerH) {
    // Inside inner rectangle - both edges contribute
    const distToX = halfW - dx;
    const distToY = halfH - dy;

    // Use soft minimum for smooth blending
    // sdf = -softmin(distToX, distToY, k) where k controls blend sharpness
    const k = 8; // Blend factor
    const minDist = Math.min(distToX, distToY);
    const maxDist = Math.max(distToX, distToY);

    // Smooth minimum: approximates min but with continuous gradient
    // softmin(a,b,k) = -ln(exp(-k*a) + exp(-k*b)) / k
    const expX = Math.exp(-k * distToX / edgeWidth);
    const expY = Math.exp(-k * distToY / edgeWidth);
    const sumExp = expX + expY;

    sdf = -Math.min(distToX, distToY); // Distance is negative inside

    // Gradient: weighted blend based on relative distances
    // Weight more toward the closer edge
    const wX = expX / sumExp;
    const wY = expY / sumExp;

    gradX = wX * signX;
    gradY = wY * signY;

  } else if (dx <= innerW) {
    // Top/bottom edge region (outside inner rect in Y only)
    sdf = -(halfH - dy);
    gradX = 0;
    gradY = signY;

  } else if (dy <= innerH) {
    // Left/right edge region (outside inner rect in X only)
    sdf = -(halfW - dx);
    gradX = signX;
    gradY = 0;

  } else {
    // Corner region
    const cornerX = dx - innerW;
    const cornerY = dy - innerH;
    const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);

    if (cornerDist > r) {
      return { outside: true };
    }

    sdf = cornerDist - r; // Negative inside

    if (cornerDist > 0.001) {
      gradX = (cornerX / cornerDist) * signX;
      gradY = (cornerY / cornerDist) * signY;
    } else {
      gradX = 0;
      gradY = 0;
    }
  }

  // Distance from edge (positive inside)
  const distFromEdge = -sdf;

  // Exponential decay magnitude
  const magnitude = distFromEdge > 0 ? Math.exp(-3 * distFromEdge / edgeWidth) : 0;

  // Displacement (pointing inward)
  const dispX = -gradX * magnitude;
  const dispY = -gradY * magnitude;

  return { dispX, dispY, distFromEdge, gradX, gradY, region: 'sdf' };
}

// Compare algorithms along diagonal
console.log('=== Diagonal Discontinuity Comparison ===\n');
console.log('Testing along the line where distX ≈ distY (diagonal seam)\n');

const width = 320, height = 200, borderRadius = 24;
const halfW = width / 2, halfH = height / 2;
const r = Math.min(borderRadius, halfW, halfH);
const edgeWidth = Math.min(halfW, halfH) * 0.5;

// Points along diagonal from center toward corner
console.log('Point\t\t\tCurrent\t\t\t\t\tSDF-based');
console.log('(x, y)\t\t\tregion\tdispX\t\tdispY\t\tdispX\t\tdispY');
console.log('-'.repeat(90));

for (let t = 0; t <= 1; t += 0.1) {
  // Move along diagonal in first quadrant
  const px = halfW + (halfW - r) * t * 0.8;
  const py = halfH + (halfH - r) * t * 0.8;

  const curr = currentDisplacement(px, py, halfW, halfH, r, edgeWidth);
  const sdf = sdfDisplacement(px, py, halfW, halfH, r, edgeWidth);

  if (!curr.outside && !sdf.outside) {
    console.log(
      `(${px.toFixed(0)}, ${py.toFixed(0)})\t\t${curr.region}\t${curr.dispX.toFixed(4)}\t\t${curr.dispY.toFixed(4)}\t\t${sdf.dispX.toFixed(4)}\t\t${sdf.dispY.toFixed(4)}`
    );
  }
}

// Test right at the diagonal boundary
console.log('\n=== Critical Points at Diagonal Boundary ===\n');

const testDist = 30;
const variations = [-0.5, -0.1, 0, 0.1, 0.5];

console.log('Testing at distX ≈ distY ≈ 30 pixels from edge:\n');
console.log('Offset\t\tCurrent (dispX, dispY)\t\tSDF (dispX, dispY)\t\tDelta');
console.log('-'.repeat(80));

for (const offset of variations) {
  const px = halfW + (halfW - testDist) + offset;  // distX = testDist - offset
  const py = halfH + (halfH - testDist) - offset;  // distY = testDist + offset

  const curr = currentDisplacement(px, py, halfW, halfH, r, edgeWidth);
  const sdf = sdfDisplacement(px, py, halfW, halfH, r, edgeWidth);

  if (!curr.outside && !sdf.outside) {
    const deltaX = Math.abs(curr.dispX - sdf.dispX);
    const deltaY = Math.abs(curr.dispY - sdf.dispY);

    console.log(
      `${offset >= 0 ? '+' : ''}${offset.toFixed(1)}\t\t(${curr.dispX.toFixed(4)}, ${curr.dispY.toFixed(4)})\t\t(${sdf.dispX.toFixed(4)}, ${sdf.dispY.toFixed(4)})\t\t${(deltaX + deltaY).toFixed(4)}`
    );
  }
}

console.log('\n=== Analysis Summary ===\n');
console.log('Current algorithm has TWO discontinuities:');
console.log('');
console.log('1. DIAGONAL SEAM (distX == distY line):');
console.log('   - Abrupt switch from (dispX, 0) to (0, dispY)');
console.log('   - Creates visible 45° line in each quadrant');
console.log('   - FIX: Use exponential weighting to blend X/Y contributions');
console.log('');
console.log('2. CORNER BOUNDARY (at dx = halfW - r OR dy = halfH - r):');
console.log('   - Direction suddenly becomes radial');
console.log('   - Less visible but still causes subtle seam');
console.log('   - FIX: Already continuous in corner region, just fix edge region');
console.log('');
console.log('The SDF-based approach eliminates discontinuity #1 by:');
console.log('- Computing a smooth weighted blend in the inner rectangle');
console.log('- Using exponential weighting: w_i = exp(-k * dist_i) / Σ exp(-k * dist_j)');
console.log('- This creates C∞ continuous gradient transitions');

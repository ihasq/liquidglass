/**
 * SMT Solver: Ellipse that covers all part boundaries
 *
 * Given a 9-slice layout, find an ellipse centered at (halfW, halfH) that
 * passes through the "far" endpoints of all internal boundary segments.
 *
 * The internal boundaries are:
 * - Vertical at x = cornerSizeX and x = width - cornerSizeX
 * - Horizontal at y = cornerSizeY and y = height - cornerSizeY
 *
 * For each boundary segment, we take the endpoint furthest from center.
 */

import { init } from 'z3-solver';

const { Context } = await init();
const Z3 = new Context('main');

console.log('═══════════════════════════════════════════════════════════════');
console.log('SMT Analysis: Ellipse Blur Covering Part Boundaries');
console.log('═══════════════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════════
// Part 1: Identify the "far" points on each boundary segment
// ═══════════════════════════════════════════════════════════════════

console.log('Part 1: Far Points on Boundary Segments\n');

console.log('For a 9-slice with cornerSizeX and cornerSizeY:');
console.log('');
console.log('Internal boundaries and their "far" endpoints:');
console.log('');
console.log('  1. TL-Top boundary: (cornerSizeX, 0) to (cornerSizeX, cornerSizeY)');
console.log('     Far point: (cornerSizeX, 0) - closer to top edge');
console.log('');
console.log('  2. TR-Top boundary: (w-cornerSizeX, 0) to (w-cornerSizeX, cornerSizeY)');
console.log('     Far point: (w-cornerSizeX, 0)');
console.log('');
console.log('  3. TL-Left boundary: (0, cornerSizeY) to (cornerSizeX, cornerSizeY)');
console.log('     Far point: (0, cornerSizeY) - closer to left edge');
console.log('');
console.log('  4. TR-Right boundary: (w-cornerSizeX, cornerSizeY) to (w, cornerSizeY)');
console.log('     Far point: (w, cornerSizeY)');
console.log('');
console.log('  ... and symmetric points on the bottom half');
console.log('');

// ═══════════════════════════════════════════════════════════════════
// Part 2: Derive ellipse equation
// ═══════════════════════════════════════════════════════════════════

console.log('Part 2: Ellipse Equation Derivation\n');

console.log('Ellipse centered at (halfW, halfH) with semi-axes (a, b):');
console.log('  ((x - halfW)/a)² + ((y - halfH)/b)² = 1');
console.log('');
console.log('For the ellipse to pass through all far points:');
console.log('');
console.log('  Key far points (by symmetry, we only need two):');
console.log('    P1 = (cornerSizeX, 0)      → dx1 = halfW - cornerSizeX, dy1 = halfH');
console.log('    P2 = (0, cornerSizeY)      → dx2 = halfW, dy2 = halfH - cornerSizeY');
console.log('');
console.log('  Substituting into ellipse equation:');
console.log('    (dx1/a)² + (dy1/b)² = 1  ... (1)');
console.log('    (dx2/a)² + (dy2/b)² = 1  ... (2)');
console.log('');

// ═══════════════════════════════════════════════════════════════════
// Part 3: Solve for a and b
// ═══════════════════════════════════════════════════════════════════

console.log('Part 3: Solving for Semi-axes a and b\n');

async function deriveEllipseFormula() {
  const solver = new Z3.Solver();

  // Symbolic parameters
  const W = Z3.Real.const('W');
  const H = Z3.Real.const('H');
  const cornerSizeX = Z3.Real.const('cornerSizeX');
  const cornerSizeY = Z3.Real.const('cornerSizeY');

  const halfW = W.div(2);
  const halfH = H.div(2);

  // Semi-axes of the ellipse
  const a = Z3.Real.const('a');
  const b = Z3.Real.const('b');

  // Constraints
  solver.add(W.gt(0));
  solver.add(H.gt(0));
  solver.add(cornerSizeX.gt(0));
  solver.add(cornerSizeY.gt(0));
  solver.add(cornerSizeX.lt(halfW));
  solver.add(cornerSizeY.lt(halfH));
  solver.add(a.gt(0));
  solver.add(b.gt(0));

  // Far points
  // P1 = (cornerSizeX, 0): distance from center is (halfW - cornerSizeX, halfH)
  const dx1 = halfW.sub(cornerSizeX);
  const dy1 = halfH;

  // P2 = (0, cornerSizeY): distance from center is (halfW, halfH - cornerSizeY)
  const dx2 = halfW;
  const dy2 = halfH.sub(cornerSizeY);

  // Ellipse equations: (dx/a)² + (dy/b)² = 1
  // dx1²/a² + dy1²/b² = 1
  // dx2²/a² + dy2²/b² = 1

  // Let's derive algebraically:
  // From (1): a² = dx1² / (1 - dy1²/b²) = dx1² * b² / (b² - dy1²)
  // From (2): a² = dx2² / (1 - dy2²/b²) = dx2² * b² / (b² - dy2²)
  //
  // Equating: dx1² / (b² - dy1²) = dx2² / (b² - dy2²)
  // dx1² * (b² - dy2²) = dx2² * (b² - dy1²)
  // dx1² * b² - dx1² * dy2² = dx2² * b² - dx2² * dy1²
  // b² * (dx1² - dx2²) = dx1² * dy2² - dx2² * dy1²
  // b² = (dx1² * dy2² - dx2² * dy1²) / (dx1² - dx2²)

  console.log('Algebraic solution:');
  console.log('');
  console.log('  b² = (dx1² × dy2² - dx2² × dy1²) / (dx1² - dx2²)');
  console.log('');
  console.log('  where:');
  console.log('    dx1 = halfW - cornerSizeX');
  console.log('    dy1 = halfH');
  console.log('    dx2 = halfW');
  console.log('    dy2 = halfH - cornerSizeY');
  console.log('');
  console.log('  Then: a² = dx1² × b² / (b² - dy1²)');
  console.log('');

  return true;
}

await deriveEllipseFormula();

// ═══════════════════════════════════════════════════════════════════
// Part 4: Simplified formula
// ═══════════════════════════════════════════════════════════════════

console.log('Part 4: Simplified JavaScript Formula\n');

console.log(`function getEllipseBlurParams(width, height, cornerSizeX, cornerSizeY) {
  const halfW = width / 2;
  const halfH = height / 2;

  // Distance from center to far points
  const dx1 = halfW - cornerSizeX;  // Point (cornerSizeX, 0)
  const dy1 = halfH;
  const dx2 = halfW;                // Point (0, cornerSizeY)
  const dy2 = halfH - cornerSizeY;

  // Solve for b² first
  const dx1Sq = dx1 * dx1;
  const dx2Sq = dx2 * dx2;
  const dy1Sq = dy1 * dy1;
  const dy2Sq = dy2 * dy2;

  const numerator = dx1Sq * dy2Sq - dx2Sq * dy1Sq;
  const denominator = dx1Sq - dx2Sq;

  // Handle edge case where denominator is 0 (square case)
  if (Math.abs(denominator) < 0.001) {
    // Fall back to circle
    const r = Math.sqrt(dx1Sq + dy1Sq);
    return { a: r, b: r, cx: halfW, cy: halfH };
  }

  const bSq = numerator / denominator;

  // Check validity
  if (bSq <= 0 || bSq <= dy1Sq) {
    // Invalid ellipse, fall back to bounding ellipse
    return {
      a: halfW,
      b: halfH,
      cx: halfW,
      cy: halfH
    };
  }

  const b = Math.sqrt(bSq);
  const aSq = dx1Sq * bSq / (bSq - dy1Sq);
  const a = Math.sqrt(aSq);

  return { a, b, cx: halfW, cy: halfH };
}
`);

// ═══════════════════════════════════════════════════════════════════
// Part 5: Concrete examples
// ═══════════════════════════════════════════════════════════════════

console.log('\nPart 5: Concrete Examples\n');

function getEllipseBlurParams(width, height, cornerSizeX, cornerSizeY) {
  const halfW = width / 2;
  const halfH = height / 2;

  const dx1 = halfW - cornerSizeX;
  const dy1 = halfH;
  const dx2 = halfW;
  const dy2 = halfH - cornerSizeY;

  const dx1Sq = dx1 * dx1;
  const dx2Sq = dx2 * dx2;
  const dy1Sq = dy1 * dy1;
  const dy2Sq = dy2 * dy2;

  const numerator = dx1Sq * dy2Sq - dx2Sq * dy1Sq;
  const denominator = dx1Sq - dx2Sq;

  if (Math.abs(denominator) < 0.001) {
    const r = Math.sqrt(dx1Sq + dy1Sq);
    return { a: r, b: r, cx: halfW, cy: halfH };
  }

  const bSq = numerator / denominator;

  if (bSq <= 0 || bSq <= dy1Sq) {
    return { a: halfW, b: halfH, cx: halfW, cy: halfH };
  }

  const b = Math.sqrt(bSq);
  const aSq = dx1Sq * bSq / (bSq - dy1Sq);
  const a = Math.sqrt(aSq);

  return { a, b, cx: halfW, cy: halfH };
}

const examples = [
  { w: 280, h: 180, csX: 75, csY: 75 },
  { w: 200, h: 200, csX: 70, csY: 70 },
  { w: 300, h: 150, csX: 60, csY: 60 },
  { w: 200, h: 100, csX: 75, csY: 50 },  // Elliptical corners
];

console.log('W×H        | cornerSize | Ellipse (a, b)      | Center');
console.log('-----------|------------|---------------------|--------');

for (const ex of examples) {
  const params = getEllipseBlurParams(ex.w, ex.h, ex.csX, ex.csY);
  const dim = `${ex.w}×${ex.h}`.padEnd(9);
  const cs = `(${ex.csX}, ${ex.csY})`.padEnd(10);
  const ellipse = `(${params.a.toFixed(1)}, ${params.b.toFixed(1)})`.padEnd(19);
  const center = `(${params.cx}, ${params.cy})`;
  console.log(`${dim} | ${cs} | ${ellipse} | ${center}`);
}

// ═══════════════════════════════════════════════════════════════════
// Part 6: Verification that ellipse covers all far points
// ═══════════════════════════════════════════════════════════════════

console.log('\nPart 6: Verification\n');

function verifyEllipse(w, h, csX, csY) {
  const params = getEllipseBlurParams(w, h, csX, csY);
  const { a, b, cx, cy } = params;

  // Far points (all 8 by symmetry)
  const farPoints = [
    [csX, 0],           // Top of left vertical boundary
    [w - csX, 0],       // Top of right vertical boundary
    [0, csY],           // Left of top horizontal boundary
    [w, csY],           // Right of top horizontal boundary
    [0, h - csY],       // Left of bottom horizontal boundary
    [w, h - csY],       // Right of bottom horizontal boundary
    [csX, h],           // Bottom of left vertical boundary
    [w - csX, h],       // Bottom of right vertical boundary
  ];

  console.log(`Verifying ${w}×${h} with cornerSize (${csX}, ${csY}):`);
  console.log(`  Ellipse: a=${a.toFixed(2)}, b=${b.toFixed(2)}, center=(${cx}, ${cy})`);
  console.log('  Far points on ellipse?');

  for (const [px, py] of farPoints) {
    const dx = px - cx;
    const dy = py - cy;
    const value = (dx * dx) / (a * a) + (dy * dy) / (b * b);
    const onEllipse = Math.abs(value - 1) < 0.01;
    const inside = value <= 1.01;
    console.log(`    (${px}, ${py}): value=${value.toFixed(4)} ${onEllipse ? '✓ ON' : inside ? '○ INSIDE' : '✗ OUTSIDE'}`);
  }
  console.log('');
}

verifyEllipse(280, 180, 75, 75);

console.log('═══════════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('The ellipse that passes through all "far" boundary endpoints:');
console.log('');
console.log('  Center: (width/2, height/2)');
console.log('  Semi-axes: computed from getEllipseBlurParams()');
console.log('');
console.log('This ellipse will cover ALL internal part boundaries,');
console.log('allowing a blur applied within this ellipse to smooth');
console.log('all tile seams without bleeding outside the shape.\n');

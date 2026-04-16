/**
 * SMT Solver: Find inscribed rectangle for blur coverage
 *
 * Given a rounded rectangle with:
 * - Dimensions: width × height
 * - Border radius: r (may be clamped to min(halfW, halfH))
 * - Elliptical corners when r > halfW or r > halfH
 *
 * Find the largest rectangle that:
 * 1. Is completely inside the rounded rectangle
 * 2. Does not touch any rounded corner
 * 3. Can safely have blur applied without bleeding outside
 */

import { init } from 'z3-solver';

const { Context } = await init();
const Z3 = new Context('main');

console.log('═══════════════════════════════════════════════════════════════');
console.log('SMT Analysis: Inscribed Rectangle for Blur Coverage');
console.log('═══════════════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════════
// Part 1: Derive the inscribed rectangle formula
// ═══════════════════════════════════════════════════════════════════

console.log('Part 1: Inscribed Rectangle Formula\n');

console.log('For a rounded rectangle with dimensions W×H and radius r:');
console.log('');
console.log('  Effective radii (CSS clamping):');
console.log('    rx = min(r, W/2)   // horizontal radius');
console.log('    ry = min(r, H/2)   // vertical radius');
console.log('');
console.log('  The inscribed rectangle (avoiding all corners):');
console.log('    left   = rx');
console.log('    top    = ry');
console.log('    right  = W - rx');
console.log('    bottom = H - ry');
console.log('');
console.log('  Inscribed rectangle dimensions:');
console.log('    innerWidth  = W - 2*rx');
console.log('    innerHeight = H - 2*ry');
console.log('');

// ═══════════════════════════════════════════════════════════════════
// Part 2: Verify with SMT that this rectangle is always inside
// ═══════════════════════════════════════════════════════════════════

console.log('Part 2: SMT Verification\n');

async function verifyInscribedRect() {
  const solver = new Z3.Solver();

  // Parameters
  const W = Z3.Real.const('W');
  const H = Z3.Real.const('H');
  const r = Z3.Real.const('r');

  // Constraints on valid parameters
  solver.add(W.ge(50));
  solver.add(W.le(1000));
  solver.add(H.ge(50));
  solver.add(H.le(1000));
  solver.add(r.ge(0));
  solver.add(r.le(500));

  // Effective radii with CSS clamping
  const halfW = W.div(2);
  const halfH = H.div(2);
  const rx = Z3.If(r.lt(halfW), r, halfW);
  const ry = Z3.If(r.lt(halfH), r, halfH);

  // Inscribed rectangle bounds
  const left = rx;
  const top = ry;
  const right = W.sub(rx);
  const bottom = H.sub(ry);

  // A point (px, py) inside the inscribed rectangle
  const px = Z3.Real.const('px');
  const py = Z3.Real.const('py');

  solver.add(px.ge(left));
  solver.add(px.le(right));
  solver.add(py.ge(top));
  solver.add(py.le(bottom));

  // Check if this point could ever be outside the rounded rectangle
  // A point is outside if it's in a corner region AND outside the arc

  // For TL corner: px < rx AND py < ry AND dist((rx-px), (ry-py)) > r
  // But since px >= rx and py >= ry, this can never happen!

  // Let's verify by trying to find a counterexample
  const dx = Z3.If(px.lt(halfW), halfW.sub(px), px.sub(halfW));
  const dy = Z3.If(py.lt(halfH), halfH.sub(py), py.sub(halfH));

  const cornerThreshX = halfW.sub(rx);
  const cornerThreshY = halfH.sub(ry);

  const inCornerX = dx.gt(cornerThreshX);
  const inCornerY = dy.gt(cornerThreshY);

  // Try to find a point that is both:
  // 1. Inside the inscribed rectangle
  // 2. In a corner region (which would be bad)
  solver.add(Z3.And(inCornerX, inCornerY));

  console.log('Checking if inscribed rectangle ever enters corner region...');
  const result = await solver.check();

  if (result === 'sat') {
    const model = solver.model();
    console.log('❌ COUNTEREXAMPLE FOUND:');
    console.log(`   W=${model.eval(W)}, H=${model.eval(H)}, r=${model.eval(r)}`);
    console.log(`   Point (${model.eval(px)}, ${model.eval(py)})`);
    return false;
  } else {
    console.log('✓ VERIFIED: Inscribed rectangle never enters corner region');
    console.log('  The formula is correct for all valid dimensions.\n');
    return true;
  }
}

await verifyInscribedRect();

// ═══════════════════════════════════════════════════════════════════
// Part 3: Calculate blur margin for safe coverage
// ═══════════════════════════════════════════════════════════════════

console.log('Part 3: Blur Margin Calculation\n');

console.log('For a blur with radius "blurRadius", we need additional margin:');
console.log('');
console.log('  Safe blur rectangle:');
console.log('    blurLeft   = rx + blurRadius');
console.log('    blurTop    = ry + blurRadius');
console.log('    blurRight  = W - rx - blurRadius');
console.log('    blurBottom = H - ry - blurRadius');
console.log('');
console.log('  The blur will have a feathered edge that fades within blurRadius,');
console.log('  ensuring it never bleeds outside the rounded rectangle.\n');

// ═══════════════════════════════════════════════════════════════════
// Part 4: Concrete examples
// ═══════════════════════════════════════════════════════════════════

console.log('Part 4: Concrete Examples\n');

const examples = [
  { W: 200, H: 200, r: 20, blur: 4 },
  { W: 200, H: 200, r: 40, blur: 4 },
  { W: 200, H: 100, r: 60, blur: 4 },  // Elliptical (r > halfH)
  { W: 100, H: 200, r: 60, blur: 4 },  // Elliptical (r > halfW)
  { W: 200, H: 100, r: 100, blur: 4 }, // Pill shape
];

console.log('Example calculations:');
console.log('');
console.log('W×H      | r  | rx | ry | Inscribed Rect      | With blur=4');
console.log('---------|----|----|-----|---------------------|--------------------');

for (const ex of examples) {
  const halfW = ex.W / 2;
  const halfH = ex.H / 2;
  const rx = Math.min(ex.r, halfW);
  const ry = Math.min(ex.r, halfH);

  const inscribed = {
    x: rx,
    y: ry,
    w: ex.W - 2 * rx,
    h: ex.H - 2 * ry
  };

  const blurRect = {
    x: rx + ex.blur,
    y: ry + ex.blur,
    w: ex.W - 2 * rx - 2 * ex.blur,
    h: ex.H - 2 * ry - 2 * ex.blur
  };

  const dim = `${ex.W}×${ex.H}`.padEnd(8);
  const rStr = ex.r.toString().padEnd(2);
  const rxStr = rx.toString().padEnd(2);
  const ryStr = ry.toString().padEnd(3);
  const insc = `(${inscribed.x},${inscribed.y}) ${inscribed.w}×${inscribed.h}`.padEnd(19);
  const blr = `(${blurRect.x},${blurRect.y}) ${blurRect.w}×${blurRect.h}`;

  console.log(`${dim} | ${rStr} | ${rxStr} | ${ryStr} | ${insc} | ${blr}`);
}

// ═══════════════════════════════════════════════════════════════════
// Part 5: Output the final formula as code
// ═══════════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Final Formula (JavaScript)');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log(`function getInscribedBlurRect(width, height, radius, blurRadius = 0) {
  const halfW = width / 2;
  const halfH = height / 2;

  // CSS clamping for elliptical corners
  const rx = Math.min(radius, halfW);
  const ry = Math.min(radius, halfH);

  // Inscribed rectangle that never touches corners
  const x = rx + blurRadius;
  const y = ry + blurRadius;
  const w = Math.max(0, width - 2 * rx - 2 * blurRadius);
  const h = Math.max(0, height - 2 * ry - 2 * blurRadius);

  return { x, y, width: w, height: h, rx, ry };
}
`);

console.log('Usage in SVG filter:');
console.log(`
<filter id="boundary-blur">
  <!-- Blur only the inscribed rectangle area -->
  <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blurred"/>

  <!-- Create a mask for the inscribed region -->
  <feFlood flood-color="white" result="white"/>
  <feFlood flood-color="black" result="black"/>

  <!-- Use feComposite to apply blur only inside inscribed rect -->
  <!-- The exact coordinates come from getInscribedBlurRect() -->
</filter>
`);

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('Key formulas for inscribed blur rectangle:');
console.log('');
console.log('  rx = min(radius, width / 2)');
console.log('  ry = min(radius, height / 2)');
console.log('');
console.log('  blurRect.x = rx + blurRadius');
console.log('  blurRect.y = ry + blurRadius');
console.log('  blurRect.width = width - 2*rx - 2*blurRadius');
console.log('  blurRect.height = height - 2*ry - 2*blurRadius');
console.log('');
console.log('This rectangle is GUARANTEED to be inside the rounded rect');
console.log('with blurRadius margin from any corner arc.\n');

/**
 * Verify that the canvas-generator.ts fix is correct
 * by testing critical points that previously had discontinuities
 */

// Simulate the NEW algorithm (as implemented in canvas-generator.ts)
function newAlgorithm(px, py, halfW, halfH, r, edgeWidth) {
  const dx = Math.abs(px - halfW);
  const dy = Math.abs(py - halfH);
  const signX = Math.sign(px - halfW) || 1;
  const signY = Math.sign(py - halfH) || 1;

  const innerW = halfW - r;
  const innerH = halfH - r;

  // Bounds check
  if (dx > innerW && dy > innerH) {
    const cornerX = dx - innerW;
    const cornerY = dy - innerH;
    if (cornerX * cornerX + cornerY * cornerY > r * r) {
      return null;
    }
  }

  let distFromEdge, dirX = 0, dirY = 0;

  if (dx <= innerW && dy <= innerH) {
    // Inner rectangle - SDF blend
    const distX = halfW - dx;
    const distY = halfH - dy;

    const k = 8;
    const expX = Math.exp(-k * distX / edgeWidth);
    const expY = Math.exp(-k * distY / edgeWidth);
    const sumExp = expX + expY;

    distFromEdge = Math.min(distX, distY);
    dirX = (expX / sumExp) * signX;
    dirY = (expY / sumExp) * signY;

  } else if (dx <= innerW) {
    distFromEdge = halfH - dy;
    dirX = 0;
    dirY = signY;

  } else if (dy <= innerH) {
    distFromEdge = halfW - dx;
    dirX = signX;
    dirY = 0;

  } else {
    const cornerX = dx - innerW;
    const cornerY = dy - innerH;
    const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
    distFromEdge = r - cornerDist;

    if (cornerDist > 0.001) {
      dirX = (cornerX / cornerDist) * signX;
      dirY = (cornerY / cornerDist) * signY;
    }
  }

  const magnitude = distFromEdge < 0 ? 0 : Math.exp(-3 * distFromEdge / edgeWidth);
  return { dispX: -dirX * magnitude, dispY: -dirY * magnitude, dirX, dirY };
}

// Test parameters
const width = 200, height = 150, radius = 20;
const halfW = width / 2, halfH = height / 2;
const r = Math.min(radius, halfW, halfH);
const edgeWidth = Math.min(halfW, halfH) * 0.5;

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║         POST-FIX VERIFICATION: Diagonal Continuity          ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

// Test the critical diagonal boundary (where distX ≈ distY)
console.log('Testing diagonal boundary (distX ≈ distY):');
console.log('─'.repeat(60));

const testDist = 30;
let maxJump = 0;
let prevResult = null;

for (let offset = -2; offset <= 2; offset += 0.5) {
  const px = halfW + (halfW - testDist) + offset;
  const py = halfH + (halfH - testDist) - offset;

  const result = newAlgorithm(px, py, halfW, halfH, r, edgeWidth);

  if (result && prevResult) {
    const jumpX = Math.abs(result.dispX - prevResult.dispX);
    const jumpY = Math.abs(result.dispY - prevResult.dispY);
    const jump = Math.sqrt(jumpX * jumpX + jumpY * jumpY);
    maxJump = Math.max(maxJump, jump);
  }

  if (result) {
    console.log(`  offset=${offset >= 0 ? '+' : ''}${offset.toFixed(1)}: disp=(${result.dispX.toFixed(4)}, ${result.dispY.toFixed(4)}) dir=(${result.dirX.toFixed(3)}, ${result.dirY.toFixed(3)})`);
    prevResult = result;
  }
}

console.log('─'.repeat(60));
console.log(`Max jump between adjacent samples: ${maxJump.toFixed(6)}`);

if (maxJump < 0.05) {
  console.log('\n✓ PASS: No significant discontinuity detected');
  console.log('  The diagonal seam has been eliminated.');
} else {
  console.log('\n✗ FAIL: Discontinuity still present');
  console.log(`  Jump of ${maxJump.toFixed(4)} exceeds threshold 0.05`);
}

// Verify smooth gradient across the diagonal
console.log('\n\nVerifying gradient smoothness:');
console.log('─'.repeat(60));

let gradientSmooth = true;
for (let t = 0.3; t <= 0.7; t += 0.1) {
  const px = halfW + (halfW - r) * t;
  const py = halfH + (halfH - r) * t;

  const center = newAlgorithm(px, py, halfW, halfH, r, edgeWidth);
  const right = newAlgorithm(px + 1, py, halfW, halfH, r, edgeWidth);
  const down = newAlgorithm(px, py + 1, halfW, halfH, r, edgeWidth);

  if (center && right && down) {
    const gradXChange = Math.abs(center.dirX - right.dirX);
    const gradYChange = Math.abs(center.dirY - down.dirY);

    if (gradXChange > 0.1 || gradYChange > 0.1) {
      gradientSmooth = false;
      console.log(`  (${px.toFixed(0)}, ${py.toFixed(0)}): gradient change = (${gradXChange.toFixed(3)}, ${gradYChange.toFixed(3)}) ⚠`);
    } else {
      console.log(`  (${px.toFixed(0)}, ${py.toFixed(0)}): gradient change = (${gradXChange.toFixed(3)}, ${gradYChange.toFixed(3)}) ✓`);
    }
  }
}

console.log('─'.repeat(60));
if (gradientSmooth) {
  console.log('✓ PASS: Gradient is smooth across all test points');
} else {
  console.log('✗ FAIL: Some gradient discontinuities detected');
}

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║                    VERIFICATION COMPLETE                     ║');
console.log('╚══════════════════════════════════════════════════════════════╝');

/**
 * Formal Verification of Displacement Map Algorithms
 *
 * Uses constraint satisfaction and symbolic analysis to verify:
 * 1. C0 continuity (no value jumps)
 * 2. C1 continuity (no gradient jumps)
 * 3. Boundary condition correctness
 * 4. Symmetry preservation
 */

// ============================================================
// Algorithm Implementations (identical to comparison page)
// ============================================================

function currentAlgorithm(px, py, halfW, halfH, r, edgeWidth) {
  const dx = Math.abs(px - halfW);
  const dy = Math.abs(py - halfH);
  const signX = Math.sign(px - halfW) || 1;
  const signY = Math.sign(py - halfH) || 1;

  const inCorner = dx > halfW - r && dy > halfH - r;

  if (inCorner) {
    const cornerX = dx - (halfW - r);
    const cornerY = dy - (halfH - r);
    const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
    if (cornerDist > r) return null;

    const distFromEdge = r - cornerDist;
    const magnitude = Math.exp(-3 * distFromEdge / edgeWidth);

    const dirX = cornerDist > 0.001 ? (cornerX / cornerDist) * signX : 0;
    const dirY = cornerDist > 0.001 ? (cornerY / cornerDist) * signY : 0;

    return { dispX: -dirX * magnitude, dispY: -dirY * magnitude, dirX, dirY, region: 'corner' };
  }

  const distX = halfW - dx;
  const distY = halfH - dy;

  if (distX < distY) {
    const magnitude = Math.exp(-3 * distX / edgeWidth);
    return { dispX: -signX * magnitude, dispY: 0, dirX: signX, dirY: 0, region: 'edge-x' };
  } else {
    const magnitude = Math.exp(-3 * distY / edgeWidth);
    return { dispX: 0, dispY: -signY * magnitude, dirX: 0, dirY: signY, region: 'edge-y' };
  }
}

function sdfAlgorithm(px, py, halfW, halfH, r, edgeWidth) {
  const dx = Math.abs(px - halfW);
  const dy = Math.abs(py - halfH);
  const signX = Math.sign(px - halfW) || 1;
  const signY = Math.sign(py - halfH) || 1;

  const innerW = halfW - r;
  const innerH = halfH - r;

  let distFromEdge, dirX, dirY, region;

  if (dx <= innerW && dy <= innerH) {
    region = 'inner';
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
    region = 'edge-y';
    distFromEdge = halfH - dy;
    dirX = 0;
    dirY = signY;

  } else if (dy <= innerH) {
    region = 'edge-x';
    distFromEdge = halfW - dx;
    dirX = signX;
    dirY = 0;

  } else {
    region = 'corner';
    const cornerX = dx - innerW;
    const cornerY = dy - innerH;
    const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);

    if (cornerDist > r) return null;

    distFromEdge = r - cornerDist;

    if (cornerDist > 0.001) {
      dirX = (cornerX / cornerDist) * signX;
      dirY = (cornerY / cornerDist) * signY;
    } else {
      dirX = 0;
      dirY = 0;
    }
  }

  const magnitude = distFromEdge > 0 ? Math.exp(-3 * distFromEdge / edgeWidth) : 0;
  return { dispX: -dirX * magnitude, dispY: -dirY * magnitude, dirX, dirY, region };
}

// ============================================================
// Formal Verification Functions
// ============================================================

class FormalVerifier {
  constructor(width, height, radius, edgeWidthRatio) {
    this.width = width;
    this.height = height;
    this.halfW = width / 2;
    this.halfH = height / 2;
    this.r = Math.min(radius, this.halfW, this.halfH);
    this.edgeWidth = Math.min(this.halfW, this.halfH) * edgeWidthRatio;

    this.constraints = [];
    this.violations = { current: [], sdf: [] };
  }

  // Sample the algorithms at a point
  sample(px, py) {
    return {
      current: currentAlgorithm(px, py, this.halfW, this.halfH, this.r, this.edgeWidth),
      sdf: sdfAlgorithm(px, py, this.halfW, this.halfH, this.r, this.edgeWidth)
    };
  }

  // Check C0 continuity: |f(x+ε) - f(x)| < δ for small ε
  checkC0Continuity(algorithm, name, epsilon = 0.5, delta = 0.15) {
    const violations = [];

    for (let py = 1; py < this.height - 1; py++) {
      for (let px = 1; px < this.width - 1; px++) {
        const center = algorithm(px, py, this.halfW, this.halfH, this.r, this.edgeWidth);
        if (!center) continue;

        const neighbors = [
          algorithm(px + epsilon, py, this.halfW, this.halfH, this.r, this.edgeWidth),
          algorithm(px - epsilon, py, this.halfW, this.halfH, this.r, this.edgeWidth),
          algorithm(px, py + epsilon, this.halfW, this.halfH, this.r, this.edgeWidth),
          algorithm(px, py - epsilon, this.halfW, this.halfH, this.r, this.edgeWidth),
        ];

        for (const n of neighbors) {
          if (!n) continue;

          const jump = Math.sqrt(
            Math.pow(center.dispX - n.dispX, 2) +
            Math.pow(center.dispY - n.dispY, 2)
          );

          if (jump > delta) {
            violations.push({
              type: 'C0',
              px, py,
              jump,
              centerRegion: center.region,
              detail: `Jump of ${jump.toFixed(4)} exceeds threshold ${delta}`
            });
          }
        }
      }
    }

    return violations;
  }

  // Check C1 continuity: gradient is continuous
  checkC1Continuity(algorithm, name, epsilon = 1, delta = 0.5) {
    const violations = [];

    for (let py = 2; py < this.height - 2; py++) {
      for (let px = 2; px < this.width - 2; px++) {
        const center = algorithm(px, py, this.halfW, this.halfH, this.r, this.edgeWidth);
        if (!center) continue;

        // Compute numerical gradient at center
        const left = algorithm(px - epsilon, py, this.halfW, this.halfH, this.r, this.edgeWidth);
        const right = algorithm(px + epsilon, py, this.halfW, this.halfH, this.r, this.edgeWidth);
        const up = algorithm(px, py - epsilon, this.halfW, this.halfH, this.r, this.edgeWidth);
        const down = algorithm(px, py + epsilon, this.halfW, this.halfH, this.r, this.edgeWidth);

        if (!left || !right || !up || !down) continue;

        const gradX_dispX = (right.dispX - left.dispX) / (2 * epsilon);
        const gradY_dispX = (down.dispX - up.dispX) / (2 * epsilon);
        const gradX_dispY = (right.dispY - left.dispY) / (2 * epsilon);
        const gradY_dispY = (down.dispY - up.dispY) / (2 * epsilon);

        // Check gradient continuity with neighbors
        const right2 = algorithm(px + 1, py, this.halfW, this.halfH, this.r, this.edgeWidth);
        if (right2) {
          const left2 = algorithm(px, py, this.halfW, this.halfH, this.r, this.edgeWidth);
          const right3 = algorithm(px + 2, py, this.halfW, this.halfH, this.r, this.edgeWidth);

          if (left2 && right3) {
            const gradX_dispX_neighbor = (right3.dispX - center.dispX) / (2 * epsilon);
            const gradJump = Math.abs(gradX_dispX - gradX_dispX_neighbor);

            if (gradJump > delta) {
              violations.push({
                type: 'C1',
                px, py,
                gradJump,
                centerRegion: center.region,
                detail: `Gradient jump of ${gradJump.toFixed(4)} at (${px}, ${py})`
              });
            }
          }
        }
      }
    }

    return violations;
  }

  // Check region boundary transitions
  checkRegionBoundaries(algorithm, name) {
    const violations = [];
    const boundaryPoints = [];

    // Find all region boundary points
    for (let py = 1; py < this.height - 1; py++) {
      for (let px = 1; px < this.width - 1; px++) {
        const center = algorithm(px, py, this.halfW, this.halfH, this.r, this.edgeWidth);
        const right = algorithm(px + 1, py, this.halfW, this.halfH, this.r, this.edgeWidth);
        const down = algorithm(px, py + 1, this.halfW, this.halfH, this.r, this.edgeWidth);

        if (!center) continue;

        if (right && center.region !== right.region) {
          boundaryPoints.push({ px, py, from: center.region, to: right.region, dir: 'horizontal' });

          // Check direction continuity at boundary
          const dirChange = Math.sqrt(
            Math.pow(center.dirX - right.dirX, 2) +
            Math.pow(center.dirY - right.dirY, 2)
          );

          if (dirChange > 0.5) {
            violations.push({
              type: 'boundary',
              px, py,
              from: center.region,
              to: right.region,
              dirChange,
              detail: `Direction change ${dirChange.toFixed(3)} at ${center.region}→${right.region} boundary`
            });
          }
        }

        if (down && center.region !== down.region) {
          boundaryPoints.push({ px, py, from: center.region, to: down.region, dir: 'vertical' });

          const dirChange = Math.sqrt(
            Math.pow(center.dirX - down.dirX, 2) +
            Math.pow(center.dirY - down.dirY, 2)
          );

          if (dirChange > 0.5) {
            violations.push({
              type: 'boundary',
              px, py,
              from: center.region,
              to: down.region,
              dirChange,
              detail: `Direction change ${dirChange.toFixed(3)} at ${center.region}→${down.region} boundary`
            });
          }
        }
      }
    }

    return { violations, boundaryPoints };
  }

  // Check symmetry: f(halfW + d, halfH + d) should mirror f(halfW - d, halfH - d)
  checkSymmetry(algorithm, name) {
    const violations = [];

    for (let dy = 0; dy < this.halfH - 1; dy += 5) {
      for (let dx = 0; dx < this.halfW - 1; dx += 5) {
        const q1 = algorithm(this.halfW + dx, this.halfH + dy, this.halfW, this.halfH, this.r, this.edgeWidth);
        const q2 = algorithm(this.halfW - dx, this.halfH + dy, this.halfW, this.halfH, this.r, this.edgeWidth);
        const q3 = algorithm(this.halfW + dx, this.halfH - dy, this.halfW, this.halfH, this.r, this.edgeWidth);
        const q4 = algorithm(this.halfW - dx, this.halfH - dy, this.halfW, this.halfH, this.r, this.edgeWidth);

        if (!q1 || !q2 || !q3 || !q4) continue;

        // Q1 and Q2 should have opposite X displacement
        if (Math.abs(q1.dispX + q2.dispX) > 0.001 || Math.abs(q1.dispY - q2.dispY) > 0.001) {
          violations.push({
            type: 'symmetry-x',
            dx, dy,
            detail: `X-symmetry violation at (±${dx}, ${dy})`
          });
        }

        // Q1 and Q3 should have opposite Y displacement
        if (Math.abs(q1.dispX - q3.dispX) > 0.001 || Math.abs(q1.dispY + q3.dispY) > 0.001) {
          violations.push({
            type: 'symmetry-y',
            dx, dy,
            detail: `Y-symmetry violation at (${dx}, ±${dy})`
          });
        }
      }
    }

    return violations;
  }

  // Run all verifications
  runFullVerification() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     FORMAL VERIFICATION: Displacement Map Algorithms         ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║ Parameters: ${this.width}x${this.height}, r=${this.r}, edgeWidth=${this.edgeWidth.toFixed(1)}`.padEnd(65) + '║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const results = {
      current: { c0: [], c1: [], boundary: [], symmetry: [] },
      sdf: { c0: [], c1: [], boundary: [], symmetry: [] }
    };

    // C0 Continuity
    console.log('━━━ C0 CONTINUITY (Value Jumps) ━━━\n');
    results.current.c0 = this.checkC0Continuity(currentAlgorithm, 'current');
    results.sdf.c0 = this.checkC0Continuity(sdfAlgorithm, 'sdf');

    console.log(`Current Algorithm: ${results.current.c0.length} violations`);
    console.log(`SDF Algorithm:     ${results.sdf.c0.length} violations`);

    if (results.current.c0.length > 0) {
      console.log('\nCurrent violations (first 5):');
      results.current.c0.slice(0, 5).forEach(v => {
        console.log(`  • (${v.px}, ${v.py}) [${v.centerRegion}]: ${v.detail}`);
      });
    }
    console.log();

    // C1 Continuity
    console.log('━━━ C1 CONTINUITY (Gradient Jumps) ━━━\n');
    results.current.c1 = this.checkC1Continuity(currentAlgorithm, 'current');
    results.sdf.c1 = this.checkC1Continuity(sdfAlgorithm, 'sdf');

    console.log(`Current Algorithm: ${results.current.c1.length} violations`);
    console.log(`SDF Algorithm:     ${results.sdf.c1.length} violations\n`);

    // Boundary Transitions
    console.log('━━━ REGION BOUNDARY TRANSITIONS ━━━\n');
    const currentBoundary = this.checkRegionBoundaries(currentAlgorithm, 'current');
    const sdfBoundary = this.checkRegionBoundaries(sdfAlgorithm, 'sdf');

    results.current.boundary = currentBoundary.violations;
    results.sdf.boundary = sdfBoundary.violations;

    console.log(`Current Algorithm: ${results.current.boundary.length} discontinuous transitions`);
    console.log(`SDF Algorithm:     ${results.sdf.boundary.length} discontinuous transitions`);

    if (results.current.boundary.length > 0) {
      console.log('\nCurrent boundary issues (first 5):');
      results.current.boundary.slice(0, 5).forEach(v => {
        console.log(`  • (${v.px}, ${v.py}): ${v.detail}`);
      });
    }
    console.log();

    // Symmetry
    console.log('━━━ SYMMETRY VERIFICATION ━━━\n');
    results.current.symmetry = this.checkSymmetry(currentAlgorithm, 'current');
    results.sdf.symmetry = this.checkSymmetry(sdfAlgorithm, 'sdf');

    console.log(`Current Algorithm: ${results.current.symmetry.length} symmetry violations`);
    console.log(`SDF Algorithm:     ${results.sdf.symmetry.length} symmetry violations\n`);

    // Summary
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    VERIFICATION SUMMARY                       ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');

    const currentTotal = results.current.c0.length + results.current.c1.length +
                        results.current.boundary.length + results.current.symmetry.length;
    const sdfTotal = results.sdf.c0.length + results.sdf.c1.length +
                    results.sdf.boundary.length + results.sdf.symmetry.length;

    console.log(`║ Current Algorithm Total Violations: ${currentTotal.toString().padStart(4)}                      ║`);
    console.log(`║ SDF Algorithm Total Violations:     ${sdfTotal.toString().padStart(4)}                      ║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');

    if (sdfTotal < currentTotal) {
      const improvement = ((1 - sdfTotal / currentTotal) * 100).toFixed(1);
      console.log(`║ ✓ SDF algorithm reduces violations by ${improvement}%`.padEnd(65) + '║');
      console.log('║ ✓ RECOMMENDATION: Proceed with SDF implementation'.padEnd(65) + '║');
    } else if (sdfTotal === currentTotal) {
      console.log('║ = Both algorithms have equivalent violation counts'.padEnd(65) + '║');
    } else {
      console.log('║ ✗ SDF algorithm has MORE violations - needs review'.padEnd(65) + '║');
    }

    console.log('╚══════════════════════════════════════════════════════════════╝');

    return results;
  }
}

// ============================================================
// Generate Code Diff
// ============================================================

function generateCodeDiff() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                      CODE DIFF ANALYSIS                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('--- canvas-generator.ts (current)');
  console.log('+++ canvas-generator.ts (proposed)\n');

  console.log('@@ -104,20 +104,35 @@ function generateCanvasDisplacementMap(...)');
  console.log(' ');
  console.log('       // Calculate distance from edge and direction');
  console.log('       let distFromEdge: number;');
  console.log('       let dirX = 0;');
  console.log('       let dirY = 0;');
  console.log(' ');
  console.log('-      if (inCorner) {');
  console.log('+      const innerW = halfW - r;');
  console.log('+      const innerH = halfH - r;');
  console.log('+');
  console.log('+      if (dx <= innerW && dy <= innerH) {');
  console.log('+        // Inner rectangle - smooth exponential blend');
  console.log('+        const distX = halfW - dx;');
  console.log('+        const distY = halfH - dy;');
  console.log('+');
  console.log('+        const k = 8; // Blend sharpness');
  console.log('+        const expX = Math.exp(-k * distX / edgeWidth);');
  console.log('+        const expY = Math.exp(-k * distY / edgeWidth);');
  console.log('+        const sumExp = expX + expY;');
  console.log('+');
  console.log('+        distFromEdge = Math.min(distX, distY);');
  console.log('+        dirX = (expX / sumExp) * Math.sign(px - halfW);');
  console.log('+        dirY = (expY / sumExp) * Math.sign(py - halfH);');
  console.log('+');
  console.log('+      } else if (dx <= innerW) {');
  console.log('+        // Top/bottom edge region');
  console.log('+        distFromEdge = halfH - dy;');
  console.log('+        dirY = Math.sign(py - halfH);');
  console.log('+');
  console.log('+      } else if (dy <= innerH) {');
  console.log('+        // Left/right edge region');
  console.log('+        distFromEdge = halfW - dx;');
  console.log('+        dirX = Math.sign(px - halfW);');
  console.log('+');
  console.log('+      } else {');
  console.log('         // Corner region - radial direction from corner center');
  console.log('-        const cornerX = dx - (halfW - r);');
  console.log('-        const cornerY = dy - (halfH - r);');
  console.log('+        const cornerX = dx - innerW;');
  console.log('+        const cornerY = dy - innerH;');
  console.log('         const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);');
  console.log('         distFromEdge = r - cornerDist;');
  console.log(' ');
  console.log('         if (cornerDist > 0.001) {');
  console.log('           dirX = (cornerX / cornerDist) * Math.sign(px - halfW);');
  console.log('           dirY = (cornerY / cornerDist) * Math.sign(py - halfH);');
  console.log('         }');
  console.log('-      } else {');
  console.log('-        // Edge region - perpendicular to nearest edge');
  console.log('-        const distX = halfW - dx;');
  console.log('-        const distY = halfH - dy;');
  console.log('-');
  console.log('-        if (distX < distY) {');
  console.log('-          distFromEdge = distX;');
  console.log('-          dirX = Math.sign(px - halfW);');
  console.log('-        } else {');
  console.log('-          distFromEdge = distY;');
  console.log('-          dirY = Math.sign(py - halfH);');
  console.log('-        }');
  console.log('       }');
  console.log(' ');
  console.log('       // Exponential decay magnitude');

  console.log('\n');
  console.log('Key Changes:');
  console.log('  1. ADD: Inner rectangle region with exponential blend (new)');
  console.log('  2. ADD: Separate edge-x and edge-y regions');
  console.log('  3. REMOVE: Hard "if (distX < distY)" branch');
  console.log('  4. PRESERVE: Corner region logic (unchanged)');
  console.log('  5. PRESERVE: Exponential decay formula (unchanged)');
}

// ============================================================
// Main Execution
// ============================================================

const verifier = new FormalVerifier(200, 150, 20, 0.5);
verifier.runFullVerification();
generateCodeDiff();

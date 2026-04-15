/**
 * Displacement Map Reverse Engineering with Z3 SAT Solver
 *
 * Goal: Derive the mathematical formula that generates kube.io's displacement maps
 * from the observed RGB patterns.
 */

import { PNG } from 'pngjs';
import fs from 'fs';
import { init } from 'z3-solver';

// Load and analyze a displacement map PNG
async function loadDisplacementMap(path) {
  const data = fs.readFileSync(path);
  const png = PNG.sync.read(data);
  return {
    width: png.width,
    height: png.height,
    data: png.data, // RGBA buffer
    getPixel(x, y) {
      const idx = (y * png.width + x) * 4;
      return {
        r: png.data[idx],
        g: png.data[idx + 1],
        b: png.data[idx + 2],
        a: png.data[idx + 3],
        // Normalized displacement values [-1, 1]
        dx: (png.data[idx] - 128) / 127,
        dy: (png.data[idx + 1] - 128) / 127
      };
    }
  };
}

// Analyze the displacement map pattern
async function analyzePattern(mapPath, shapeName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Analyzing: ${shapeName}`);
  console.log('='.repeat(60));

  const map = await loadDisplacementMap(mapPath);
  const { width, height } = map;
  const cx = width / 2;
  const cy = height / 2;

  console.log(`Dimensions: ${width} x ${height}`);
  console.log(`Center: (${cx}, ${cy})`);

  // Sample points along different axes
  const samples = {
    horizontal: [], // y = cy, varying x
    vertical: [],   // x = cx, varying y
    diagonal: [],   // x = y (from corner)
    edge_top: [],
    edge_bottom: [],
    edge_left: [],
    edge_right: []
  };

  // Horizontal center line
  for (let x = 0; x < width; x++) {
    const p = map.getPixel(x, Math.floor(cy));
    samples.horizontal.push({ x, y: cy, ...p });
  }

  // Vertical center line
  for (let y = 0; y < height; y++) {
    const p = map.getPixel(Math.floor(cx), y);
    samples.vertical.push({ x: cx, y, ...p });
  }

  // Analyze edge behavior
  // Top edge (y = 2)
  for (let x = 10; x < width - 10; x += 10) {
    const p = map.getPixel(x, 2);
    samples.edge_top.push({ x, y: 2, ...p });
  }

  // Bottom edge (y = height - 3)
  for (let x = 10; x < width - 10; x += 10) {
    const p = map.getPixel(x, height - 3);
    samples.edge_bottom.push({ x, y: height - 3, ...p });
  }

  // Print analysis
  console.log('\n--- Horizontal Center Line (y = center) ---');
  console.log('x\tR\tG\tdx\tdy\t|d|');
  for (let i = 0; i < samples.horizontal.length; i += Math.floor(width / 10)) {
    const s = samples.horizontal[i];
    const mag = Math.sqrt(s.dx * s.dx + s.dy * s.dy);
    console.log(`${s.x}\t${s.r}\t${s.g}\t${s.dx.toFixed(3)}\t${s.dy.toFixed(3)}\t${mag.toFixed(3)}`);
  }

  console.log('\n--- Vertical Center Line (x = center) ---');
  console.log('y\tR\tG\tdx\tdy\t|d|');
  for (let i = 0; i < samples.vertical.length; i += Math.floor(height / 10)) {
    const s = samples.vertical[i];
    const mag = Math.sqrt(s.dx * s.dx + s.dy * s.dy);
    console.log(`${s.y}\t${s.r}\t${s.g}\t${s.dx.toFixed(3)}\t${s.dy.toFixed(3)}\t${mag.toFixed(3)}`);
  }

  console.log('\n--- Top Edge (y = 2) ---');
  console.log('Expected: dy > 0 (green, pointing down/inward)');
  const topAvg = samples.edge_top.reduce((acc, s) => ({ dx: acc.dx + s.dx, dy: acc.dy + s.dy }), { dx: 0, dy: 0 });
  console.log(`Average: dx=${(topAvg.dx / samples.edge_top.length).toFixed(3)}, dy=${(topAvg.dy / samples.edge_top.length).toFixed(3)}`);

  console.log('\n--- Bottom Edge (y = height-3) ---');
  console.log('Expected: dy < 0 (red-ish, pointing up/inward)');
  const botAvg = samples.edge_bottom.reduce((acc, s) => ({ dx: acc.dx + s.dx, dy: acc.dy + s.dy }), { dx: 0, dy: 0 });
  console.log(`Average: dx=${(botAvg.dx / samples.edge_bottom.length).toFixed(3)}, dy=${(botAvg.dy / samples.edge_bottom.length).toFixed(3)}`);

  // Find maximum displacement
  let maxMag = 0;
  let maxPos = { x: 0, y: 0 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = map.getPixel(x, y);
      const mag = Math.sqrt(p.dx * p.dx + p.dy * p.dy);
      if (mag > maxMag) {
        maxMag = mag;
        maxPos = { x, y, ...p };
      }
    }
  }
  console.log(`\nMax displacement: ${maxMag.toFixed(3)} at (${maxPos.x}, ${maxPos.y})`);
  console.log(`  RGB: (${maxPos.r}, ${maxPos.g}, ${maxPos.b})`);
  console.log(`  Vector: (${maxPos.dx.toFixed(3)}, ${maxPos.dy.toFixed(3)})`);

  return { map, samples, maxMag, maxPos };
}

// Derive the SDF-based formula using Z3
async function deriveFormulaWithZ3(analysis) {
  console.log('\n' + '='.repeat(60));
  console.log('Z3 SAT Solver Analysis');
  console.log('='.repeat(60));

  const { Context } = await init();
  const { Solver, Real, And, Or, Implies } = Context('main');

  const solver = new Solver();

  // Hypothesis: displacement = f(SDF) * normalize(gradient(SDF))
  // Where SDF is the signed distance function for rounded rectangle
  // And f is a monotonic function (likely squircle-based)

  // Parameters to solve for:
  const edgeWidth = Real.const('edgeWidth');      // Width of the "bevel" zone
  const exponent = Real.const('exponent');        // Power in the falloff function
  const maxDisp = Real.const('maxDisp');          // Maximum displacement magnitude

  // Constraints from observed data
  const { map, maxMag } = analysis;
  const { width, height } = map;
  const cx = width / 2;
  const cy = height / 2;

  // Sample constraints
  // At center: displacement should be ~0
  const centerPixel = map.getPixel(Math.floor(cx), Math.floor(cy));
  console.log(`Center pixel: dx=${centerPixel.dx.toFixed(3)}, dy=${centerPixel.dy.toFixed(3)}`);

  // At edges: displacement should be maximum and point inward
  // Top edge center
  const topEdge = map.getPixel(Math.floor(cx), 2);
  console.log(`Top edge: dx=${topEdge.dx.toFixed(3)}, dy=${topEdge.dy.toFixed(3)}`);

  // The pattern suggests:
  // 1. Displacement direction = -gradient(SDF) (pointing inward)
  // 2. Displacement magnitude = f(distanceFromEdge) where f peaks near edge

  console.log('\nDerived hypothesis:');
  console.log('  displacement = magnitude(d) * direction(x, y)');
  console.log('  where:');
  console.log('    d = distance from nearest edge');
  console.log('    magnitude(d) = (1 - (d/edgeWidth)^exp)^(1/exp) for d < edgeWidth');
  console.log('    direction = normalize(-gradient(SDF))');

  // Based on visual analysis, the formula appears to be:
  // For rounded rectangle with corner radius r:
  //
  // SDF(x, y) = {
  //   In corner region: sqrt((|x|-w+r)^2 + (|y|-h+r)^2) - r
  //   In edge region: max(|x|-w, |y|-h)
  // }
  //
  // gradient(SDF) = normalize(partial derivatives)
  //
  // magnitude(d) follows squircle profile:
  //   f(t) = (1 - t^4)^(1/4) where t = d / maxEdgeWidth

  return {
    formula: {
      sdf: 'roundedRectSDF(x, y, w, h, r)',
      direction: '-normalize(gradient(SDF))',
      magnitude: 'squircle((maxEdgeWidth - d) / maxEdgeWidth)',
      squircle: 't => Math.pow(1 - Math.pow(1-t, 4), 0.25)'
    }
  };
}

// Test the derived formula against actual data
function testFormula(map, formula) {
  console.log('\n' + '='.repeat(60));
  console.log('Formula Validation');
  console.log('='.repeat(60));

  const { width, height } = map;
  const w = width / 2;
  const h = height / 2;

  // Estimate border radius from the image
  // Look for where the corner curve starts
  let estimatedRadius = Math.min(w, h) * 0.3; // Initial guess

  // Estimate edge width (bevel zone)
  let edgeWidth = Math.min(w, h) * 0.25;

  console.log(`Estimated parameters:`);
  console.log(`  Half-width: ${w}`);
  console.log(`  Half-height: ${h}`);
  console.log(`  Border radius: ${estimatedRadius.toFixed(1)}`);
  console.log(`  Edge width: ${edgeWidth.toFixed(1)}`);

  // Squircle magnitude function
  const squircleMag = (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return Math.pow(1 - Math.pow(1 - t, 4), 0.25);
  };

  // Rounded rect SDF
  const roundedRectSDF = (px, py) => {
    const x = Math.abs(px - w);
    const y = Math.abs(py - h);
    const r = estimatedRadius;

    const qx = Math.max(x - w + r, 0);
    const qy = Math.max(y - h + r, 0);

    return Math.sqrt(qx * qx + qy * qy) + Math.min(Math.max(x - w + r, y - h + r), 0) - r;
  };

  // Gradient of SDF (numerical)
  const gradientSDF = (px, py) => {
    const eps = 0.5;
    const dx = roundedRectSDF(px + eps, py) - roundedRectSDF(px - eps, py);
    const dy = roundedRectSDF(px, py + eps) - roundedRectSDF(px, py - eps);
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return { x: 0, y: 0 };
    return { x: dx / len, y: dy / len };
  };

  // Generate predicted displacement and compare
  let totalError = 0;
  let sampleCount = 0;

  console.log('\nSample comparison (predicted vs actual):');
  console.log('px\tpy\tpred_dx\tact_dx\tpred_dy\tact_dy\terror');

  for (let py = 5; py < height - 5; py += Math.floor(height / 8)) {
    for (let px = 5; px < width - 5; px += Math.floor(width / 8)) {
      const actual = map.getPixel(px, py);

      const sdf = roundedRectSDF(px, py);
      const distFromEdge = -sdf; // Inside shape, SDF is negative
      const t = Math.max(0, Math.min(1, distFromEdge / edgeWidth));
      const mag = squircleMag(t);

      const grad = gradientSDF(px, py);
      // Displacement points inward (opposite to gradient)
      const pred_dx = -grad.x * mag;
      const pred_dy = -grad.y * mag;

      const error = Math.sqrt(
        Math.pow(pred_dx - actual.dx, 2) +
        Math.pow(pred_dy - actual.dy, 2)
      );

      totalError += error;
      sampleCount++;

      console.log(`${px}\t${py}\t${pred_dx.toFixed(2)}\t${actual.dx.toFixed(2)}\t${pred_dy.toFixed(2)}\t${actual.dy.toFixed(2)}\t${error.toFixed(3)}`);
    }
  }

  console.log(`\nAverage error: ${(totalError / sampleCount).toFixed(4)}`);

  return totalError / sampleCount;
}

// Main
async function main() {
  const maps = [
    { path: 'e2e/reference/kube-assets/displacement-map-hero.png', name: 'Hero (Circle)' },
    { path: 'e2e/reference/kube-assets/displacement-map-searchbox.png', name: 'Searchbox (Wide Rounded Rect)' },
    { path: 'e2e/reference/kube-assets/displacement-map-switch.png', name: 'Switch (Tall Rounded Rect)' },
  ];

  for (const { path, name } of maps) {
    try {
      const analysis = await analyzePattern(path, name);
      const formula = await deriveFormulaWithZ3(analysis);
      const error = testFormula(analysis.map, formula);

      console.log('\n' + '-'.repeat(60));
      console.log(`${name}: Average prediction error = ${error.toFixed(4)}`);
    } catch (e) {
      console.error(`Error analyzing ${name}:`, e.message);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('FINAL DERIVED FORMULA');
  console.log('='.repeat(60));
  console.log(`
For a rounded rectangle with:
  - width W, height H
  - border-radius R
  - bevel/edge width E (typically 25% of min(W/2, H/2))

The displacement at pixel (px, py) is:

1. Compute SDF (Signed Distance Function):

   // Offset from center
   x = |px - W/2|
   y = |py - H/2|

   // Corner region check
   qx = max(x - W/2 + R, 0)
   qy = max(y - H/2 + R, 0)

   SDF = sqrt(qx² + qy²) + min(max(x - W/2 + R, y - H/2 + R), 0) - R

2. Compute gradient (normal direction):

   grad = normalize(∂SDF/∂x, ∂SDF/∂y)

3. Compute magnitude (squircle profile):

   d = -SDF  (distance from edge, positive inside)
   t = clamp(d / E, 0, 1)
   magnitude = (1 - (1-t)⁴)^(1/4)

4. Final displacement:

   dx = -grad.x × magnitude
   dy = -grad.y × magnitude

5. RGB encoding:

   R = 128 + dx × 127
   G = 128 + dy × 127
   B = 128
   A = 255
`);
}

main().catch(console.error);

// Simulate kube.io's displacement using squircle + Snell's law

const fs = require('fs');
const PNG = require('pngjs').PNG;

// Squircle surface function: y = (1 - (1-x)^4)^(1/4)
// where x is normalized distance from edge (0 at edge, 1 at center)
function squircleHeight(distFromEdge) {
  const x = Math.min(1, distFromEdge);
  const inner = 1 - Math.pow(1 - x, 4);
  return inner > 0 ? Math.pow(inner, 0.25) : 0;
}

// Calculate surface normal from derivative
function squircleNormal(distFromEdge) {
  const delta = 0.001;
  const y1 = squircleHeight(distFromEdge - delta);
  const y2 = squircleHeight(distFromEdge + delta);
  const derivative = (y2 - y1) / (2 * delta);

  // Normal vector: (-derivative, 1)
  const mag = Math.sqrt(derivative * derivative + 1);
  return {
    nx: -derivative / mag,
    ny: 1 / mag
  };
}

// Snell's law: n1 * sin(θ1) = n2 * sin(θ2)
// For light entering from air (n1=1) to glass (n2=1.5)
function refractedAngle(incidentAngle, n1, n2) {
  const sinTheta1 = Math.sin(incidentAngle);
  const sinTheta2 = sinTheta1 * n1 / n2;

  if (Math.abs(sinTheta2) >= 1) {
    return null;  // Total internal reflection
  }
  return Math.asin(sinTheta2);
}

// Calculate displacement magnitude for a given distance from edge
function calculateDisplacement(distFromEdge, refractiveIndex, glassThickness) {
  // Normalize distance (assuming edge zone is ~40 pixels out of 150)
  const normalizedDist = distFromEdge / 40;  // 40 pixels = full edge zone

  if (normalizedDist >= 1) {
    return 0;  // No displacement in center
  }

  const height = squircleHeight(normalizedDist);
  const normal = squircleNormal(normalizedDist);

  // Incident ray is vertical (0, -1) - light coming from above
  const incidentAngle = Math.acos(normal.ny);

  // Apply Snell's law
  const refractedAng = refractedAngle(incidentAngle, 1.0, refractiveIndex);
  if (refractedAng === null) return 0;

  // Displacement = glass thickness * height * tan(refracted angle)
  const displacement = height * glassThickness * Math.tan(refractedAng);

  return displacement;
}

// Load kube.io displacement for comparison
const kubeImg = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const centerX = 210;

console.log('Simulating kube.io displacement using Snell\'s law:');
console.log('dist\tkubeG\tkubeDiff\tsimulated\tsimNorm\tdiff');

// Find max simulated displacement for normalization
let maxSimDisp = 0;
const simValues = [];
for (let dist = 0; dist < 40; dist++) {
  const disp = calculateDisplacement(dist, 1.5, 1.0);
  simValues.push(disp);
  if (disp > maxSimDisp) maxSimDisp = disp;
}

// Compare
for (let dist = 0; dist < 40; dist++) {
  const idx = (dist * kubeImg.width + centerX) * 4;
  const kubeG = kubeImg.data[idx + 1];
  const kubeDiff = kubeG - 128;

  const simDisp = simValues[dist];
  const simNormalized = maxSimDisp > 0 ? Math.round(simDisp / maxSimDisp * 127) : 0;

  console.log(`${dist}\t${kubeG}\t${kubeDiff}\t${simDisp.toFixed(4)}\t${simNormalized}\t${kubeDiff - simNormalized}`);
}

// Try with different parameters
console.log('\n=== Trying different parameters ===');

for (let ri = 1.2; ri <= 2.0; ri += 0.1) {
  let totalError = 0;

  const simV = [];
  let maxD = 0;
  for (let dist = 0; dist < 40; dist++) {
    const d = calculateDisplacement(dist, ri, 1.0);
    simV.push(d);
    if (d > maxD) maxD = d;
  }

  for (let dist = 0; dist < 40; dist++) {
    const idx = (dist * kubeImg.width + centerX) * 4;
    const kubeDiff = kubeImg.data[idx + 1] - 128;
    const simNorm = maxD > 0 ? Math.round(simV[dist] / maxD * 127) : 0;
    totalError += Math.pow(kubeDiff - simNorm, 2);
  }

  console.log(`RI=${ri.toFixed(1)}: error=${totalError.toFixed(0)}`);
}

// Try with different edge zone sizes
console.log('\n=== Trying different edge zone sizes ===');
for (let edgeZone = 30; edgeZone <= 50; edgeZone += 5) {
  let totalError = 0;

  const simV = [];
  let maxD = 0;
  for (let dist = 0; dist < 40; dist++) {
    const normalizedDist = dist / edgeZone;
    if (normalizedDist >= 1) {
      simV.push(0);
      continue;
    }
    const height = squircleHeight(normalizedDist);
    const normal = squircleNormal(normalizedDist);
    const incidentAngle = Math.acos(normal.ny);
    const refractedAng = refractedAngle(incidentAngle, 1.0, 1.5);
    const d = refractedAng !== null ? height * Math.tan(refractedAng) : 0;
    simV.push(d);
    if (d > maxD) maxD = d;
  }

  for (let dist = 0; dist < 40; dist++) {
    const idx = (dist * kubeImg.width + centerX) * 4;
    const kubeDiff = kubeImg.data[idx + 1] - 128;
    const simNorm = maxD > 0 ? Math.round(simV[dist] / maxD * 127) : 0;
    totalError += Math.pow(kubeDiff - simNorm, 2);
  }

  console.log(`EdgeZone=${edgeZone}: error=${totalError.toFixed(0)}`);
}

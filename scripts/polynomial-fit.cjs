const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Extract boundaries
const points = [];
for (let y = 0; y <= 150; y++) {
  let boundary = 0;
  for (let x = 0; x < width / 2; x++) {
    if (getPixel(x, y).r !== 128) {
      boundary = x;
      break;
    }
  }
  points.push({ x: y, y: boundary });
}

// Simple polynomial regression using normal equations
function polyFit(data, degree) {
  const n = data.length;
  
  // Build Vandermonde matrix
  const X = [];
  const Y = data.map(p => p.y);
  
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j <= degree; j++) {
      row.push(Math.pow(data[i].x, j));
    }
    X.push(row);
  }
  
  // Solve X^T * X * coeffs = X^T * Y using Gaussian elimination
  const XtX = [];
  const XtY = [];
  
  for (let i = 0; i <= degree; i++) {
    XtX[i] = [];
    XtY[i] = 0;
    for (let j = 0; j <= degree; j++) {
      XtX[i][j] = 0;
      for (let k = 0; k < n; k++) {
        XtX[i][j] += X[k][i] * X[k][j];
      }
    }
    for (let k = 0; k < n; k++) {
      XtY[i] += X[k][i] * Y[k];
    }
  }
  
  // Gaussian elimination
  for (let i = 0; i <= degree; i++) {
    // Find pivot
    let maxRow = i;
    for (let k = i + 1; k <= degree; k++) {
      if (Math.abs(XtX[k][i]) > Math.abs(XtX[maxRow][i])) {
        maxRow = k;
      }
    }
    [XtX[i], XtX[maxRow]] = [XtX[maxRow], XtX[i]];
    [XtY[i], XtY[maxRow]] = [XtY[maxRow], XtY[i]];
    
    // Eliminate
    for (let k = i + 1; k <= degree; k++) {
      const c = XtX[k][i] / XtX[i][i];
      for (let j = i; j <= degree; j++) {
        XtX[k][j] -= c * XtX[i][j];
      }
      XtY[k] -= c * XtY[i];
    }
  }
  
  // Back substitution
  const coeffs = new Array(degree + 1);
  for (let i = degree; i >= 0; i--) {
    coeffs[i] = XtY[i];
    for (let j = i + 1; j <= degree; j++) {
      coeffs[i] -= XtX[i][j] * coeffs[j];
    }
    coeffs[i] /= XtX[i][i];
  }
  
  return coeffs;
}

function evalPoly(coeffs, x) {
  let result = 0;
  for (let i = 0; i < coeffs.length; i++) {
    result += coeffs[i] * Math.pow(x, i);
  }
  return result;
}

console.log('Polynomial fit for boundary = f(minDistTB):');
console.log('');

for (let degree = 2; degree <= 5; degree++) {
  const coeffs = polyFit(points, degree);
  let error = 0;
  points.forEach(p => {
    const predicted = evalPoly(coeffs, p.x);
    error += Math.abs(predicted - p.y);
  });
  
  console.log(`Degree ${degree}: error=${error.toFixed(1)}`);
  console.log(`  Coefficients: ${coeffs.map(c => c.toFixed(6)).join(', ')}`);
  
  // Show formula
  let formula = '';
  for (let i = coeffs.length - 1; i >= 0; i--) {
    const c = coeffs[i];
    if (i === coeffs.length - 1) {
      formula = `${c.toFixed(6)}*x^${i}`;
    } else if (i > 1) {
      formula += ` + ${c.toFixed(6)}*x^${i}`;
    } else if (i === 1) {
      formula += ` + ${c.toFixed(6)}*x`;
    } else {
      formula += ` + ${c.toFixed(6)}`;
    }
  }
  console.log(`  Formula: ${formula}`);
  console.log('');
}

// Best fit appears to be degree 3 or 4
console.log('=== Testing degree 3 polynomial ===');
const coeffs3 = polyFit(points, 3);
console.log('Sample predictions:');
[0, 10, 20, 50, 100, 140].forEach(x => {
  const actual = points[x] ? points[x].y : 0;
  const predicted = Math.round(evalPoly(coeffs3, x));
  console.log(`  minDistTB=${x}: actual=${actual}, predicted=${predicted}`);
});

// Maybe the formula is simpler if we consider 140-minDistTB as the variable
console.log('');
console.log('=== Alternative: fit to (140 - minDistTB) ===');
const altPoints = points.map(p => ({ x: 140 - p.x, y: p.y }));
const altCoeffs = polyFit(altPoints, 2);
console.log(`Coefficients: ${altCoeffs.map(c => c.toFixed(6)).join(', ')}`);
let altError = 0;
altPoints.forEach(p => {
  const predicted = evalPoly(altCoeffs, p.x);
  altError += Math.abs(predicted - p.y);
});
console.log(`Error: ${altError.toFixed(1)}`);

// Check: boundary = a*(140-minDistTB)^2 + b*(140-minDistTB) + c
console.log('');
console.log('Simplified: boundary ≈ a*d^2 + b*d where d = 140 - minDistTB');
// At d=0, boundary=0 => c=0
// At d=140, boundary=140 => a*140^2 + b*140 = 140
// Need one more point: at d=70 (minDistTB=70), boundary=23
// 23 = a*70^2 + b*70
// 23 = 4900a + 70b ... (1)
// 140 = 19600a + 140b ... (2)
// From (2): 1 = 140a + b => b = 1 - 140a
// Sub into (1): 23 = 4900a + 70(1 - 140a) = 4900a + 70 - 9800a = -4900a + 70
// -47 = -4900a => a = 47/4900 = 0.00959
// b = 1 - 140*0.00959 = 1 - 1.343 = -0.343 (negative!)

// Try: boundary = a*d^n for some n
console.log('');
console.log('=== Testing power law: boundary = a * (140 - minDistTB)^n ===');
for (let n = 0.5; n <= 2; n += 0.1) {
  // At d=140, b=140 => a*140^n = 140 => a = 140^(1-n)
  const a = Math.pow(140, 1 - n);
  let err = 0;
  points.forEach(p => {
    const d = 140 - p.x;
    const predicted = a * Math.pow(d, n);
    err += Math.abs(predicted - p.y);
  });
  if (err < 2000) {
    console.log(`  n=${n.toFixed(1)}: a=${a.toFixed(6)}, error=${err.toFixed(1)}`);
  }
}

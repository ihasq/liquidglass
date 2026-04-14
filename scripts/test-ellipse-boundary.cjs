const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Extract boundaries
const boundaries = [];
for (let y = 0; y <= 150; y++) {
  let boundary = 0;
  for (let x = 0; x < width / 2; x++) {
    if (getPixel(x, y).r !== 128) {
      boundary = x;
      break;
    }
  }
  boundaries.push({ minDistTB: y, boundary });
}

console.log('Testing various curve hypotheses for boundary:');
console.log('');

// Test 1: Circle - boundary^2 + minDistTB^2 = R^2
console.log('1. Circle: boundary^2 + minDistTB^2 = R^2');
console.log('   At (0,140): 0 + 140^2 = 19600 => R = 140');
let error1 = 0;
boundaries.forEach(b => {
  const predicted = Math.sqrt(Math.max(0, 19600 - b.minDistTB * b.minDistTB));
  error1 += Math.abs(predicted - b.boundary);
});
console.log(`   Total error: ${error1.toFixed(1)}`);

// Test 2: Squircle - boundary^4 + minDistTB^4 = R^4
console.log('');
console.log('2. Squircle: boundary^4 + minDistTB^4 = R^4');
const R4 = Math.pow(140, 4);
let error2 = 0;
boundaries.forEach(b => {
  const predicted = Math.pow(Math.max(0, R4 - Math.pow(b.minDistTB, 4)), 0.25);
  error2 += Math.abs(predicted - b.boundary);
});
console.log(`   Total error: ${error2.toFixed(1)}`);

// Test 3: Superellipse with various powers
console.log('');
console.log('3. Superellipse: boundary^n + minDistTB^n = 140^n');
for (let n = 1.5; n <= 3; n += 0.25) {
  const Rn = Math.pow(140, n);
  let err = 0;
  boundaries.forEach(b => {
    const predicted = Math.pow(Math.max(0, Rn - Math.pow(b.minDistTB, n)), 1/n);
    err += Math.abs(predicted - b.boundary);
  });
  console.log(`   n=${n.toFixed(2)}: error=${err.toFixed(1)}`);
}

// Test 4: Ellipse with different radii
console.log('');
console.log('4. Ellipse: (boundary/a)^2 + (minDistTB/b)^2 = 1');
for (let a = 130; a <= 150; a += 5) {
  for (let b = 140; b <= 160; b += 5) {
    let err = 0;
    boundaries.forEach(bd => {
      const predicted = a * Math.sqrt(Math.max(0, 1 - Math.pow(bd.minDistTB / b, 2)));
      err += Math.abs(predicted - bd.boundary);
    });
    if (err < 500) {
      console.log(`   a=${a}, b=${b}: error=${err.toFixed(1)}`);
    }
  }
}

// Test 5: Linear relationship - boundary = A * (B - minDistTB)
console.log('');
console.log('5. Linear: boundary = A * (B - minDistTB)');
for (let B = 140; B <= 160; B += 5) {
  const A = 140 / B;
  let err = 0;
  boundaries.forEach(b => {
    const predicted = A * Math.max(0, B - b.minDistTB);
    err += Math.abs(predicted - b.boundary);
  });
  console.log(`   B=${B}, A=${A.toFixed(3)}: error=${err.toFixed(1)}`);
}

// Test 6: Maybe it's just a simple lookup based on corner radius?
console.log('');
console.log('6. Checking if boundary = f(sqrt(minDistTB)):');
console.log('   minDistTB\tsqrt\tboundary\tratio');
for (let i = 0; i <= 140; i += 10) {
  const b = boundaries[i];
  const sqrtMinDist = Math.sqrt(b.minDistTB);
  console.log(`   ${b.minDistTB}\t\t${sqrtMinDist.toFixed(2)}\t${b.boundary}\t\t${b.boundary > 0 ? (sqrtMinDist / b.boundary * 140).toFixed(2) : 'N/A'}`);
}

// Test 7: boundary * sqrt(minDistTB) = constant?
console.log('');
console.log('7. Checking boundary * sqrt(minDistTB):');
boundaries.slice(1, 140).forEach(b => {
  const product = b.boundary * Math.sqrt(b.minDistTB);
  if (b.minDistTB % 20 === 0) {
    console.log(`   minDistTB=${b.minDistTB}: product=${product.toFixed(1)}`);
  }
});

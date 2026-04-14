const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const ourMap = PNG.sync.read(fs.readFileSync('e2e/debug/dispmap-compare/direct-v4.png'));
const { width, height } = kubeMap;

function getKube(x, y) {
  const idx = (y * width + x) * 4;
  return { r: kubeMap.data[idx], g: kubeMap.data[idx + 1] };
}

function getOur(x, y) {
  const idx = (y * width + x) * 4;
  return { r: ourMap.data[idx], g: ourMap.data[idx + 1] };
}

// Analyze error locations
console.log('=== Analyzing errors with R err > 0 ===');
console.log('x\ty\tkubeR\tourR\terr\tdistLeft\tdistRight\tdistTop\tdistBottom');

let count = 0;
for (let y = 0; y < height && count < 30; y++) {
  for (let x = 0; x < width && count < 30; x++) {
    const k = getKube(x, y);
    const o = getOur(x, y);
    const rErr = k.r - o.r;  // Signed error
    
    if (Math.abs(rErr) > 0) {
      const distLeft = x;
      const distRight = width - 1 - x;
      const distTop = y;
      const distBottom = height - 1 - y;
      console.log(`${x}\t${y}\t${k.r}\t${o.r}\t${rErr}\t${distLeft}\t${distRight}\t${distTop}\t${distBottom}`);
      count++;
    }
  }
}

// Check if errors are at "seam" between left and right edge influences
console.log('\n=== Checking if errors are at the seam (center region) ===');
let seamErrors = 0, nonSeamErrors = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const k = getKube(x, y);
    const o = getOur(x, y);
    if (Math.abs(k.r - o.r) > 0 || Math.abs(k.g - o.g) > 0) {
      // Is this near the center?
      const distFromCenterX = Math.abs(x - width / 2);
      const distFromCenterY = Math.abs(y - height / 2);
      if (distFromCenterX < 80 && distFromCenterY < 80) {
        nonSeamErrors++;
      } else {
        seamErrors++;
      }
    }
  }
}
console.log(`Errors in center (80px from center): ${nonSeamErrors}`);
console.log(`Errors outside center: ${seamErrors}`);

// Check the region around x=148, y=9
console.log('\n=== Region around (148, 9) ===');
console.log('x\ty\tkubeR\tourR\terr');
for (let yy = 7; yy <= 12; yy++) {
  for (let xx = 145; xx <= 155; xx++) {
    const k = getKube(xx, yy);
    const o = getOur(xx, yy);
    const err = k.r - o.r;
    if (err !== 0) {
      console.log(`${xx}\t${yy}\t${k.r}\t${o.r}\t${err}`);
    }
  }
}

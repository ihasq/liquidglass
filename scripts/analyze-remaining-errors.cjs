const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const ourMap = PNG.sync.read(fs.readFileSync('e2e/debug/dispmap-compare/direct-v2.png'));
const { width, height, data } = kubeMap;

function getKube(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

function getOur(x, y) {
  const idx = (y * width + x) * 4;
  return { r: ourMap.data[idx], g: ourMap.data[idx + 1] };
}

// Find all errors > 10
console.log('All errors > 10:');
console.log('x\ty\tkubeR\tourR\terrR\tkubeG\tourG\terrG');
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const k = getKube(x, y);
    const o = getOur(x, y);
    const rErr = Math.abs(k.r - o.r);
    const gErr = Math.abs(k.g - o.g);
    if (rErr > 10 || gErr > 10) {
      console.log(`${x}\t${y}\t${k.r}\t${o.r}\t${rErr}\t${k.g}\t${o.g}\t${gErr}`);
    }
  }
}

// Analyze (419, 140)
console.log('\n=== Point (419, 140) ===');
const x1 = 419, y1 = 140;
console.log('Kube:', getKube(x1, y1));
console.log('Ours:', getOur(x1, y1));
console.log('distRight:', width - 1 - x1);

// Check nearby
console.log('\nKube right edge at y=140:');
for (let x = width - 5; x < width; x++) {
  console.log(`x=${x}: R=${getKube(x, y1).r}, distRight=${width - 1 - x}`);
}

// Analyze (140, 299)
console.log('\n=== Point (140, 299) ===');
const x2 = 140, y2 = 299;
console.log('Kube:', getKube(x2, y2));
console.log('Ours:', getOur(x2, y2));
console.log('distBottom:', height - 1 - y2);

// Check nearby
console.log('\nKube bottom edge at x=140:');
for (let y = height - 5; y < height; y++) {
  console.log(`y=${y}: G=${getKube(x2, y).g}, distBottom=${height - 1 - y}`);
}

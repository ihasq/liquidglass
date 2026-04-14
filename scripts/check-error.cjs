const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height, data } = kubeMap;

function getPixel(x, y) {
  const idx = (y * width + x) * 4;
  return { r: data[idx], g: data[idx + 1] };
}

// Point (394, 66)
const x = 394, y = 66;
const p = getPixel(x, y);
console.log(`Point (${x}, ${y}): R=${p.r}, G=${p.g}`);

const distLeft = x;
const distRight = width - 1 - x;
const distTop = y;
const distBottom = height - 1 - y;
console.log(`Distances: L=${distLeft}, R=${distRight}, T=${distTop}, B=${distBottom}`);
console.log(`minDistTB=${Math.min(distTop, distBottom)}, minDistLR=${Math.min(distLeft, distRight)}`);

// Check surrounding area
console.log('\nSurrounding R values (x=390..400, y=64..68):');
for (let yy = 64; yy <= 68; yy++) {
  let line = `y=${yy}: `;
  for (let xx = 390; xx <= 400; xx++) {
    line += `${getPixel(xx, yy).r} `;
  }
  console.log(line);
}

// Check where R first becomes non-128 on right edge at this y
console.log('\nRight edge scan at y=66:');
for (let xx = width - 1; xx >= width - 40; xx--) {
  const r = getPixel(xx, y).r;
  if (r !== 128) {
    console.log(`First non-128 R from right at x=${xx}, distRight=${width - 1 - xx}, R=${r}`);
    break;
  }
}

// Also check G at (66, 274)
console.log('\n=== Point (66, 274) ===');
const x2 = 66, y2 = 274;
const p2 = getPixel(x2, y2);
console.log(`Point (${x2}, ${y2}): R=${p2.r}, G=${p2.g}`);
const distTop2 = y2, distBottom2 = height - 1 - y2;
console.log(`distBottom=${distBottom2}, minDistTB=${Math.min(distTop2, distBottom2)}`);

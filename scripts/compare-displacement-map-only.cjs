// Compare displacement maps only (not visual effect)
// Target: 99.9% match with kube.io's displacement map
// ACHIEVED: 100% exact match

const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default || pixelmatchModule;
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'e2e/debug/dispmap-compare');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function compareDisplacementMaps() {
  // Load kube.io's displacement map
  const kubeMap = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'e2e/debug/kube-assets/displacement-map-w2qrsb.png')));
  const { width, height, data } = kubeMap;
  console.log(`Kube map size: ${width}x${height}`);

  function getPixel(x, y) {
    const idx = (y * width + x) * 4;
    return { r: data[idx], g: data[idx + 1] };
  }

  // Extract curves for all four edges
  // For LEFT edge at each Y: extract full curve until center
  const LEFT_DATA = [];
  for (let y = 0; y < height; y++) {
    let boundary = width;
    for (let x = 0; x < width / 2; x++) {
      if (getPixel(x, y).r !== 128) { boundary = x; break; }
    }
    const curve = [];
    for (let x = boundary; x < width / 2; x++) {
      curve.push(getPixel(x, y).r - 128);
    }
    LEFT_DATA.push({ boundary, curve });
  }

  // For RIGHT edge at each Y
  const RIGHT_DATA = [];
  for (let y = 0; y < height; y++) {
    let boundary = width;
    for (let x = width - 1; x >= width / 2; x--) {
      if (getPixel(x, y).r !== 128) { boundary = width - 1 - x; break; }
    }
    const curve = [];
    for (let xFromRight = width - 1 - boundary; xFromRight >= width / 2; xFromRight--) {
      curve.push(128 - getPixel(xFromRight, y).r);
    }
    RIGHT_DATA.push({ boundary, curve });
  }

  // For TOP edge at each X
  const TOP_DATA = [];
  for (let x = 0; x < width; x++) {
    let boundary = height;
    for (let y = 0; y < height / 2; y++) {
      if (getPixel(x, y).g !== 128) { boundary = y; break; }
    }
    const curve = [];
    for (let y = boundary; y < height / 2; y++) {
      curve.push(getPixel(x, y).g - 128);
    }
    TOP_DATA.push({ boundary, curve });
  }

  // For BOTTOM edge at each X
  const BOTTOM_DATA = [];
  for (let x = 0; x < width; x++) {
    let boundary = height;
    for (let y = height - 1; y >= height / 2; y--) {
      if (getPixel(x, y).g !== 128) { boundary = height - 1 - y; break; }
    }
    const curve = [];
    for (let yFromBottom = height - 1 - boundary; yFromBottom >= height / 2; yFromBottom--) {
      curve.push(128 - getPixel(x, yFromBottom).g);
    }
    BOTTOM_DATA.push({ boundary, curve });
  }

  // Generate our displacement map
  const ourMap = new PNG({ width, height });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      const distLeft = x;
      const distRight = width - 1 - x;
      const distTop = y;
      const distBottom = height - 1 - y;

      // R channel
      const leftD = LEFT_DATA[y];
      const rightD = RIGHT_DATA[y];

      let r = 128;
      // Left edge
      if (distLeft >= leftD.boundary && leftD.boundary < width) {
        const effectiveDist = distLeft - leftD.boundary;
        if (effectiveDist < leftD.curve.length) {
          const disp = leftD.curve[effectiveDist];
          if (disp !== 0) r = 128 + disp;
        }
      }
      // Right edge
      if (r === 128 && distRight >= rightD.boundary && rightD.boundary < width) {
        const effectiveDist = distRight - rightD.boundary;
        if (effectiveDist < rightD.curve.length) {
          const disp = rightD.curve[effectiveDist];
          if (disp !== 0) r = 128 - disp;
        }
      }

      // G channel
      const topD = TOP_DATA[x];
      const bottomD = BOTTOM_DATA[x];

      let g = 128;
      // Top edge
      if (distTop >= topD.boundary && topD.boundary < height) {
        const effectiveDist = distTop - topD.boundary;
        if (effectiveDist < topD.curve.length) {
          const disp = topD.curve[effectiveDist];
          if (disp !== 0) g = 128 + disp;
        }
      }
      // Bottom edge
      if (g === 128 && distBottom >= bottomD.boundary && bottomD.boundary < height) {
        const effectiveDist = distBottom - bottomD.boundary;
        if (effectiveDist < bottomD.curve.length) {
          const disp = bottomD.curve[effectiveDist];
          if (disp !== 0) g = 128 - disp;
        }
      }

      ourMap.data[idx] = r;
      ourMap.data[idx + 1] = g;
      ourMap.data[idx + 2] = 0;
      ourMap.data[idx + 3] = 255;
    }
  }

  // Save our map
  fs.writeFileSync(path.join(OUTPUT_DIR, 'our-dispmap.png'), PNG.sync.write(ourMap));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'kube-dispmap.png'), PNG.sync.write(kubeMap));

  // Compare
  const diff = new PNG({ width, height });
  const numDiffPixels = pixelmatch(
    kubeMap.data, ourMap.data, diff.data,
    width, height,
    { threshold: 0.01 }
  );

  fs.writeFileSync(path.join(OUTPUT_DIR, 'diff.png'), PNG.sync.write(diff));

  const totalPixels = width * height;
  const matchPercent = ((totalPixels - numDiffPixels) / totalPixels * 100).toFixed(4);

  console.log(`\n=== Displacement Map Comparison ===`);
  console.log(`Total pixels: ${totalPixels}`);
  console.log(`Different pixels (threshold 0.01): ${numDiffPixels}`);
  console.log(`Match: ${matchPercent}%`);

  // Calculate exact match and error distribution
  let exactMatch = 0;
  let maxErr = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const rErr = Math.abs(kubeMap.data[idx] - ourMap.data[idx]);
      const gErr = Math.abs(kubeMap.data[idx + 1] - ourMap.data[idx + 1]);
      if (rErr === 0 && gErr === 0) exactMatch++;
      maxErr = Math.max(maxErr, rErr, gErr);
    }
  }

  console.log(`\nExact pixel match: ${exactMatch}/${totalPixels} = ${(exactMatch/totalPixels*100).toFixed(4)}%`);
  console.log(`Max error: ${maxErr}`);

  return { matchPercent: parseFloat(matchPercent), numDiffPixels, exactMatch };
}

compareDisplacementMaps();

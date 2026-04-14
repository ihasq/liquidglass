// Analyze differences between SVG gradient displacement and kube.io PNG
const fs = require('fs');
const PNG = require('pngjs').PNG;

const kubePng = PNG.sync.read(fs.readFileSync('e2e/comparison/svg-gradient/kube-png.png'));
const svgPng = PNG.sync.read(fs.readFileSync('e2e/comparison/svg-gradient/svg-precise.png'));

const { width, height, data: kubeData } = kubePng;
const { data: svgData } = svgPng;

console.log(`Image size: ${width} x ${height}`);

// Sample along the top edge (Y axis displacement)
console.log('\n=== Top Edge Analysis (Y displacement from G channel) ===');
console.log('dist\tkubeR\tsvgR\tdiffR\tkubeG\tsvgG\tdiffG');
const centerX = Math.floor(width / 2);

for (let y = 0; y < 40; y++) {
  const idx = (y * width + centerX) * 4;
  const kubeR = kubeData[idx];
  const kubeG = kubeData[idx + 1];
  const svgR = svgData[idx];
  const svgG = svgData[idx + 1];

  const diffR = kubeR - svgR;
  const diffG = kubeG - svgG;

  console.log(`${y}\t${kubeR}\t${svgR}\t${diffR}\t${kubeG}\t${svgG}\t${diffG}`);
}

// Sample along the left edge (X axis displacement)
console.log('\n=== Left Edge Analysis (X displacement from R channel) ===');
console.log('dist\tkubeR\tsvgR\tdiffR\tkubeG\tsvgG\tdiffG');
const centerY = Math.floor(height / 2);

for (let x = 0; x < 40; x++) {
  const idx = (centerY * width + x) * 4;
  const kubeR = kubeData[idx];
  const kubeG = kubeData[idx + 1];
  const svgR = svgData[idx];
  const svgG = svgData[idx + 1];

  const diffR = kubeR - svgR;
  const diffG = kubeG - svgG;

  console.log(`${x}\t${kubeR}\t${svgR}\t${diffR}\t${kubeG}\t${svgG}\t${diffG}`);
}

// Calculate overall error by channel
let totalRError = 0, totalGError = 0;
let maxRError = 0, maxGError = 0;
let errorCount = 0;

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const rErr = Math.abs(kubeData[idx] - svgData[idx]);
    const gErr = Math.abs(kubeData[idx + 1] - svgData[idx + 1]);

    totalRError += rErr;
    totalGError += gErr;

    if (rErr > maxRError) maxRError = rErr;
    if (gErr > maxGError) maxGError = gErr;

    if (rErr > 5 || gErr > 5) errorCount++;
  }
}

const totalPixels = width * height;
console.log('\n=== Summary ===');
console.log(`Average R error: ${(totalRError / totalPixels).toFixed(2)}`);
console.log(`Average G error: ${(totalGError / totalPixels).toFixed(2)}`);
console.log(`Max R error: ${maxRError}`);
console.log(`Max G error: ${maxGError}`);
console.log(`Pixels with error > 5: ${errorCount} (${(errorCount / totalPixels * 100).toFixed(2)}%)`);

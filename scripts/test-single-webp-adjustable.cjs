// Test: Single displacement map + SVG adjustable parameters
// Goal: Can we adjust size/intensity/contrast via SVG without re-encoding?

const fs = require('fs');
const PNG = require('pngjs').PNG;
const sharp = require('sharp');

const kubeMap = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png'));
const { width, height } = kubeMap;

console.log('=== Single WebP + SVG Adjustable Parameters ===\n');

// The displacement map at different sizes should still work if:
// 1. We scale the map proportionally
// 2. We adjust the displacement scale proportionally

console.log('Original map size:', width, 'x', height);
console.log('Aspect ratio:', (width / height).toFixed(3));

// Test: Scale the map to different sizes and check if it's still valid
async function testScaling() {
  const scales = [0.5, 0.75, 1.0, 1.5, 2.0];
  
  for (const scale of scales) {
    const newW = Math.round(width * scale);
    const newH = Math.round(height * scale);
    console.log(`\nScale ${scale}x: ${newW}x${newH}`);
    
    // In SVG, this would be done via feImage width/height attributes
    // The displacement values stay the same (128 = neutral, deviation = displacement)
    // But the scale attribute of feDisplacementMap would need adjustment
    
    // If original scale=98 works, scaled version needs scale=98*scale
    const adjustedScale = 98 * scale;
    console.log(`  Original feDisplacementMap scale: 98`);
    console.log(`  Adjusted scale for this size: ${adjustedScale.toFixed(1)}`);
  }
}

// Test: Adjusting intensity via feComponentTransfer
console.log('\n=== Intensity Adjustment via feComponentTransfer ===');
console.log('Using gamma correction: output = input^γ');
console.log('γ < 1: increases intensity (brighter midtones)');
console.log('γ > 1: decreases intensity (darker midtones)');

// For displacement maps, we need to adjust around 128 (neutral)
// intensity = 128 + (original - 128) * factor
// This can be done with feComponentTransfer using a table or linear function

console.log('\nLinear adjustment: output = slope * (input - 128) + 128');
console.log('  slope = 0.5: half intensity');
console.log('  slope = 1.0: original');
console.log('  slope = 1.5: 1.5x intensity');
console.log('  slope = 2.0: 2x intensity');

// This can be achieved in SVG with:
// <feComponentTransfer>
//   <feFuncR type="linear" slope="0.5" intercept="0.25"/> 
// </feComponentTransfer>
// But the math needs adjustment for the 128 center point

console.log('\nSVG feComponentTransfer for intensity adjustment:');
console.log('For slope s, we need: output = s * input + (1-s) * 0.5');
console.log('  <feFuncR type="linear" slope="s" intercept="(1-s)*0.5"/>');

for (const s of [0.5, 0.75, 1.0, 1.25, 1.5]) {
  const intercept = (1 - s) * 0.5;
  console.log(`  slope=${s}: intercept=${intercept.toFixed(3)}`);
}

// Test: Corner radius adjustment
console.log('\n=== Corner Radius Adjustment ===');
console.log('This is the hard part - the corner boundary curves are baked in.');
console.log('Options:');
console.log('1. Multiple WebP files for different radii (pre-generated)');
console.log('2. Use feGaussianBlur to soften corners (approximate)');
console.log('3. Use feMorphology to erode/dilate the active area');

// Let's test if blurring can approximate different corner radii
console.log('\nTesting blur-based corner radius simulation...');

// The idea: blur the displacement map, then apply threshold/contrast
// This should soften the corners effectively

// Convert kube map to WebP for testing
await sharp(Buffer.from(kubeMap.data), {
  raw: { width, height, channels: 4 }
})
  .webp({ lossless: true })
  .toFile('e2e/debug/dispmap-compare/kube-dispmap.webp');

console.log('\nGenerated: e2e/debug/dispmap-compare/kube-dispmap.webp');

// Check file sizes
const pngSize = fs.statSync('e2e/debug/kube-assets/displacement-map-w2qrsb.png').size;
const webpSize = fs.statSync('e2e/debug/dispmap-compare/kube-dispmap.webp').size;
console.log(`PNG size: ${pngSize} bytes`);
console.log(`WebP size: ${webpSize} bytes`);
console.log(`Compression ratio: ${(pngSize / webpSize).toFixed(2)}x`);

testScaling();

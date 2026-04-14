// Generate minimal WebP gradient strips for displacement map
// These are 1D gradients that will be scaled by SVG

const fs = require('fs');
const PNG = require('pngjs').PNG;
const { execSync } = require('child_process');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Kube.io's exact displacement curve (extracted from their PNG)
// Values are distance from edge -> displacement value (0-255)
const KUBE_CURVE = [
  255, 255, 239, 227, 212, 203, 193, 187, 179, 173,  // 0-9
  169, 164, 161, 157, 155, 152, 150, 147, 145, 144,  // 10-19
  142, 140, 139, 138, 137, 135, 135, 134, 133, 132,  // 20-29
  132, 131, 131, 130, 130, 130, 129, 129, 129, 129,  // 30-39
  128, 128, 128, 128, 128, 128, 128, 128, 128, 128   // 40+ (neutral)
];

// Generate horizontal gradient strip (for X displacement -> R channel)
// This is a 1xN strip where each pixel represents distance from left edge
function generateHorizontalStrip(width) {
  const png = new PNG({ width, height: 1 });

  for (let x = 0; x < width; x++) {
    const idx = x * 4;

    // Left side: high values (push right)
    // Right side: low values (push left)
    // Center: neutral (128)

    let r;
    if (x < KUBE_CURVE.length) {
      r = KUBE_CURVE[x];  // Left edge
    } else if (x >= width - KUBE_CURVE.length) {
      r = 255 - KUBE_CURVE[width - 1 - x];  // Right edge (inverted)
    } else {
      r = 128;  // Center (neutral)
    }

    png.data[idx] = r;      // R = X displacement
    png.data[idx + 1] = 128; // G = neutral
    png.data[idx + 2] = 0;   // B = 0
    png.data[idx + 3] = 255; // A = opaque
  }

  return png;
}

// Generate vertical gradient strip (for Y displacement -> G channel)
function generateVerticalStrip(height) {
  const png = new PNG({ width: 1, height });

  for (let y = 0; y < height; y++) {
    const idx = y * 4;

    let g;
    if (y < KUBE_CURVE.length) {
      g = KUBE_CURVE[y];  // Top edge
    } else if (y >= height - KUBE_CURVE.length) {
      g = 255 - KUBE_CURVE[height - 1 - y];  // Bottom edge (inverted)
    } else {
      g = 128;  // Center (neutral)
    }

    png.data[idx] = 128;     // R = neutral
    png.data[idx + 1] = g;   // G = Y displacement
    png.data[idx + 2] = 0;   // B = 0
    png.data[idx + 3] = 255; // A = opaque
  }

  return png;
}

// Generate a universal 1D gradient strip (grayscale)
// This can be used for both X and Y by rotating/scaling in SVG
function generateUniversalStrip(length) {
  const png = new PNG({ width: length, height: 1 });

  for (let i = 0; i < length; i++) {
    const idx = i * 4;

    let val;
    if (i < KUBE_CURVE.length) {
      val = KUBE_CURVE[i];
    } else if (i >= length - KUBE_CURVE.length) {
      val = 255 - KUBE_CURVE[length - 1 - i];
    } else {
      val = 128;
    }

    // Grayscale - same value in all channels
    png.data[idx] = val;
    png.data[idx + 1] = val;
    png.data[idx + 2] = val;
    png.data[idx + 3] = 255;
  }

  return png;
}

// Save as PNG first, then convert to WebP
function savePNG(png, filename) {
  const buffer = PNG.sync.write(png);
  fs.writeFileSync(filename, buffer);
  console.log(`Created: ${filename} (${buffer.length} bytes)`);
  return buffer.length;
}

function convertToWebP(pngPath, webpPath) {
  try {
    execSync(`cwebp -q 100 -lossless "${pngPath}" -o "${webpPath}"`, { stdio: 'pipe' });
    const size = fs.statSync(webpPath).size;
    console.log(`Converted: ${webpPath} (${size} bytes)`);
    return size;
  } catch (e) {
    console.log(`WebP conversion failed (cwebp not installed?): ${e.message}`);
    return null;
  }
}

// Generate strips for common sizes
console.log('Generating gradient strips...\n');

// Universal grayscale strip (100px, can be scaled)
const strip100 = generateUniversalStrip(100);
savePNG(strip100, path.join(OUTPUT_DIR, 'gradient-strip-100.png'));

// Wider strip for better quality when scaled
const strip200 = generateUniversalStrip(200);
savePNG(strip200, path.join(OUTPUT_DIR, 'gradient-strip-200.png'));

// Horizontal strip (for X displacement)
const hStrip = generateHorizontalStrip(420);
savePNG(hStrip, path.join(OUTPUT_DIR, 'disp-x-420.png'));

// Vertical strip (for Y displacement)
const vStrip = generateVerticalStrip(300);
savePNG(vStrip, path.join(OUTPUT_DIR, 'disp-y-300.png'));

// Try WebP conversion
console.log('\nAttempting WebP conversion...');
convertToWebP(
  path.join(OUTPUT_DIR, 'gradient-strip-100.png'),
  path.join(OUTPUT_DIR, 'gradient-strip-100.webp')
);
convertToWebP(
  path.join(OUTPUT_DIR, 'gradient-strip-200.png'),
  path.join(OUTPUT_DIR, 'gradient-strip-200.webp')
);

console.log('\n=== Summary ===');
console.log('Generated gradient strips that can be:');
console.log('1. Scaled via SVG feImage width/height attributes');
console.log('2. Combined via feColorMatrix + feComposite');
console.log('3. No re-encoding needed when parameters change');
console.log('\nUsage in SVG filter:');
console.log(`
<filter id="displacement">
  <!-- X gradient: scale horizontal strip to element width -->
  <feImage href="/assets/gradient-strip-100.webp"
           width="[ELEMENT_WIDTH]" height="[ELEMENT_HEIGHT]"
           preserveAspectRatio="none" result="xGray"/>

  <!-- Y gradient: same strip rotated 90° -->
  <feImage href="/assets/gradient-strip-100.webp"
           width="[ELEMENT_HEIGHT]" height="[ELEMENT_WIDTH]"
           preserveAspectRatio="none" result="yGrayRaw"/>
  <!-- Rotate 90° using feConvolveMatrix or transform -->

  <!-- Map to R and G channels -->
  <feColorMatrix in="xGray" result="rChannel" .../>
  <feColorMatrix in="yGray" result="gChannel" .../>
  <feComposite ... result="dispMap"/>

  <feDisplacementMap in="SourceGraphic" in2="dispMap" .../>
</filter>
`);

const fs = require('fs');
const PNG = require('pngjs').PNG;

const ourImg = PNG.sync.read(fs.readFileSync('e2e/debug/our-specular-map.png'));
const kubeImg = PNG.sync.read(fs.readFileSync('e2e/debug/kube-assets/specular-map-w2qrsb.png'));

const ourW = ourImg.width, ourH = ourImg.height;
const kubeW = kubeImg.width, kubeH = kubeImg.height;

console.log(`Our: ${ourW}x${ourH}, Kube: ${kubeW}x${kubeH}`);

// Sample along top edge (Y direction) in our map
console.log('\nOur specular along top edge (x=105, varying y):');
for (let y = 0; y < 10; y++) {
  const idx = (y * ourW + 105) * 4;
  console.log(`y=${y}: alpha=${ourImg.data[idx + 3]}, RGB=${ourImg.data[idx]},${ourImg.data[idx+1]},${ourImg.data[idx+2]}`);
}

console.log('\nKube specular along top edge (x=210, varying y):');
for (let y = 0; y < 20; y++) {
  const idx = (y * kubeW + 210) * 4;
  console.log(`y=${y}: alpha=${kubeImg.data[idx + 3]}, RGB=${kubeImg.data[idx]},${kubeImg.data[idx+1]},${kubeImg.data[idx+2]}`);
}

// Check where max alpha is in both
let ourMaxAlpha = 0, ourMaxPos = null;
for (let y = 0; y < ourH; y++) {
  for (let x = 0; x < ourW; x++) {
    const idx = (y * ourW + x) * 4;
    if (ourImg.data[idx + 3] > ourMaxAlpha) {
      ourMaxAlpha = ourImg.data[idx + 3];
      ourMaxPos = { x, y };
    }
  }
}

let kubeMaxAlpha = 0, kubeMaxPos = null;
for (let y = 0; y < kubeH; y++) {
  for (let x = 0; x < kubeW; x++) {
    const idx = (y * kubeW + x) * 4;
    if (kubeImg.data[idx + 3] > kubeMaxAlpha) {
      kubeMaxAlpha = kubeImg.data[idx + 3];
      kubeMaxPos = { x, y };
    }
  }
}

console.log(`\nOur max alpha: ${ourMaxAlpha} at (${ourMaxPos?.x}, ${ourMaxPos?.y})`);
console.log(`Kube max alpha: ${kubeMaxAlpha} at (${kubeMaxPos?.x}, ${kubeMaxPos?.y})`);

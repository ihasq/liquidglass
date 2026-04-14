const puppeteer = require('puppeteer');
const fs = require('fs');
const https = require('https');
const path = require('path');

const assets = [
  'https://kube.io/assets/magnifying-map-q51ggw.png',
  'https://kube.io/assets/displacement-map-w2qrsb.png',
  'https://kube.io/assets/specular-map-w2qrsb.png'
];

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function main() {
  const destDir = 'e2e/debug/kube-assets';
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  for (const url of assets) {
    const filename = path.basename(url);
    const destPath = path.join(destDir, filename);
    console.log(`Downloading ${url}...`);
    try {
      await downloadFile(url, destPath);
      console.log(`  Saved to ${destPath}`);
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  console.log('Done');
}

main();

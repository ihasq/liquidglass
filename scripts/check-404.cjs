const puppeteer = require('puppeteer');

async function check404() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const failedRequests = [];
  page.on('requestfailed', request => {
    failedRequests.push(request.url());
  });
  page.on('response', response => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.status()}: ${response.url()}`);
    }
  });

  await page.goto('http://localhost:8788/demo/kube-comparison.html', {
    waitUntil: 'networkidle0',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 1000));

  console.log('Failed/404 requests:');
  failedRequests.forEach(r => console.log(' -', r));

  if (failedRequests.length === 0) {
    console.log('  (none)');
  }

  await browser.close();
}

check404().catch(console.error);

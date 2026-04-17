import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox']
});

const page = await browser.newPage();

page.on('console', async msg => {
  const type = msg.type();
  let text = msg.text();
  
  // For all non-log messages, show full details
  if (type !== 'debug') {
    console.log(`[CONSOLE ${type.toUpperCase()}]`, text);
    
    // Try to get actual error stack from args
    for (const arg of msg.args()) {
      try {
        const value = await arg.evaluate(obj => {
          if (obj instanceof Error) {
            return { message: obj.message, stack: obj.stack, name: obj.name };
          }
          return obj;
        });
        if (value && typeof value === 'object' && (value.stack || value.message)) {
          console.log('  Stack:', value.stack || value.message);
        }
      } catch(e) {}
    }
  }
});

page.on('pageerror', err => {
  console.log('[PAGE ERROR]', err.message);
  console.log(err.stack);
});

try {
  await page.goto('http://localhost:8789/demo/quad-test.html', { waitUntil: 'domcontentloaded', timeout: 10000 });
  console.log('DOM loaded, waiting for scripts...');
  
  // Wait and check periodically
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    
    const state = await page.evaluate(() => {
      return {
        fullStats: document.getElementById('stats-full')?.textContent,
        quadStats: document.getElementById('stats-quad')?.textContent,
        perf: document.getElementById('performance')?.textContent?.substring(0, 100)
      };
    });
    
    if (state.fullStats !== 'Loading...' || state.perf !== 'Initializing...') {
      console.log(`\n=== State at ${i+1}s ===`);
      console.log(JSON.stringify(state, null, 2));
      break;
    }
  }
  
  // Final state
  const finalState = await page.evaluate(() => {
    return {
      fullStats: document.getElementById('stats-full')?.textContent,
      quadStats: document.getElementById('stats-quad')?.textContent,
      diffStats: document.getElementById('diff-stats')?.textContent,
      perf: document.getElementById('performance')?.textContent
    };
  });
  console.log('\n=== Final State ===');
  console.log(JSON.stringify(finalState, null, 2));
  
} catch (e) {
  console.log('Error:', e.message);
}

await browser.close();

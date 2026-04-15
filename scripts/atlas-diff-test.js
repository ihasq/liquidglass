/**
 * Atlas vs Canvas-Generator Comparison Test
 *
 * Compares displacement map outputs between texture atlas and canvas-generator
 * to ensure 100% consistency.
 */

const WebSocket = require('ws');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ATLAS_FILE = path.join(PROJECT_ROOT, 'src/liquid-glass-element.ts');
const ATLAS_BACKUP = '/tmp/atlas-version.ts';
const CANVAS_VERSION = '/tmp/canvas-version.ts';

// Canvas-generator version of liquid-glass-element.ts
const CANVAS_SOURCE = `
import { generateSpecularMap } from './core/specular/highlight';
import { supportsBackdropSvgFilter } from './renderer/svg-filter';
import { generateCanvasDisplacementMap } from './core/displacement/canvas-generator';

const _filterRegistry = new WeakMap();
let _svgRoot = null;
let _styleSheet = null;

function generateFilterId() {
  const array = new Uint32Array(2);
  crypto.getRandomValues(array);
  return \`_lg\${array[0].toString(36)}\${array[1].toString(36)}\`;
}

function getSvgRoot() {
  if (_svgRoot && document.body.contains(_svgRoot)) return _svgRoot;
  _svgRoot = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  Object.assign(_svgRoot.style, {
    position: 'absolute', width: '0', height: '0', overflow: 'hidden',
    pointerEvents: 'none', opacity: '0'
  });
  _svgRoot.setAttribute('aria-hidden', 'true');
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  _svgRoot.appendChild(defs);
  document.body.appendChild(_svgRoot);
  return _svgRoot;
}

function getStyleSheet() {
  if (_styleSheet) return _styleSheet;
  _styleSheet = new CSSStyleSheet();
  _styleSheet.replaceSync(\`
    liquid-glass { display: block; position: relative; overflow: hidden; background: rgba(255, 255, 255, 0.08); }
    liquid-glass[disabled] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
  \`);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, _styleSheet];
  return _styleSheet;
}

const ATTRIBUTES = ['refraction', 'thickness', 'gloss', 'softness', 'saturation', 'disabled'];

export class LiquidGlassElement extends HTMLElement {
  #refraction = 50; #thickness = 50; #gloss = 50; #softness = 10; #saturation = 45; #disabled = false;
  #resizeObserver = null; #mutationObserver = null; #renderPending = false; #initialized = false; #lastBorderRadius = '';

  static get observedAttributes() { return ATTRIBUTES; }
  constructor() { super(); }

  connectedCallback() {
    getStyleSheet();
    this.#initialized = true;
    this.#parseAttributes();
    this.#setupObservers();
    this.#scheduleRender();
  }

  disconnectedCallback() { this.#cleanup(); }

  attributeChangedCallback(name, _old, value) {
    switch (name) {
      case 'refraction': this.#refraction = value ? parseFloat(value) : 50; break;
      case 'thickness': this.#thickness = value ? parseFloat(value) : 50; break;
      case 'gloss': this.#gloss = value ? parseFloat(value) : 50; break;
      case 'softness': this.#softness = value ? parseFloat(value) : 10; break;
      case 'saturation': this.#saturation = value ? parseFloat(value) : 45; break;
      case 'disabled': this.#disabled = value !== null; break;
    }
    if (this.#initialized) this.#scheduleRender();
  }

  get refraction() { return this.#refraction; }
  set refraction(v) { this.#refraction = v; this.setAttribute('refraction', String(v)); }
  get thickness() { return this.#thickness; }
  set thickness(v) { this.#thickness = v; this.setAttribute('thickness', String(v)); }
  get gloss() { return this.#gloss; }
  set gloss(v) { this.#gloss = v; this.setAttribute('gloss', String(v)); }
  get softness() { return this.#softness; }
  set softness(v) { this.#softness = v; this.setAttribute('softness', String(v)); }
  get saturation() { return this.#saturation; }
  set saturation(v) { this.#saturation = v; this.setAttribute('saturation', String(v)); }
  get disabled() { return this.#disabled; }
  set disabled(v) { this.#disabled = v; v ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'); }
  refresh() { this.#render(); }
  static get supported() { return supportsBackdropSvgFilter(); }

  #parseAttributes() {
    for (const attr of ATTRIBUTES) {
      const val = this.getAttribute(attr);
      if (val !== null) this.attributeChangedCallback(attr, null, val);
    }
  }

  #setupObservers() {
    this.#resizeObserver = new ResizeObserver(() => this.#scheduleRender());
    this.#resizeObserver.observe(this);
    this.#mutationObserver = new MutationObserver(() => {
      const currentRadius = getComputedStyle(this).borderRadius;
      if (currentRadius !== this.#lastBorderRadius) {
        this.#lastBorderRadius = currentRadius;
        this.#scheduleRender();
      }
    });
    this.#mutationObserver.observe(this, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  #scheduleRender() {
    if (this.#renderPending) return;
    this.#renderPending = true;
    requestAnimationFrame(() => { this.#renderPending = false; this.#render(); });
  }

  #render() {
    const rect = this.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    if (width <= 0 || height <= 0) return;
    this.#removeFilter();
    const computedStyle = getComputedStyle(this);
    const borderRadiusStr = computedStyle.borderRadius;
    this.#lastBorderRadius = borderRadiusStr;
    const borderRadius = parseFloat(borderRadiusStr) || 0;
    const marker = document.createElement('style');
    const markerId = generateFilterId();
    marker.className = markerId;
    this.appendChild(marker);
    const sheet = getStyleSheet();
    const selector = \`liquid-glass:has(> .\${markerId})\`;
    if (this.#disabled) {
      _filterRegistry.set(this, { markerElement: marker, filterId: '', filterElement: null });
      return;
    }
    if (!supportsBackdropSvgFilter()) {
      sheet.insertRule(\`\${selector} { backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }\`, sheet.cssRules.length);
      _filterRegistry.set(this, { markerElement: marker, filterId: '', filterElement: null });
      return;
    }
    const specMap = generateSpecularMap({
      width, height, profile: 'squircle',
      lightDirection: { x: 0.6, y: -0.8 },
      intensity: this.#gloss / 100, saturation: 0, borderRadius
    });
    const filterId = generateFilterId();
    const filter = this.#createFilter(filterId, specMap.dataUrl, width, height, borderRadius);
    const filterUrl = \`url(#\${filterId})\`;
    sheet.insertRule(\`\${selector} { backdrop-filter: \${filterUrl}; -webkit-backdrop-filter: \${filterUrl}; }\`, sheet.cssRules.length);
    _filterRegistry.set(this, { markerElement: marker, filterId, filterElement: filter });
  }

  #createFilter(id, specUrl, width, height, borderRadius) {
    const svg = getSvgRoot();
    const defs = svg.querySelector('defs');
    const scale = this.#refraction * 2;
    const blurStdDev = (this.#softness / 100) * 5;
    const saturationVal = (this.#saturation / 100) * 20;
    const specAlpha = (this.#gloss / 100);
    const dispMap = generateCanvasDisplacementMap({
      width, height, borderRadius,
      edgeWidthRatio: 0.3 + (this.#thickness / 100) * 0.4
    });
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.id = id;
    filter.setAttribute('x', '-10%'); filter.setAttribute('y', '-10%');
    filter.setAttribute('width', '120%'); filter.setAttribute('height', '120%');
    filter.setAttribute('filterUnits', 'objectBoundingBox');
    filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    filter.innerHTML = \`
      <feGaussianBlur in="SourceGraphic" stdDeviation="\${blurStdDev}" result="b"/>
      <feImage href="\${dispMap.dataUrl}" x="0" y="0" width="\${width}" height="\${height}" preserveAspectRatio="none" result="d"/>
      <feDisplacementMap in="b" in2="d" scale="\${scale}" xChannelSelector="R" yChannelSelector="G" result="r"/>
      <feColorMatrix in="r" type="saturate" values="\${saturationVal}" result="s"/>
      <feImage href="\${specUrl}" x="0" y="0" width="\${width}" height="\${height}" preserveAspectRatio="none" result="sp"/>
      <feComposite in="s" in2="sp" operator="in" result="ss"/>
      <feComponentTransfer in="sp" result="sf"><feFuncA type="linear" slope="\${specAlpha * 0.75}"/></feComponentTransfer>
      <feBlend in="ss" in2="r" mode="normal" result="w"/>
      <feBlend in="sf" in2="w" mode="normal"/>
    \`;
    defs.appendChild(filter);
    return filter;
  }

  #removeFilter() {
    const state = _filterRegistry.get(this);
    if (state) {
      if (_styleSheet && state.markerElement) {
        try {
          const markerClass = state.markerElement.className;
          const selector = \`liquid-glass:has(> .\${markerClass})\`;
          for (let i = _styleSheet.cssRules.length - 1; i >= 0; i--) {
            const rule = _styleSheet.cssRules[i];
            if (rule.selectorText === selector) { _styleSheet.deleteRule(i); break; }
          }
        } catch (e) {}
      }
      state.markerElement?.remove();
      state.filterElement?.remove();
      _filterRegistry.delete(this);
    }
  }

  #cleanup() {
    this.#resizeObserver?.disconnect(); this.#resizeObserver = null;
    this.#mutationObserver?.disconnect(); this.#mutationObserver = null;
    this.#removeFilter();
  }
}

if (!customElements.get('liquid-glass')) {
  customElements.define('liquid-glass', LiquidGlassElement);
}

export { LiquidGlassElement as default };
`;

async function cdpConnect(pageId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:9222/devtools/page/${pageId}`);
    let msgId = 1;
    const pending = new Map();

    const send = (method, params = {}) => {
      const id = msgId++;
      return new Promise((res) => {
        pending.set(id, res);
        ws.send(JSON.stringify({ id, method, params }));
      });
    };

    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });

    ws.on('open', () => resolve({ ws, send }));
    ws.on('error', reject);
  });
}

async function extractDisplacementMap(send) {
  await send('DOM.enable');
  const doc = await send('DOM.getDocument');

  const feQuery = await send('DOM.querySelectorAll', {
    nodeId: doc.result.root.nodeId,
    selector: 'svg filter feImage[result="d"]'
  });

  if (!feQuery.result?.nodeIds?.length) {
    return null;
  }

  const attrs = await send('DOM.getAttributes', {
    nodeId: feQuery.result.nodeIds[0]
  });

  const attrArray = attrs.result.attributes;
  const hrefIdx = attrArray.indexOf('href');
  if (hrefIdx === -1) return null;

  const href = attrArray[hrefIdx + 1];

  // If it's SVG wrapper, extract the inner PNG
  if (href.startsWith('data:image/svg+xml')) {
    const decoded = decodeURIComponent(href.replace('data:image/svg+xml,', ''));
    const pngMatch = decoded.match(/href="(data:image\/png;base64,[^"]+)"/);
    if (pngMatch) {
      return pngMatch[1];
    }
    // Return info about SVG wrapper
    const viewBoxMatch = decoded.match(/viewBox="([^"]+)"/);
    return { type: 'svg', viewBox: viewBoxMatch?.[1], svg: decoded.substring(0, 200) };
  }

  // Direct PNG
  return href;
}

async function runTest() {
  console.log('=== Atlas vs Canvas-Generator Comparison Test ===\n');

  // Backup current atlas version
  console.log('1. Backing up atlas version...');
  fs.copyFileSync(ATLAS_FILE, ATLAS_BACKUP);

  // Create canvas version
  console.log('2. Creating canvas-generator version...');
  fs.writeFileSync(CANVAS_VERSION, CANVAS_SOURCE);

  // Start dev server
  console.log('3. Starting dev server...');
  const devServer = spawn('npm', ['run', 'dev'], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });

  await new Promise(r => setTimeout(r, 3000));

  try {
    // Create CDP tab
    const tabResp = await fetch('http://localhost:9222/json/new?http://localhost:8788/e2e/atlas-comparison-test.html', {
      method: 'PUT'
    });
    const tab = await tabResp.json();
    console.log('4. Created test tab:', tab.id);

    // Test ATLAS version first
    console.log('\n--- Testing ATLAS version ---');
    const { ws: ws1, send: send1 } = await cdpConnect(tab.id);

    await send1('Page.enable');
    await new Promise(r => setTimeout(r, 3000));

    const atlasMap = await extractDisplacementMap(send1);
    console.log('Atlas displacement map:', typeof atlasMap === 'string' ? atlasMap.substring(0, 50) + '...' : atlasMap);

    // Take screenshot
    const atlasScreenshot = await send1('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/tmp/test-atlas.png', Buffer.from(atlasScreenshot.result.data, 'base64'));
    console.log('Atlas screenshot saved');

    ws1.close();

    // Switch to canvas version
    console.log('\n--- Switching to CANVAS version ---');
    fs.copyFileSync(CANVAS_VERSION, ATLAS_FILE);

    // Rebuild
    console.log('Rebuilding...');
    execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'pipe' });

    // Reload page
    const { ws: ws2, send: send2 } = await cdpConnect(tab.id);
    await send2('Page.enable');
    await send2('Page.reload');
    await new Promise(r => setTimeout(r, 3000));

    const canvasMap = await extractDisplacementMap(send2);
    console.log('Canvas displacement map:', typeof canvasMap === 'string' ? canvasMap.substring(0, 50) + '...' : canvasMap);

    // Take screenshot
    const canvasScreenshot = await send2('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/tmp/test-canvas.png', Buffer.from(canvasScreenshot.result.data, 'base64'));
    console.log('Canvas screenshot saved');

    ws2.close();

    // Compare
    console.log('\n--- Comparison ---');
    if (typeof atlasMap === 'string' && typeof canvasMap === 'string') {
      // Both are base64 PNGs, compare
      const atlasData = atlasMap.replace('data:image/png;base64,', '');
      const canvasData = canvasMap.replace('data:image/png;base64,', '');

      if (atlasData === canvasData) {
        console.log('✓ Displacement maps are IDENTICAL');
      } else {
        console.log('✗ Displacement maps DIFFER');
        console.log('  Atlas length:', atlasData.length);
        console.log('  Canvas length:', canvasData.length);
      }
    } else {
      console.log('Different data types - cannot compare directly');
      console.log('Atlas:', atlasMap);
      console.log('Canvas:', canvasMap);
    }

    // Close tab
    await fetch(`http://localhost:9222/json/close/${tab.id}`, { method: 'PUT' });

  } finally {
    // Restore atlas version
    console.log('\n5. Restoring atlas version...');
    fs.copyFileSync(ATLAS_BACKUP, ATLAS_FILE);
    execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'pipe' });

    // Kill dev server
    process.kill(-devServer.pid);
  }

  console.log('\nTest complete.');
}

runTest().catch(e => {
  console.error('Test failed:', e);
  // Restore on error
  if (fs.existsSync(ATLAS_BACKUP)) {
    fs.copyFileSync(ATLAS_BACKUP, ATLAS_FILE);
  }
  process.exit(1);
});

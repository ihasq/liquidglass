/**
 * CDP Computed Style SAT Solver
 *
 * CDP経由でgetComputedStyleを取得し、Flexbox構造を逆算する
 */

import puppeteer from 'puppeteer';

const PORT = 5176; // Current dev server port

async function getComputedStyles() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Set viewport to match original design
  await page.setViewport({ width: 1919, height: 997 });

  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle0' });

  // Wait for content to render
  await page.waitForSelector('h1');

  console.log('=== CDP Computed Style SAT Solver ===\n');

  // Get all elements and their computed styles via CDP
  const elements = await page.evaluate(() => {
    const results = {};

    // Helper to get computed style as object
    const getStyles = (el, name) => {
      const computed = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        name,
        // Box model
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        },
        // Positioning
        position: computed.position,
        display: computed.display,
        flexDirection: computed.flexDirection,
        alignItems: computed.alignItems,
        justifyContent: computed.justifyContent,
        gap: computed.gap,
        // Spacing
        margin: {
          top: parseFloat(computed.marginTop),
          right: parseFloat(computed.marginRight),
          bottom: parseFloat(computed.marginBottom),
          left: parseFloat(computed.marginLeft),
        },
        padding: {
          top: parseFloat(computed.paddingTop),
          right: parseFloat(computed.paddingRight),
          bottom: parseFloat(computed.paddingBottom),
          left: parseFloat(computed.paddingLeft),
        },
        // Dimensions
        width: computed.width,
        height: computed.height,
        minWidth: computed.minWidth,
        maxWidth: computed.maxWidth,
        // Typography
        fontSize: computed.fontSize,
        lineHeight: computed.lineHeight,
        fontWeight: computed.fontWeight,
        fontFamily: computed.fontFamily,
        // Visual
        backgroundColor: computed.backgroundColor,
        borderRadius: computed.borderRadius,
        color: computed.color,
      };
    };

    // Root container
    const root = document.querySelector('div.min-h-screen');
    if (root) results.root = getStyles(root, 'root');

    // Left column
    const leftCol = root?.children[0];
    if (leftCol) results.leftColumn = getStyles(leftCol, 'leftColumn');

    // Title
    const title = document.querySelector('h1');
    if (title) results.title = getStyles(title, 'title');

    // Step rows (code blocks)
    const stepRows = document.querySelectorAll('div.flex.items-center');
    stepRows.forEach((row, i) => {
      results[`stepRow${i + 1}`] = getStyles(row, `stepRow${i + 1}`);
      // Get the code block inside
      const block = row.querySelector('div.bg-\\[\\#eee\\]');
      if (block) {
        results[`codeBlock${i + 1}`] = getStyles(block, `codeBlock${i + 1}`);
      }
    });

    // Slider section
    const sliderSection = document.querySelectorAll('div.flex.mt-6, div.flex.mt-\\[27px\\]')[0];
    if (sliderSection) {
      results.sliderSection = getStyles(sliderSection, 'sliderSection');
    }

    // Slider container
    const sliderContainer = document.querySelector('div.flex.flex-col.gap-4, div.flex.flex-col.gap-\\[19px\\]');
    if (sliderContainer) {
      results.sliderContainer = getStyles(sliderContainer, 'sliderContainer');
      // Get individual sliders
      const sliders = sliderContainer.children;
      for (let i = 0; i < Math.min(sliders.length, 3); i++) {
        results[`slider${i + 1}`] = getStyles(sliders[i], `slider${i + 1}`);
      }
    }

    // Step 4 block
    const step4Blocks = document.querySelectorAll('div.bg-\\[\\#eee\\].rounded-2xl');
    if (step4Blocks.length > 0) {
      results.step4Block = getStyles(step4Blocks[0], 'step4Block');
    }

    // Right column (preview)
    const rightCol = root?.children[1];
    if (rightCol) results.rightColumn = getStyles(rightCol, 'rightColumn');

    // Preview box
    const previewBox = document.querySelector('div.bg-black.rounded-\\[76px\\], div.bg-black.rounded-\\[40px\\]');
    if (previewBox) results.previewBox = getStyles(previewBox, 'previewBox');

    return results;
  });

  await browser.close();
  return elements;
}

// SAT Solver: Derive flexbox constraints from computed values
function solveFlexboxConstraints(elements) {
  console.log('【Computed Styles from CDP】\n');

  const constraints = [];

  // Analyze root container
  if (elements.root) {
    const r = elements.root;
    console.log(`Root Container:`);
    console.log(`  display: ${r.display}`);
    console.log(`  flexDirection: ${r.flexDirection}`);
    console.log(`  rect: ${r.rect.width}×${r.rect.height} at (${r.rect.x}, ${r.rect.y})`);
    console.log();

    constraints.push({
      element: 'root',
      type: 'flex-container',
      direction: r.flexDirection,
      width: r.rect.width,
      height: r.rect.height,
    });
  }

  // Analyze left column
  if (elements.leftColumn) {
    const l = elements.leftColumn;
    console.log(`Left Column:`);
    console.log(`  display: ${l.display}`);
    console.log(`  flexDirection: ${l.flexDirection}`);
    console.log(`  rect: ${l.rect.width}×${l.rect.height} at (${l.rect.x}, ${l.rect.y})`);
    console.log(`  padding: T${l.padding.top} R${l.padding.right} B${l.padding.bottom} L${l.padding.left}`);
    console.log();

    constraints.push({
      element: 'leftColumn',
      type: 'flex-child',
      width: l.rect.width,
      widthPercent: (l.rect.width / elements.root.rect.width * 100).toFixed(2) + '%',
      paddingLeft: l.padding.left,
      paddingTop: l.padding.top,
    });
  }

  // Analyze title
  if (elements.title) {
    const t = elements.title;
    console.log(`Title:`);
    console.log(`  rect: ${t.rect.width}×${t.rect.height} at (${t.rect.x}, ${t.rect.y})`);
    console.log(`  fontSize: ${t.fontSize}`);
    console.log(`  fontWeight: ${t.fontWeight}`);
    console.log(`  lineHeight: ${t.lineHeight}`);
    console.log();
  }

  // Analyze code blocks
  for (let i = 1; i <= 2; i++) {
    const block = elements[`codeBlock${i}`];
    if (block) {
      console.log(`Code Block ${i}:`);
      console.log(`  rect: ${block.rect.width}×${block.rect.height} at (${block.rect.x}, ${block.rect.y})`);
      console.log(`  borderRadius: ${block.borderRadius}`);
      console.log(`  padding-left: ${block.padding.left}px`);
      console.log();
    }
  }

  // Analyze step rows for margin derivation
  console.log('【Vertical Gap Analysis (from margin-top)】\n');

  const stepKeys = ['stepRow1', 'stepRow2'];
  for (const key of stepKeys) {
    const row = elements[key];
    if (row) {
      console.log(`${key}: margin-top = ${row.margin.top}px, y = ${row.rect.y}px`);
    }
  }

  // Slider analysis
  if (elements.sliderContainer) {
    const sc = elements.sliderContainer;
    console.log(`\nSlider Container:`);
    console.log(`  gap: ${sc.gap}`);
    console.log(`  rect: ${sc.rect.width}×${sc.rect.height} at (${sc.rect.x}, ${sc.rect.y})`);
  }

  // Right column analysis
  if (elements.rightColumn) {
    const r = elements.rightColumn;
    console.log(`\nRight Column:`);
    console.log(`  rect: ${r.rect.width}×${r.rect.height} at (${r.rect.x}, ${r.rect.y})`);
    console.log(`  padding: T${r.padding.top} R${r.padding.right} B${r.padding.bottom} L${r.padding.left}`);

    constraints.push({
      element: 'rightColumn',
      type: 'flex-child',
      width: r.rect.width,
      widthPercent: (r.rect.width / elements.root.rect.width * 100).toFixed(2) + '%',
    });
  }

  // Preview box
  if (elements.previewBox) {
    const p = elements.previewBox;
    console.log(`\nPreview Box:`);
    console.log(`  rect: ${p.rect.width}×${p.rect.height} at (${p.rect.x}, ${p.rect.y})`);
    console.log(`  borderRadius: ${p.borderRadius}`);
    console.log(`  aspectRatio: ${(p.rect.width / p.rect.height).toFixed(3)}`);
  }

  return constraints;
}

// Derive SAT constraints
function deriveSATConstraints(elements) {
  console.log('\n\n=== SAT Solver: Flexbox Constraints ===\n');

  const vars = {};
  const equations = [];

  // Extract key measurements
  if (elements.root && elements.leftColumn && elements.rightColumn) {
    const rootW = elements.root.rect.width;
    const leftW = elements.leftColumn.rect.width;
    const rightW = elements.rightColumn.rect.width;

    vars.rootWidth = rootW;
    vars.leftColumnWidth = leftW;
    vars.rightColumnWidth = rightW;

    // Constraint: left + right = root
    equations.push({
      constraint: 'leftColumnWidth + rightColumnWidth = rootWidth',
      left: leftW,
      right: rightW,
      sum: leftW + rightW,
      root: rootW,
      satisfied: Math.abs((leftW + rightW) - rootW) < 1,
    });

    // Golden ratio check
    const ratio = rightW / leftW;
    equations.push({
      constraint: 'rightColumnWidth / leftColumnWidth ≈ φ (1.618)',
      ratio: ratio.toFixed(4),
      goldenRatio: 1.618,
      deviation: ((ratio - 1.618) / 1.618 * 100).toFixed(2) + '%',
      satisfied: Math.abs(ratio - 1.618) < 0.1,
    });
  }

  // Vertical constraints
  if (elements.title && elements.stepRow1) {
    const titleBottom = elements.title.rect.bottom;
    const step1Top = elements.stepRow1.rect.y;
    const gap = step1Top - titleBottom;

    equations.push({
      constraint: 'gap(title → step1) = margin-top',
      titleBottom: titleBottom.toFixed(1),
      step1Top: step1Top.toFixed(1),
      computedGap: gap.toFixed(1),
      marginTop: elements.stepRow1.margin.top,
      satisfied: Math.abs(gap - elements.stepRow1.margin.top) < 1,
    });
  }

  if (elements.stepRow1 && elements.stepRow2) {
    const row1Bottom = elements.stepRow1.rect.bottom;
    const row2Top = elements.stepRow2.rect.y;
    const gap = row2Top - row1Bottom;

    equations.push({
      constraint: 'gap(step1 → step2) = margin-top',
      row1Bottom: row1Bottom.toFixed(1),
      row2Top: row2Top.toFixed(1),
      computedGap: gap.toFixed(1),
      marginTop: elements.stepRow2.margin.top,
      satisfied: Math.abs(gap - elements.stepRow2.margin.top) < 1,
    });
  }

  // Print results
  console.log('Variables:');
  Object.entries(vars).forEach(([k, v]) => {
    console.log(`  ${k} = ${v}px`);
  });

  console.log('\nConstraints:');
  equations.forEach((eq, i) => {
    console.log(`\n  [${i + 1}] ${eq.constraint}`);
    Object.entries(eq).forEach(([k, v]) => {
      if (k !== 'constraint') {
        console.log(`      ${k}: ${v}`);
      }
    });
  });

  return { vars, equations };
}

// Main
async function main() {
  try {
    const elements = await getComputedStyles();

    console.log('Retrieved computed styles for', Object.keys(elements).length, 'elements\n');

    const constraints = solveFlexboxConstraints(elements);
    const satResult = deriveSATConstraints(elements);

    // Output raw data for further analysis
    console.log('\n\n=== Raw Element Data (JSON) ===\n');
    console.log(JSON.stringify(elements, null, 2));

  } catch (error) {
    console.error('Error:', error.message);
    if (error.message.includes('net::ERR_CONNECTION_REFUSED')) {
      console.error(`\nMake sure dev server is running on port ${PORT}`);
    }
  }
}

main();

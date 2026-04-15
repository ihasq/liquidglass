/**
 * CDP Flexbox Constraint Solver
 *
 * CDPから取得したcomputed stylesと目標座標を比較し、
 * 必要なFlexboxプロパティを逆算する
 */

import puppeteer from 'puppeteer';

const PORT = 5176;

// 目標座標（元のピクセルパーフェクト版から）
const TARGET = {
  viewport: { width: 1919, height: 997 },

  // 左カラム
  leftColumn: {
    paddingTop: 66,
    paddingLeft: 117,
    width: 752, // content right edge
  },

  // タイトル
  title: {
    x: 126,
    y: 66,
    fontSize: 48,
  },

  // Step 1
  step1Number: { x: 117, y: 184 },
  step1Block: { x: 166, y: 171, width: 586, height: 48 },

  // Step 2
  step2Block: { x: 166, y: 236, width: 586, height: 48 },

  // Sliders
  sliderContainer: { x: 167, y: 311 }, // first slider top
  sliderGap: 19,

  // Step 4
  step4Block: { x: 166, y: 666, width: 586, height: 264 },

  // プレビュー
  previewBox: { x: 858, y: 60, width: 936, height: 873 },
};

async function getComputedPositions() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1919, height: 997 });
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('h1');

  const positions = await page.evaluate(() => {
    const getRect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const computed = window.getComputedStyle(el);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        paddingTop: parseFloat(computed.paddingTop),
        paddingLeft: parseFloat(computed.paddingLeft),
        marginTop: parseFloat(computed.marginTop),
      };
    };

    // Get all elements by walking the DOM
    const root = document.querySelector('div.min-h-screen');
    const leftCol = root?.children[0];
    const rightCol = root?.children[1];

    // Find specific elements
    const title = document.querySelector('h1');
    const codeBlocks = document.querySelectorAll('div.bg-\\[\\#eee\\].rounded-xl');
    const step4Block = document.querySelector('div.bg-\\[\\#eee\\].rounded-2xl');
    // Use more specific selector for preview box (the one with rounded-[76px] or aspect ratio)
    const previewBox = document.querySelector('div.bg-black.aspect-\\[936\\/873\\]') ||
                       document.querySelector('div.bg-black.lg\\:rounded-\\[76px\\]') ||
                       document.querySelector('div.bg-black[class*="rounded-[76px]"]');
    const sliderRows = document.querySelectorAll('div.flex.items-center div.h-1\\.5');

    return {
      root: getRect('div.min-h-screen'),
      leftColumn: leftCol ? {
        x: leftCol.getBoundingClientRect().x,
        y: leftCol.getBoundingClientRect().y,
        width: leftCol.getBoundingClientRect().width,
        paddingTop: parseFloat(getComputedStyle(leftCol).paddingTop),
        paddingLeft: parseFloat(getComputedStyle(leftCol).paddingLeft),
      } : null,
      title: title ? {
        x: title.getBoundingClientRect().x,
        y: title.getBoundingClientRect().y,
        width: title.getBoundingClientRect().width,
        height: title.getBoundingClientRect().height,
      } : null,
      codeBlock1: codeBlocks[0] ? {
        x: codeBlocks[0].getBoundingClientRect().x,
        y: codeBlocks[0].getBoundingClientRect().y,
        width: codeBlocks[0].getBoundingClientRect().width,
        height: codeBlocks[0].getBoundingClientRect().height,
      } : null,
      codeBlock2: codeBlocks[1] ? {
        x: codeBlocks[1].getBoundingClientRect().x,
        y: codeBlocks[1].getBoundingClientRect().y,
      } : null,
      step4Block: step4Block ? {
        x: step4Block.getBoundingClientRect().x,
        y: step4Block.getBoundingClientRect().y,
        width: step4Block.getBoundingClientRect().width,
        height: step4Block.getBoundingClientRect().height,
      } : null,
      previewBox: previewBox ? {
        x: previewBox.getBoundingClientRect().x,
        y: previewBox.getBoundingClientRect().y,
        width: previewBox.getBoundingClientRect().width,
        height: previewBox.getBoundingClientRect().height,
      } : null,
      firstSlider: sliderRows[0] ? {
        x: sliderRows[0].getBoundingClientRect().x,
        y: sliderRows[0].getBoundingClientRect().y,
      } : null,
      rightColumn: rightCol ? {
        x: rightCol.getBoundingClientRect().x,
        width: rightCol.getBoundingClientRect().width,
        paddingTop: parseFloat(getComputedStyle(rightCol).paddingTop),
        paddingLeft: parseFloat(getComputedStyle(rightCol).paddingLeft),
      } : null,
    };
  });

  await browser.close();
  return positions;
}

// SAT Solver: 差分を計算し、必要なCSS変更を導出
function solveConstraints(current) {
  console.log('=== CDP Flexbox Constraint Solver ===\n');
  console.log('【現在値 vs 目標値】\n');

  const corrections = [];

  // Title position
  if (current.title) {
    const dx = TARGET.title.x - current.title.x;
    const dy = TARGET.title.y - current.title.y;
    console.log(`Title:`);
    console.log(`  現在: (${current.title.x.toFixed(1)}, ${current.title.y.toFixed(1)})`);
    console.log(`  目標: (${TARGET.title.x}, ${TARGET.title.y})`);
    console.log(`  差分: Δx=${dx.toFixed(1)}, Δy=${dy.toFixed(1)}`);

    if (Math.abs(dy) > 1) {
      corrections.push({
        element: 'leftColumn',
        property: 'padding-top',
        currentValue: current.leftColumn?.paddingTop || 0,
        targetValue: TARGET.leftColumn.paddingTop,
        tailwind: `pt-[${TARGET.leftColumn.paddingTop}px]`,
      });
    }
    if (Math.abs(dx) > 1) {
      corrections.push({
        element: 'leftColumn',
        property: 'padding-left',
        currentValue: current.leftColumn?.paddingLeft || 0,
        targetValue: TARGET.leftColumn.paddingLeft,
        tailwind: `pl-[${TARGET.leftColumn.paddingLeft}px]`,
      });
      corrections.push({
        element: 'title',
        property: 'padding-left',
        note: 'title needs extra 9px offset',
        tailwind: `pl-[9px]`,
      });
    }
    console.log();
  }

  // Code Block 1 position
  if (current.codeBlock1) {
    const dx = TARGET.step1Block.x - current.codeBlock1.x;
    const dy = TARGET.step1Block.y - current.codeBlock1.y;
    console.log(`Code Block 1:`);
    console.log(`  現在: (${current.codeBlock1.x.toFixed(1)}, ${current.codeBlock1.y.toFixed(1)})`);
    console.log(`  目標: (${TARGET.step1Block.x}, ${TARGET.step1Block.y})`);
    console.log(`  差分: Δx=${dx.toFixed(1)}, Δy=${dy.toFixed(1)}`);

    if (Math.abs(dx) > 1) {
      // The block's x offset should be leftPadding + stepNumberWidth = 117 + 49 = 166
      corrections.push({
        element: 'stepNumber',
        property: 'width',
        currentValue: current.codeBlock1.x - (current.leftColumn?.x || 0) - (current.leftColumn?.paddingLeft || 0),
        targetValue: 49,
        tailwind: `w-[49px]`,
      });
    }
    console.log();
  }

  // Preview Box position
  if (current.previewBox) {
    const dx = TARGET.previewBox.x - current.previewBox.x;
    const dy = TARGET.previewBox.y - current.previewBox.y;
    console.log(`Preview Box:`);
    console.log(`  現在: (${current.previewBox.x.toFixed(1)}, ${current.previewBox.y.toFixed(1)})`);
    console.log(`  目標: (${TARGET.previewBox.x}, ${TARGET.previewBox.y})`);
    console.log(`  差分: Δx=${dx.toFixed(1)}, Δy=${dy.toFixed(1)}`);

    if (Math.abs(dy) > 1) {
      corrections.push({
        element: 'rightColumn',
        property: 'padding-top',
        currentValue: current.rightColumn?.paddingTop || 0,
        targetValue: 60,
        tailwind: `pt-[60px]`,
      });
    }

    // Calculate required padding-left for right column
    // previewBox.x = rightColumn.x + rightColumn.paddingLeft + (rightColumn.innerWidth - previewBox.width) / 2
    // For justify-center: previewBox.x = rightColumn.x + (rightColumn.width - previewBox.width) / 2
    // But we want previewBox.x = 858
    // So: rightColumn.paddingLeft = previewBox.x - rightColumn.x - (rightColumn.innerWidth - previewBox.width) / 2
    // With justify-center and max-width on previewBox:
    // We need to position the preview at x=858 within the rightColumn

    const rightColX = current.rightColumn?.x || 0;
    const rightColWidth = current.rightColumn?.width || 0;
    const previewWidth = TARGET.previewBox.width;

    // With justify-center: centered position would be rightColX + (rightColWidth - previewWidth) / 2
    const centeredX = rightColX + (rightColWidth - previewWidth) / 2;
    const requiredOffset = TARGET.previewBox.x - centeredX;

    console.log(`  右カラム開始: ${rightColX.toFixed(1)}`);
    console.log(`  中央配置時のX: ${centeredX.toFixed(1)}`);
    console.log(`  必要なオフセット: ${requiredOffset.toFixed(1)}px`);

    if (Math.abs(requiredOffset) > 1) {
      corrections.push({
        element: 'previewBox',
        property: 'margin-left (or remove justify-center)',
        note: `Preview needs ${requiredOffset.toFixed(1)}px left offset from center`,
        suggestion: 'Use items-start + pl-[X] instead of justify-center',
      });
    }
    console.log();
  }

  // Step 4 Block
  if (current.step4Block) {
    console.log(`Step 4 Block:`);
    console.log(`  現在: (${current.step4Block.x.toFixed(1)}, ${current.step4Block.y.toFixed(1)})`);
    console.log(`  目標: (${TARGET.step4Block.x}, ${TARGET.step4Block.y})`);
    console.log(`  差分: Δy=${(TARGET.step4Block.y - current.step4Block.y).toFixed(1)}`);
    console.log();
  }

  // Output corrections
  console.log('=== 必要な修正 (SAT Solution) ===\n');

  corrections.forEach((c, i) => {
    console.log(`[${i + 1}] ${c.element}.${c.property}`);
    if (c.currentValue !== undefined) {
      console.log(`    現在: ${c.currentValue}px`);
      console.log(`    目標: ${c.targetValue}px`);
    }
    console.log(`    Tailwind: ${c.tailwind || c.suggestion || c.note}`);
    console.log();
  });

  // Calculate golden ratio constraint
  console.log('=== 黄金比制約 ===\n');

  if (current.leftColumn && current.rightColumn) {
    const leftW = current.leftColumn.width;
    const rightW = current.rightColumn.width;
    const ratio = rightW / leftW;

    console.log(`現在の比率: ${leftW.toFixed(1)} : ${rightW.toFixed(1)} = 1 : ${ratio.toFixed(4)}`);
    console.log(`黄金比 φ: 1 : 1.618`);
    console.log(`誤差: ${((ratio - 1.618) / 1.618 * 100).toFixed(3)}%`);

    // SAT equation for golden ratio
    // rightW / leftW = φ
    // rightW = φ * leftW
    // leftW + rightW = viewport
    // leftW + φ * leftW = viewport
    // leftW * (1 + φ) = viewport
    // leftW = viewport / (1 + φ) = viewport / 2.618

    const phi = 1.618;
    const idealLeftW = TARGET.viewport.width / (1 + phi);
    const idealRightW = TARGET.viewport.width - idealLeftW;

    console.log(`\n理想的な分割 (φ基準):`);
    console.log(`  左カラム: ${idealLeftW.toFixed(2)}px (${(idealLeftW / TARGET.viewport.width * 100).toFixed(2)}%)`);
    console.log(`  右カラム: ${idealRightW.toFixed(2)}px (${(idealRightW / TARGET.viewport.width * 100).toFixed(2)}%)`);
    console.log(`\nTailwind: w-[${(idealLeftW / TARGET.viewport.width * 100).toFixed(1)}%] / flex-1`);
  }

  return corrections;
}

async function main() {
  try {
    const positions = await getComputedPositions();
    console.log('CDP positions retrieved.\n');
    const corrections = solveConstraints(positions);

    // Generate fixed Tailwind classes
    console.log('\n=== 生成されるFlexbox CSS ===\n');

    console.log(`/* 左カラム - 1919pxビューポート時 */
.left-column {
  display: flex;
  flex-direction: column;
  padding-top: ${TARGET.leftColumn.paddingTop}px;   /* pt-[66px] */
  padding-left: ${TARGET.leftColumn.paddingLeft}px; /* pl-[117px] */
  width: ${(733 / 1919 * 100).toFixed(2)}%;         /* w-[38.2%] */
  min-width: 480px;
}

/* タイトル */
.title {
  padding-left: 9px;  /* 126 - 117 = 9px offset */
}

/* ステップ行 */
.step-row {
  display: flex;
  align-items: center;
}

.step-number {
  width: 49px;        /* w-[49px] */
  flex-shrink: 0;
}

.code-block {
  width: 586px;       /* w-[586px] on lg */
  height: 48px;       /* h-12 */
}

/* 右カラム */
.right-column {
  flex: 1;
  padding-top: 60px;  /* pt-[60px] */
  display: flex;
  justify-content: center;
}

/* プレビューボックスのX位置調整 */
/* 目標: x=858, 現在の中央配置からのオフセット */
.preview-box {
  width: 936px;
  height: 873px;
  max-width: 936px;
  /* justify-content: center の場合、マージンで調整 */
}
`);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();

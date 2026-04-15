/**
 * Tailwind ↔ CSS 全射関係マッピング
 *
 * 目的: 任意のCSS値をTailwind表現に変換可能にする
 *
 * Tailwind → CSS: 定義済み（deterministic）
 * CSS → Tailwind: 逆関数を構築（SAT solver的アプローチ）
 */

// ============================================
// 1. SPACING SCALE (spacing, margin, padding, width, height, gap, inset, etc.)
// ============================================
// Base unit: 1 = 0.25rem = 4px (at default 16px root font size)

const SPACING_SCALE = {
  '0': 0,
  'px': 1,
  '0.5': 2,
  '1': 4,
  '1.5': 6,
  '2': 8,
  '2.5': 10,
  '3': 12,
  '3.5': 14,
  '4': 16,
  '5': 20,
  '6': 24,
  '7': 28,
  '8': 32,
  '9': 36,
  '10': 40,
  '11': 44,
  '12': 48,
  '14': 56,
  '16': 64,
  '20': 80,
  '24': 96,
  '28': 112,
  '32': 128,
  '36': 144,
  '40': 160,
  '44': 176,
  '48': 192,
  '52': 208,
  '56': 224,
  '60': 240,
  '64': 256,
  '72': 288,
  '80': 320,
  '96': 384,
};

// 数学的関係: spacing_key * 4 = px (例外: 'px'=1, '0'=0)
// 逆関数: px / 4 = spacing_key (整数の場合のみ直接マッピング)

// ============================================
// 2. FONT SIZE SCALE
// ============================================

const FONT_SIZE_SCALE = {
  'xs': { size: 12, lineHeight: 16 },
  'sm': { size: 14, lineHeight: 20 },
  'base': { size: 16, lineHeight: 24 },
  'lg': { size: 18, lineHeight: 28 },
  'xl': { size: 20, lineHeight: 28 },
  '2xl': { size: 24, lineHeight: 32 },
  '3xl': { size: 30, lineHeight: 36 },
  '4xl': { size: 36, lineHeight: 40 },
  '5xl': { size: 48, lineHeight: 48 },
  '6xl': { size: 60, lineHeight: 60 },
  '7xl': { size: 72, lineHeight: 72 },
  '8xl': { size: 96, lineHeight: 96 },
  '9xl': { size: 128, lineHeight: 128 },
};

// ============================================
// 3. BORDER RADIUS SCALE
// ============================================

const BORDER_RADIUS_SCALE = {
  'none': 0,
  'sm': 2,
  'DEFAULT': 4,  // rounded
  'md': 6,
  'lg': 8,
  'xl': 12,
  '2xl': 16,
  '3xl': 24,
  'full': 9999,
};

// ============================================
// 4. CSS → TAILWIND 逆関数
// ============================================

/**
 * ピクセル値を最も近いTailwindスペーシング値に変換
 * @param {number} px - ピクセル値
 * @returns {{ key: string, exact: boolean, diff: number }}
 */
function pxToSpacing(px) {
  let bestKey = null;
  let bestDiff = Infinity;

  for (const [key, value] of Object.entries(SPACING_SCALE)) {
    const diff = Math.abs(value - px);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestKey = key;
    }
  }

  return {
    key: bestKey,
    twValue: SPACING_SCALE[bestKey],
    exact: bestDiff === 0,
    diff: bestDiff,
    arbitrary: `[${px}px]`,
  };
}

/**
 * ピクセル値を最も近いTailwindフォントサイズに変換
 */
function pxToFontSize(px) {
  let bestKey = null;
  let bestDiff = Infinity;

  for (const [key, { size }] of Object.entries(FONT_SIZE_SCALE)) {
    const diff = Math.abs(size - px);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestKey = key;
    }
  }

  return {
    key: bestKey,
    twValue: FONT_SIZE_SCALE[bestKey].size,
    exact: bestDiff === 0,
    diff: bestDiff,
    arbitrary: `[${px}px]`,
  };
}

/**
 * ピクセル値を最も近いTailwind border-radiusに変換
 */
function pxToBorderRadius(px) {
  let bestKey = null;
  let bestDiff = Infinity;

  for (const [key, value] of Object.entries(BORDER_RADIUS_SCALE)) {
    const diff = Math.abs(value - px);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestKey = key;
    }
  }

  return {
    key: bestKey,
    twValue: BORDER_RADIUS_SCALE[bestKey],
    exact: bestDiff === 0,
    diff: bestDiff,
    arbitrary: `[${px}px]`,
  };
}

// ============================================
// 5. 現在のレイアウト値を分析
// ============================================

const CURRENT_LAYOUT = {
  // Title
  title: { left: 126, top: 66, fontSize: 48, fontWeight: 500 },

  // Step numbers (x position)
  stepNumbers: { left: 117 },

  // Code blocks (all share same bounds)
  codeBlocks: { left: 166, width: 586, height: 48, borderRadius: 12, paddingLeft: 23 },

  // Step 4 code block
  step4Block: { left: 166, top: 666, width: 586, height: 264, borderRadius: 16, padding: { top: 23, right: 40, bottom: 12, left: 23 } },

  // Sliders
  sliderLine: { left: 167, height: 6 },
  sliderKnob: { left: 445, size: 30 },
  sliderLineRight: { left: 477, width: 275 },

  // Black box
  blackBox: { left: 858, top: 60, width: 936, height: 873, borderRadius: 76 },

  // Copy icons
  copyIcon: { left: 720 },
};

console.log('=== TAILWIND ↔ CSS 全射関係分析 ===\n');

console.log('【スペーシングスケール】');
console.log('数学的関係: tailwind_key × 4 = px');
console.log('逆関数: px ÷ 4 = tailwind_key\n');

console.log('【現在のレイアウト値 → Tailwind変換】\n');

// Analyze each value
const analyzeValue = (name, px, type = 'spacing') => {
  let result;
  if (type === 'spacing') {
    result = pxToSpacing(px);
  } else if (type === 'fontSize') {
    result = pxToFontSize(px);
  } else if (type === 'borderRadius') {
    result = pxToBorderRadius(px);
  }

  const status = result.exact ? '✓ 完全一致' : `△ 差分 ${result.diff}px`;
  const recommendation = result.exact ? result.key : result.arbitrary;

  console.log(`${name}: ${px}px → ${status}`);
  console.log(`  Tailwind: ${recommendation} (${result.exact ? `tw-${result.key}` : 'arbitrary value'})`);
  console.log();
};

analyzeValue('Title left', 126, 'spacing');
analyzeValue('Title top', 66, 'spacing');
analyzeValue('Title fontSize', 48, 'fontSize');
analyzeValue('StepNumber left', 117, 'spacing');
analyzeValue('CodeBlock left', 166, 'spacing');
analyzeValue('CodeBlock width', 586, 'spacing');
analyzeValue('CodeBlock height', 48, 'spacing');
analyzeValue('CodeBlock borderRadius', 12, 'borderRadius');
analyzeValue('CodeBlock paddingLeft', 23, 'spacing');
analyzeValue('BlackBox left', 858, 'spacing');
analyzeValue('BlackBox width', 936, 'spacing');
analyzeValue('BlackBox height', 873, 'spacing');
analyzeValue('BlackBox borderRadius', 76, 'borderRadius');

// ============================================
// 6. SAT SOLVER的アプローチの提案
// ============================================

console.log('\n=== SAT SOLVER的変換アプローチ ===\n');
console.log('制約条件:');
console.log('1. すべてのコードブロックは同じ右端 (left + width = 752)');
console.log('2. スライダーラインはコードブロックと同じ右端');
console.log('3. 黒いボックスとコンテンツ領域の間にギャップがある');
console.log('4. 垂直方向の間隔は一貫したリズムを持つ');
console.log();
console.log('Tailwind変換戦略:');
console.log('1. 固定グリッドを定義 (左コンテンツ / 右プレビュー)');
console.log('2. 相対的な位置関係をflex/gridで表現');
console.log('3. 絶対値が必要な場所のみarbitrary values使用');

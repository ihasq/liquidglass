/**
 * CSS → Tailwind SAT Solver
 *
 * 目的: 任意のCSS値を最適なTailwind表現に変換する
 *
 * 戦略:
 * 1. 完全一致を探す (最優先)
 * 2. 丸めて近似可能か判定 (許容誤差内)
 * 3. 比率/パーセント表現を検討 (レスポンシブ)
 * 4. arbitrary valueにフォールバック
 */

// ============================================
// Tailwindスケール定義
// ============================================

const SCALES = {
  spacing: {
    '0': 0, 'px': 1, '0.5': 2, '1': 4, '1.5': 6, '2': 8, '2.5': 10,
    '3': 12, '3.5': 14, '4': 16, '5': 20, '6': 24, '7': 28, '8': 32,
    '9': 36, '10': 40, '11': 44, '12': 48, '14': 56, '16': 64, '20': 80,
    '24': 96, '28': 112, '32': 128, '36': 144, '40': 160, '44': 176,
    '48': 192, '52': 208, '56': 224, '60': 240, '64': 256, '72': 288,
    '80': 320, '96': 384,
  },

  fontSize: {
    'xs': 12, 'sm': 14, 'base': 16, 'lg': 18, 'xl': 20,
    '2xl': 24, '3xl': 30, '4xl': 36, '5xl': 48, '6xl': 60,
    '7xl': 72, '8xl': 96, '9xl': 128,
  },

  borderRadius: {
    'none': 0, 'sm': 2, 'DEFAULT': 4, 'md': 6, 'lg': 8,
    'xl': 12, '2xl': 16, '3xl': 24, 'full': 9999,
  },

  // 分数（width/heightで使用）
  fractions: {
    '1/2': 0.5, '1/3': 0.333, '2/3': 0.667,
    '1/4': 0.25, '2/4': 0.5, '3/4': 0.75,
    '1/5': 0.2, '2/5': 0.4, '3/5': 0.6, '4/5': 0.8,
    '1/6': 0.167, '5/6': 0.833,
    'full': 1.0,
  },
};

// ============================================
// SAT Solver
// ============================================

class TailwindSolver {
  constructor(options = {}) {
    this.tolerance = options.tolerance || 2; // 許容誤差(px)
    this.preferRatio = options.preferRatio || false; // 比率優先
    this.viewportWidth = options.viewportWidth || 1920;
  }

  /**
   * CSS値をTailwindに変換
   * @param {number} value - CSS値(px)
   * @param {string} property - CSSプロパティタイプ
   * @param {object} context - 追加コンテキスト（親要素のサイズなど）
   * @returns {object} 変換結果
   */
  solve(value, property = 'spacing', context = {}) {
    const scale = SCALES[property] || SCALES.spacing;
    const solutions = [];

    // 1. 完全一致を探す
    for (const [key, scaleValue] of Object.entries(scale)) {
      if (scaleValue === value) {
        solutions.push({
          type: 'exact',
          key,
          value: scaleValue,
          score: 100,
          tailwind: this.formatTailwind(property, key),
        });
      }
    }

    // 2. 近似値を探す（許容誤差内）
    for (const [key, scaleValue] of Object.entries(scale)) {
      const diff = Math.abs(scaleValue - value);
      if (diff > 0 && diff <= this.tolerance) {
        solutions.push({
          type: 'approximate',
          key,
          value: scaleValue,
          diff,
          score: 80 - diff * 10,
          tailwind: this.formatTailwind(property, key),
          note: `${diff}px差、丸め可能`,
        });
      }
    }

    // 3. 比率/パーセント表現を検討
    if (context.parentWidth) {
      const ratio = value / context.parentWidth;
      for (const [key, fracValue] of Object.entries(SCALES.fractions)) {
        const diff = Math.abs(ratio - fracValue);
        if (diff < 0.02) { // 2%以内
          solutions.push({
            type: 'fraction',
            key,
            ratio: fracValue,
            actualRatio: ratio,
            score: 90 - diff * 100,
            tailwind: `w-${key}`,
            note: `比率${(fracValue * 100).toFixed(0)}%`,
          });
        }
      }
    }

    // 4. arbitrary value（常に可能）
    solutions.push({
      type: 'arbitrary',
      value,
      score: 50,
      tailwind: `[${value}px]`,
      note: 'カスタム値',
    });

    // スコア順にソート
    solutions.sort((a, b) => b.score - a.score);

    return {
      input: { value, property, context },
      solutions,
      best: solutions[0],
    };
  }

  formatTailwind(property, key) {
    const prefixes = {
      spacing: '', // context dependent (w-, h-, p-, m-, etc.)
      fontSize: 'text-',
      borderRadius: 'rounded-',
    };
    return `${prefixes[property] || ''}${key}`;
  }
}

// ============================================
// テスト実行
// ============================================

const solver = new TailwindSolver({ tolerance: 4, viewportWidth: 1919 });

console.log('=== CSS → Tailwind SAT Solver ===\n');

const testCases = [
  { value: 48, property: 'spacing', desc: 'コードブロック高さ' },
  { value: 48, property: 'fontSize', desc: 'タイトルフォントサイズ' },
  { value: 12, property: 'borderRadius', desc: 'コードブロック角丸' },
  { value: 16, property: 'borderRadius', desc: 'Step4角丸' },
  { value: 166, property: 'spacing', desc: 'コンテンツ左マージン' },
  { value: 586, property: 'spacing', desc: 'コードブロック幅', context: { parentWidth: 1919 } },
  { value: 936, property: 'spacing', desc: 'プレビュー幅', context: { parentWidth: 1919 } },
  { value: 76, property: 'borderRadius', desc: '黒いボックス角丸' },
  { value: 23, property: 'spacing', desc: 'パディング' },
];

testCases.forEach(({ value, property, desc, context }) => {
  const result = solver.solve(value, property, context || {});
  console.log(`【${desc}】 ${value}px`);
  console.log(`  最適解: ${result.best.tailwind} (${result.best.type})`);
  if (result.best.note) {
    console.log(`  備考: ${result.best.note}`);
  }
  if (result.solutions.length > 1) {
    console.log(`  代替案: ${result.solutions.slice(1, 3).map(s => s.tailwind).join(', ')}`);
  }
  console.log();
});

// ============================================
// 黄金比の検証
// ============================================

console.log('=== 黄金比の検証 ===\n');

const goldenRatio = 1.618;
const contentWidth = 586;
const previewWidth = 936;
const ratio = previewWidth / contentWidth;

console.log(`実際の比率: 1:${ratio.toFixed(3)}`);
console.log(`黄金比: 1:${goldenRatio}`);
console.log(`誤差: ${((ratio - goldenRatio) / goldenRatio * 100).toFixed(2)}%`);
console.log();
console.log('→ 黄金比に基づくレイアウトと推定');
console.log('→ Tailwindでは w-[38.2%] と w-[61.8%] で表現可能');

/**
 * レイアウト意図の数学的分析
 *
 * 目的: ピクセル値から「設計意図」を逆算し、
 *       レスポンシブなTailwind表現を導出する
 */

// 現在のビューポート
const VIEWPORT = { width: 1919, height: 997 };

// 現在のレイアウト値
const LAYOUT = {
  // 左コンテンツエリア
  content: {
    left: 166,
    rightEdge: 752,  // code blocks end here
  },

  // 右プレビューエリア
  preview: {
    left: 858,
    right: 1793,  // 858 + 936 - 1
  },

  // 黒いボックス
  blackBox: {
    left: 858,
    top: 60,
    width: 936,
    height: 873,
  },

  // ステップ番号
  stepNumbers: {
    left: 117,
  },

  // タイトル
  title: {
    left: 126,
  },
};

console.log('=== レイアウト意図の数学的分析 ===\n');

// 1. 水平分割の比率を計算
console.log('【1. 水平分割比率】');
const contentWidth = LAYOUT.content.rightEdge - LAYOUT.content.left;
const gapWidth = LAYOUT.preview.left - LAYOUT.content.rightEdge;
const previewWidth = LAYOUT.blackBox.width;

console.log(`コンテンツ幅: ${contentWidth}px (${(contentWidth / VIEWPORT.width * 100).toFixed(1)}%)`);
console.log(`ギャップ幅: ${gapWidth}px (${(gapWidth / VIEWPORT.width * 100).toFixed(1)}%)`);
console.log(`プレビュー幅: ${previewWidth}px (${(previewWidth / VIEWPORT.width * 100).toFixed(1)}%)`);
console.log(`合計: ${LAYOUT.content.left + contentWidth + gapWidth + previewWidth}px`);

// 比率を最も近い分数で表現
const totalUsed = LAYOUT.content.left + contentWidth + gapWidth + previewWidth;
const leftMargin = LAYOUT.content.left;
const rightMargin = VIEWPORT.width - LAYOUT.blackBox.left - LAYOUT.blackBox.width;

console.log(`\n左マージン: ${leftMargin}px`);
console.log(`右マージン: ${rightMargin}px`);

// 2. グリッド分析
console.log('\n【2. グリッド構造の推定】');

// 仮説: 12カラムグリッド
const columnWidth12 = VIEWPORT.width / 12;
console.log(`12カラムグリッドの場合: 1col = ${columnWidth12.toFixed(1)}px`);
console.log(`コンテンツ: ${(contentWidth / columnWidth12).toFixed(2)}col`);
console.log(`プレビュー: ${(previewWidth / columnWidth12).toFixed(2)}col`);

// 仮説: 黄金比
const goldenRatio = 1.618;
console.log(`\n黄金比(1:1.618)の場合:`);
console.log(`コンテンツ:プレビュー = ${contentWidth}:${previewWidth} = 1:${(previewWidth / contentWidth).toFixed(3)}`);

// 3. 垂直リズムの分析
console.log('\n【3. 垂直リズムの分析】');

const verticalPositions = {
  title: 66,
  step1: 171,
  step2: 236,
  step3_start: 325,  // first slider
  step3_end: 618,    // last slider
  step4: 666,
  blackBoxTop: 60,
  blackBoxBottom: 60 + 873,
};

console.log('要素のY位置:');
Object.entries(verticalPositions).forEach(([name, y]) => {
  console.log(`  ${name}: ${y}px`);
});

// 垂直間隔
console.log('\n垂直間隔:');
console.log(`  title → step1: ${verticalPositions.step1 - verticalPositions.title}px`);
console.log(`  step1 → step2: ${verticalPositions.step2 - verticalPositions.step1}px`);
console.log(`  step2 → step3_start: ${verticalPositions.step3_start - verticalPositions.step2}px`);
console.log(`  step3内スライダー間隔: ${(verticalPositions.step3_end - verticalPositions.step3_start) / 6}px`);
console.log(`  step3_end → step4: ${verticalPositions.step4 - verticalPositions.step3_end}px`);

// 4. Tailwind Grid/Flex変換の提案
console.log('\n【4. Tailwind構造の提案】');
console.log(`
<div class="flex min-h-screen">
  <!-- 左コンテンツエリア -->
  <div class="w-[45%] pl-[166px] pr-[106px]">
    <!-- title, steps -->
  </div>

  <!-- 右プレビューエリア -->
  <div class="w-[55%] p-[60px]">
    <!-- black box -->
  </div>
</div>
`);

// 5. 数学的関係のサマリー
console.log('【5. 発見した数学的関係】');
console.log('');
console.log('1. コンテンツ幅:プレビュー幅 ≈ 586:936 ≈ 0.626 (≈ 2:3.2)');
console.log('2. スライダー間隔: 約49px (≈ 48px = h-12と近い)');
console.log('3. コードブロック高さ: 48px = h-12 (完全一致)');
console.log('4. 角丸: 12px = rounded-xl, 16px = rounded-2xl');
console.log('5. 左マージン166px ≈ 40*4 + 6 (w-40 + w-1.5に近い)');

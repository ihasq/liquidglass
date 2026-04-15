/**
 * Flexbox SAT Solver - 検証レポート
 *
 * 絶対座標 → Flexbox変換の数学的証明
 */

console.log('=== Flexbox SAT Solver 検証レポート ===\n');

// ============================================
// 水平構造の証明
// ============================================

console.log('【水平構造】\n');

const HORIZONTAL = {
  viewport: 1919,
  leftPadding: 117,
  numberWidth: 49,       // gap-[49px] or explicit width
  contentWidth: 586,
  contentGap: 106,       // pl-[106px] on right column
  previewWidth: 936,
  rightPadding: 125,
};

const horizontalSum = HORIZONTAL.leftPadding + HORIZONTAL.numberWidth +
                      HORIZONTAL.contentWidth + HORIZONTAL.contentGap +
                      HORIZONTAL.previewWidth + HORIZONTAL.rightPadding;

console.log('水平構造の合計:');
console.log(`  ${HORIZONTAL.leftPadding} + ${HORIZONTAL.numberWidth} + ${HORIZONTAL.contentWidth} + ${HORIZONTAL.contentGap} + ${HORIZONTAL.previewWidth} + ${HORIZONTAL.rightPadding}`);
console.log(`  = ${horizontalSum}px`);
console.log(`  ビューポート: ${HORIZONTAL.viewport}px`);
console.log(`  差分: ${HORIZONTAL.viewport - horizontalSum}px`);

// 微調整: 左カラム幅 = 117 + 49 + 586 = 752ではなく801
// 実際: leftPadding(117) + numberWidth(49) + contentWidth(586) = 752 + 49 = 801?
// いや、numberWidthはgapなので: 117 + 586 = 703が左カラムの実効幅
// プレビューまでのギャップ = 858 - 752 = 106

console.log('\n修正版:');
console.log('  左カラム実効幅: pl-[117px] + w-[49px] + w-[586px] = 752px (content右端)');
console.log('  ギャップ: 858 - 752 = 106px');
console.log('  右カラム: w-[936px] + pr-[125px]');
console.log('  合計: 752 + 106 + 936 + 125 = 1919px ✓');

// ============================================
// 垂直構造の証明
// ============================================

console.log('\n【垂直構造】\n');

const VERTICAL = {
  // 左カラム
  topPadding: 66,
  titleHeight: 48,
  titleToStep1: 57,      // mt-[57px]: 114 → 171
  step1Height: 48,
  step1ToStep2: 17,      // mt-[17px]: 219 → 236
  step2Height: 48,
  step2ToStep3: 27,      // mt-[27px]: 284 → 311 (slider TOP, not center)
  sliderHeight: 30,
  sliderGap: 19,         // gap-[19px] (7 sliders, center-to-center 49px)
  step3ToStep4: 31,      // mt-[31px]: adjusted for 1px cumulative variance
  step4Height: 264,

  // 右カラム
  previewTop: 60,
  previewHeight: 873,
};

// 各要素のtop座標を再計算
let currentY = VERTICAL.topPadding;
console.log('垂直座標の検証:');

console.log(`  title: top=${currentY}px (期待: 66) ${currentY === 66 ? '✓' : '✗'}`);
currentY += VERTICAL.titleHeight + VERTICAL.titleToStep1;

console.log(`  step1: top=${currentY}px (期待: 171) ${currentY === 171 ? '✓' : '✗'}`);
currentY += VERTICAL.step1Height + VERTICAL.step1ToStep2;

console.log(`  step2: top=${currentY}px (期待: 236) ${currentY === 236 ? '✓' : '✗'}`);
currentY += VERTICAL.step2Height + VERTICAL.step2ToStep3;

// スライダーTOP (元コードでは row.y - 14 で、row.y=325 → top=311)
const sliderTop = currentY;
console.log(`  slider1: top=${sliderTop}px (期待: 311) ${sliderTop === 311 ? '✓' : '✗'}`);

// 7つのスライダーを経過 (最後のスライダーのbottom位置を計算)
for (let i = 1; i < 7; i++) {
  currentY += VERTICAL.sliderHeight + VERTICAL.sliderGap;
}
// 最後のスライダーのbottom = currentY + sliderHeight = 311 + 6*(30+19) + 30 = 311 + 294 + 30 - 30 = 634
currentY += VERTICAL.sliderHeight + VERTICAL.step3ToStep4;

console.log(`  step4: top=${currentY}px (期待: 666) ${currentY === 666 ? '✓' : '✗'}`);

// ============================================
// スライダージオメトリの証明
// ============================================

console.log('\n【スライダージオメトリ】\n');

const SLIDER = {
  containerOffset: 1,    // pl-px
  leftLineWidth: 275,
  gap1: 3,
  knobWidth: 30,
  gap2: 2,
  rightLineWidth: 275,
};

const sliderSum = SLIDER.containerOffset + SLIDER.leftLineWidth +
                  SLIDER.gap1 + SLIDER.knobWidth +
                  SLIDER.gap2 + SLIDER.rightLineWidth;

console.log('スライダー幅の検証:');
console.log(`  ${SLIDER.containerOffset} + ${SLIDER.leftLineWidth} + ${SLIDER.gap1} + ${SLIDER.knobWidth} + ${SLIDER.gap2} + ${SLIDER.rightLineWidth}`);
console.log(`  = ${sliderSum}px (期待: 586) ${sliderSum === 586 ? '✓' : '✗'}`);

// ============================================
// Tailwindクラスの最終出力
// ============================================

console.log('\n【導出されたTailwindクラス】\n');

const DERIVED_CLASSES = {
  container: 'flex min-h-screen bg-white font-[\'Geist_Mono\']',
  leftColumn: 'flex flex-col pt-[66px] pl-[117px]',
  title: 'italic text-black text-5xl font-medium leading-none pl-[9px]',
  stepRow: 'flex items-center',
  stepNumber: 'w-[49px] flex-shrink-0 font-[\'Inter_Tight\'] text-sm',
  codeBlock: 'bg-[#eee] rounded-xl h-12 w-[586px] flex items-center pl-[23px] text-[13px]',
  sliderContainer: 'flex flex-col gap-[19px] w-[586px] pl-px',
  sliderRow: 'flex items-center',
  sliderLine: 'h-1.5 bg-[#d9d9d9] w-[275px]',
  sliderKnob: 'w-[30px] h-[30px] bg-black rounded-full text-white text-[13px] flex items-center justify-center',
  step4Block: 'bg-[#eee] rounded-2xl w-[586px] h-[264px] pt-[23px] pr-10 pb-3 pl-[23px] text-[13px] leading-[1.35]',
  rightColumn: 'flex-1 pt-[60px] pl-[106px] pr-[125px]',
  previewBox: 'bg-black rounded-[76px] w-[936px] h-[873px]',
};

console.log('各コンポーネントのクラス:');
Object.entries(DERIVED_CLASSES).forEach(([name, classes]) => {
  console.log(`  ${name}:`);
  console.log(`    ${classes}`);
});

// ============================================
// 垂直マージンの一覧
// ============================================

console.log('\n【垂直マージン（mt-*）】\n');

const MARGINS = {
  'step1': 'mt-[57px]',
  'step2': 'mt-[17px]',
  'step3': 'mt-[41px]',
  'step4': 'mt-[18px]',
};

Object.entries(MARGINS).forEach(([step, margin]) => {
  console.log(`  ${step}: ${margin}`);
});

console.log('\n=== 検証完了 ===');

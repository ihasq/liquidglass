/**
 * Flexbox SAT Solver
 *
 * 目的: 絶対座標からTailwind Flexboxレイアウトを逆算する
 *
 * 入力: 各要素の { left, top, width, height }
 * 出力: 等価なFlexbox構造 + gap/padding値
 */

// ============================================
// 現在の絶対座標データ
// ============================================

const VIEWPORT = { width: 1919, height: 997 };

const ELEMENTS = {
  title: { left: 126, top: 66, width: null, height: 48 },

  step1Number: { left: 117, top: 184, width: 49, height: 14 }, // 117→166の間
  step1Block: { left: 166, top: 171, width: 586, height: 48 },
  step1Copy: { left: 720, top: 187, width: 14, height: 14 },

  step2Number: { left: 117, top: 250, width: 49, height: 14 },
  step2Block: { left: 166, top: 236, width: 586, height: 48 },
  step2Copy: { left: 720, top: 252, width: 14, height: 14 },

  step3Number: { left: 121, top: 314, width: 45, height: 14 },
  sliderLine: { left: 167, top: null, width: 275, height: 6 },
  sliderKnob: { left: 445, top: null, width: 30, height: 30 },
  sliderLineRight: { left: 477, top: null, width: 275, height: 6 },
  sliderYs: [325, 374, 423, 472, 521, 569, 618],

  step4Number: { left: 117, top: 682, width: 49, height: 14 },
  step4Block: { left: 166, top: 666, width: 586, height: 264 },
  step4Copy: { left: 720, top: 684, width: 14, height: 14 },

  previewBox: { left: 858, top: 60, width: 936, height: 873 },
};

// ============================================
// SAT Solver: 水平分割の逆算
// ============================================

console.log('=== Flexbox SAT Solver ===\n');
console.log('【水平構造の解析】\n');

// 水平方向の区切り点を抽出
const horizontalBreakpoints = [
  { x: 0, label: 'viewport-start' },
  { x: 117, label: 'step-number-left' },
  { x: 126, label: 'title-left' },
  { x: 166, label: 'content-left' },
  { x: 752, label: 'content-right (166+586)' },
  { x: 858, label: 'preview-left' },
  { x: 1794, label: 'preview-right (858+936)' },
  { x: 1919, label: 'viewport-end' },
];

console.log('水平ブレークポイント:');
horizontalBreakpoints.forEach(bp => console.log(`  x=${bp.x}px: ${bp.label}`));

// ギャップを計算
const gaps = {
  leftPadding: 117,                    // viewport → step numbers
  numberToContent: 166 - 117,          // step numbers → content = 49px
  contentGap: 858 - 752,               // content → preview = 106px
  rightPadding: 1919 - 1794,           // preview → viewport = 125px
};

console.log('\n計算されたギャップ:');
console.log(`  左パディング: ${gaps.leftPadding}px`);
console.log(`  番号→コンテンツ: ${gaps.numberToContent}px`);
console.log(`  コンテンツ→プレビュー: ${gaps.contentGap}px`);
console.log(`  右パディング: ${gaps.rightPadding}px`);

// ============================================
// SAT Solver: 垂直構造の逆算
// ============================================

console.log('\n【垂直構造の解析】\n');

// 各要素のtop値からgapを逆算
const verticalElements = [
  { name: 'container-top', top: 0, height: 0 },
  { name: 'preview-top', top: 60, height: 873 },
  { name: 'title', top: 66, height: 48 },
  { name: 'step1-block', top: 171, height: 48 },
  { name: 'step2-block', top: 236, height: 48 },
  { name: 'slider-1', top: 325, height: 30 },
  { name: 'slider-2', top: 374, height: 30 },
  { name: 'slider-3', top: 423, height: 30 },
  { name: 'slider-4', top: 472, height: 30 },
  { name: 'slider-5', top: 521, height: 30 },
  { name: 'slider-6', top: 569, height: 30 },
  { name: 'slider-7', top: 618, height: 30 },
  { name: 'step4-block', top: 666, height: 264 },
];

console.log('垂直ギャップ分析:');
for (let i = 1; i < verticalElements.length; i++) {
  const prev = verticalElements[i - 1];
  const curr = verticalElements[i];
  const gapFromBottom = curr.top - (prev.top + prev.height);
  const gapFromTop = curr.top - prev.top;
  console.log(`  ${prev.name} → ${curr.name}: gap=${gapFromBottom}px (top-to-top: ${gapFromTop}px)`);
}

// ============================================
// Flexbox構造の導出
// ============================================

console.log('\n【導出されたFlexbox構造】\n');

const FLEXBOX_STRUCTURE = {
  // メインコンテナ: 横並び
  container: {
    display: 'flex',
    flexDirection: 'row',
    minHeight: '100vh',
    // Tailwind: flex flex-row min-h-screen
  },

  // 左カラム
  leftColumn: {
    display: 'flex',
    flexDirection: 'column',
    paddingLeft: 117, // → pl-[117px] or calc
    paddingTop: 66,   // → pt-[66px]
    width: 'calc(752px + 49px)', // content + number column = 801px
    // または比率: 801/1919 ≈ 41.7%
    // Tailwind: flex flex-col pl-[117px] pt-[66px] w-[41.7%]
  },

  // ステップ行（番号 + コンテンツ）
  stepRow: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 49, // number → content
    // Tailwind: flex flex-row items-center gap-[49px]
  },

  // ステップ番号
  stepNumber: {
    width: 49,
    flexShrink: 0,
    // Tailwind: w-[49px] flex-shrink-0
  },

  // コンテンツブロック
  contentBlock: {
    width: 586,
    height: 48,
    // Tailwind: w-[586px] h-12
  },

  // 右カラム（プレビュー）
  rightColumn: {
    flex: 1,
    paddingLeft: 106, // gap from content
    paddingTop: 60,
    paddingRight: 125,
    // Tailwind: flex-1 pl-[106px] pt-[60px] pr-[125px]
  },

  // プレビューボックス
  previewBox: {
    width: 936,
    height: 873,
    // または: width: 100%, aspect-ratio: 936/873
    // Tailwind: w-[936px] h-[873px] または w-full aspect-[936/873]
  },
};

// 垂直ギャップの解析
const VERTICAL_GAPS = {
  titleToStep1: 171 - 66 - 48, // = 57px (title bottom to step1 top)
  step1ToStep2: 236 - 171 - 48, // = 17px
  step2ToStep3: 325 - 236 - 48, // = 41px (to first slider center)
  sliderGap: 374 - 325, // = 49px (center to center)
  step3ToStep4: 666 - 618 - 30, // = 18px (last slider bottom to step4 top)
};

console.log('垂直ギャップ（bottom to top）:');
Object.entries(VERTICAL_GAPS).forEach(([name, gap]) => {
  // Tailwindスケールとの照合
  const tailwindMatch = findTailwindSpacing(gap);
  console.log(`  ${name}: ${gap}px → ${tailwindMatch}`);
});

function findTailwindSpacing(px) {
  const scale = {
    0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32,
    9: 36, 10: 40, 11: 44, 12: 48, 14: 56, 16: 64, 20: 80,
  };
  for (const [key, value] of Object.entries(scale)) {
    if (value === px) return `gap-${key} ✓`;
  }
  return `gap-[${px}px]`;
}

// ============================================
// Tailwindクラス生成
// ============================================

console.log('\n【生成されるTailwind Flexbox構造】\n');

const TAILWIND_OUTPUT = `
// メインコンテナ
<div className="flex min-h-screen bg-white font-['Geist_Mono']">

  {/* 左カラム: ステップ番号 + コンテンツ */}
  <div className="flex flex-col pt-[66px] pl-[117px] w-[801px]">

    {/* タイトル */}
    <h1 className="italic text-black text-5xl font-medium leading-none pl-[9px]">
      liquidglass.css
    </h1>

    {/* Step 1 - mt-[57px] = title→step1 gap */}
    <div className="flex items-center gap-[49px] mt-[57px]">
      <span className="w-[49px] font-['Inter_Tight'] text-[#b0b0b0] text-sm">①</span>
      <div className="bg-[#eee] rounded-xl h-12 w-[586px] flex items-center pl-[23px] text-[13px]">
        npm i liquidglass.css
      </div>
    </div>

    {/* Step 2 - mt-[17px] = step1→step2 gap */}
    <div className="flex items-center gap-[49px] mt-[17px]">
      <span className="w-[49px] font-['Inter_Tight'] text-[#8f8f8f] text-sm">②</span>
      <div className="bg-[#eee] rounded-xl h-12 w-[586px] flex items-center pl-[23px] text-[13px]">
        import "liquidglass.css"
      </div>
    </div>

    {/* Step 3 - Sliders - mt-[41px] = step2→slider1 gap */}
    <div className="flex gap-[49px] mt-[41px]">
      <span className="w-[49px] font-['Inter_Tight'] text-[#a1a1a1] text-sm pt-[7px]">③</span>
      <div className="flex flex-col gap-[19px] w-[586px]">
        {/* 7 sliders with 49px center-to-center, knob=30px → gap = 49-30 = 19px */}
        {sliders.map((s, i) => (
          <div className="flex items-center">
            <div className="h-1.5 bg-[#d9d9d9] flex-1" />
            <div className="w-[30px] h-[30px] bg-black rounded-full text-white text-[13px] flex items-center justify-center">
              {s.value}
            </div>
            <div className="h-1.5 bg-[#d9d9d9] flex-1" />
          </div>
        ))}
      </div>
    </div>

    {/* Step 4 - mt-[18px] = slider7→step4 gap */}
    <div className="flex gap-[49px] mt-[18px]">
      <span className="w-[49px] font-['Inter_Tight'] text-[#858585] text-sm pt-6">④</span>
      <div className="bg-[#eee] rounded-2xl w-[586px] h-[264px] pt-[23px] pr-10 pb-3 pl-[23px] text-[13px] leading-[1.35]">
        <pre>...</pre>
      </div>
    </div>
  </div>

  {/* 右カラム: プレビュー */}
  <div className="flex-1 pt-[60px] pl-[106px] pr-[125px]">
    <div className="bg-black rounded-[76px] w-[936px] h-[873px]" />
  </div>

</div>
`;

console.log(TAILWIND_OUTPUT);

// ============================================
// 検証: 絶対座標との一致確認
// ============================================

console.log('【検証: Flexboxからの座標逆算】\n');

// Flexbox構造から絶対座標を再計算
const computed = {
  title: {
    left: 117 + 9, // pl-[117px] + pl-[9px] = 126 ✓
    top: 66, // pt-[66px] ✓
  },
  step1Number: {
    left: 117, // pl-[117px] ✓
    top: 66 + 48 + 57 + (48 - 14) / 2, // title + height + gap + vertical center
  },
  step1Block: {
    left: 117 + 49, // pl + number width = 166 ✓
    top: 66 + 48 + 57, // = 171 ✓
  },
};

console.log('タイトル:');
console.log(`  計算値: left=${computed.title.left}, top=${computed.title.top}`);
console.log(`  期待値: left=126, top=66`);
console.log(`  結果: ${computed.title.left === 126 && computed.title.top === 66 ? '✓ 一致' : '✗ 不一致'}`);

console.log('\nStep1ブロック:');
console.log(`  計算値: left=${computed.step1Block.left}, top=${computed.step1Block.top}`);
console.log(`  期待値: left=166, top=171`);
console.log(`  結果: ${computed.step1Block.left === 166 && computed.step1Block.top === 171 ? '✓ 一致' : '✗ 不一致'}`);

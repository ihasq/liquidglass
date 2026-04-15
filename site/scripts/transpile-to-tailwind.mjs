/**
 * CSS → Tailwind 誤差なしトランスパイラ
 *
 * 原則:
 * 1. 完全一致があれば使用
 * 2. なければ arbitrary value [Xpx] で正確に保持
 * 3. 丸めは許可しない
 */

// Tailwindスケール（完全一致のみ使用）
const SPACING = {
  0: '0', 1: 'px', 2: '0.5', 4: '1', 6: '1.5', 8: '2', 10: '2.5',
  12: '3', 14: '3.5', 16: '4', 20: '5', 24: '6', 28: '7', 32: '8',
  36: '9', 40: '10', 44: '11', 48: '12', 56: '14', 64: '16', 80: '20',
  96: '24', 112: '28', 128: '32', 144: '36', 160: '40', 176: '44',
  192: '48', 208: '52', 224: '56', 240: '60', 256: '64', 288: '72',
  320: '80', 384: '96',
};

const FONT_SIZE = {
  12: 'xs', 14: 'sm', 16: 'base', 18: 'lg', 20: 'xl',
  24: '2xl', 30: '3xl', 36: '4xl', 48: '5xl', 60: '6xl',
  72: '7xl', 96: '8xl', 128: '9xl',
};

const BORDER_RADIUS = {
  0: 'none', 2: 'sm', 4: 'DEFAULT', 6: 'md', 8: 'lg',
  12: 'xl', 16: '2xl', 24: '3xl', 9999: 'full',
};

const FONT_WEIGHT = {
  100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal',
  500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black',
};

// トランスパイル関数
function transpile(value, type) {
  let scale;
  let prefix;

  switch (type) {
    case 'spacing':
      scale = SPACING;
      prefix = '';
      break;
    case 'fontSize':
      scale = FONT_SIZE;
      prefix = 'text-';
      break;
    case 'borderRadius':
      scale = BORDER_RADIUS;
      prefix = 'rounded-';
      break;
    case 'fontWeight':
      scale = FONT_WEIGHT;
      prefix = 'font-';
      break;
    default:
      return `[${value}px]`;
  }

  // 完全一致を探す
  if (scale[value] !== undefined) {
    const key = scale[value];
    return { exact: true, class: `${prefix}${key}`, value };
  }

  // arbitrary value
  return { exact: false, class: `[${value}px]`, value };
}

// 現在のレイアウト値
const CURRENT_STYLES = {
  // Container
  container: { width: 1919, height: 997 },

  // Title
  title: { left: 126, top: 66, fontSize: 48, fontWeight: 500, lineHeight: 1.0 },

  // Step 1
  step1Number: { left: 117, top: 184, fontSize: 14 },
  step1Block: { left: 166, top: 171, width: 586, height: 48, paddingLeft: 23, fontSize: 13, borderRadius: 12 },
  step1Copy: { left: 720, top: 187, size: 14 },

  // Step 2
  step2Number: { left: 117, top: 250, fontSize: 14 },
  step2Block: { left: 166, top: 236, width: 586, height: 48, paddingLeft: 23, fontSize: 13, borderRadius: 12 },
  step2Copy: { left: 720, top: 252, size: 14 },

  // Step 3
  step3Number: { left: 121, top: 314, fontSize: 14 },
  sliderLine: { left: 167, height: 6, leftWidth: 275 },
  sliderKnob: { left: 445, size: 30, fontSize: 13 },
  sliderRightLine: { left: 477, width: 275 },
  sliderYPositions: [325, 374, 423, 472, 521, 569, 618],

  // Step 4
  step4Number: { left: 117, top: 682, fontSize: 14 },
  step4Block: {
    left: 166, top: 666, width: 586, height: 264,
    padding: { top: 23, right: 40, bottom: 12, left: 23 },
    fontSize: 13, lineHeight: 1.35, borderRadius: 16
  },
  step4Copy: { left: 720, top: 684, size: 14 },

  // Black Box
  blackBox: { left: 858, top: 60, width: 936, height: 873, borderRadius: 76 },
};

console.log('=== CSS → Tailwind 誤差なしトランスパイル ===\n');

// 各値をトランスパイル
const results = {};

function analyzeElement(name, styles) {
  console.log(`【${name}】`);
  const converted = {};

  for (const [prop, value] of Object.entries(styles)) {
    if (typeof value === 'object') {
      // ネストしたオブジェクト（padding等）
      converted[prop] = {};
      for (const [subProp, subValue] of Object.entries(value)) {
        const result = transpile(subValue, 'spacing');
        converted[prop][subProp] = result;
        console.log(`  ${prop}.${subProp}: ${subValue}px → ${result.class} ${result.exact ? '✓' : '(arbitrary)'}`);
      }
    } else if (Array.isArray(value)) {
      // 配列（sliderYPositions等）
      converted[prop] = value.map(v => {
        const result = transpile(v, 'spacing');
        return result;
      });
      console.log(`  ${prop}: [${value.join(', ')}]`);
    } else {
      // 単一値
      let type = 'spacing';
      if (prop === 'fontSize') type = 'fontSize';
      if (prop === 'borderRadius') type = 'borderRadius';
      if (prop === 'fontWeight') type = 'fontWeight';
      if (prop === 'lineHeight') {
        converted[prop] = { exact: true, class: `leading-${value === 1.0 ? 'none' : '[' + value + ']'}`, value };
        console.log(`  ${prop}: ${value} → leading-${value === 1.0 ? 'none' : '[' + value + ']'} ✓`);
        continue;
      }

      const result = transpile(value, type);
      converted[prop] = result;
      console.log(`  ${prop}: ${value}${typeof value === 'number' && type !== 'fontWeight' ? 'px' : ''} → ${result.class} ${result.exact ? '✓' : '(arbitrary)'}`);
    }
  }
  console.log();
  return converted;
}

results.title = analyzeElement('Title', CURRENT_STYLES.title);
results.step1Block = analyzeElement('Step 1 Block', CURRENT_STYLES.step1Block);
results.step4Block = analyzeElement('Step 4 Block', CURRENT_STYLES.step4Block);
results.blackBox = analyzeElement('Black Box', CURRENT_STYLES.blackBox);
results.sliderKnob = analyzeElement('Slider Knob', CURRENT_STYLES.sliderKnob);

// サマリー
console.log('=== トランスパイル結果サマリー ===\n');

let exactCount = 0;
let arbitraryCount = 0;

function countResults(obj) {
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null) {
      if (value.exact !== undefined) {
        if (value.exact) exactCount++;
        else arbitraryCount++;
      } else {
        countResults(value);
      }
    }
  }
}

countResults(results);

console.log(`完全一致: ${exactCount}件`);
console.log(`arbitrary values: ${arbitraryCount}件`);
console.log(`\n→ 全${exactCount + arbitraryCount}件を誤差なしで変換可能`);

// Tailwindコード生成
console.log('\n=== 生成されるTailwindクラス例 ===\n');

console.log('Title:');
console.log('  className="absolute italic text-black text-5xl font-medium leading-none"');
console.log('  style={{ left: 126, top: 66 }} // またはTailwind arbitrary: left-[126px] top-[66px]');
console.log();

console.log('Code Block:');
console.log('  className="absolute bg-[#eee] flex items-center rounded-xl h-12 pl-[23px] text-[13px]"');
console.log('  style={{ left: 166, top: 171, width: 586 }}');
console.log();

console.log('Black Box:');
console.log('  className="absolute bg-black rounded-[76px]"');
console.log('  style={{ left: 858, top: 60, width: 936, height: 873 }}');

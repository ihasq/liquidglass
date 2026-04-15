/**
 * Layout Specification - Mathematical Intent
 *
 * Derived from SAT solver analysis of pixel-perfect mockup
 */

const VIEWPORT = {
  reference: { width: 1919, height: 997 },
};

// ============================================
// Golden Ratio Layout Structure
// ============================================

const GOLDEN_RATIO = 1.618;

const LAYOUT_INTENT = {
  // Horizontal split follows golden ratio
  horizontal: {
    leftMarginPercent: 8.6,  // 166px / 1919px
    contentPercent: 30.5,    // 586px / 1919px
    gapPercent: 5.5,         // 106px / 1919px
    previewPercent: 48.8,    // 936px / 1919px
    rightMarginPercent: 6.6, // 126px / 1919px

    // Golden ratio verification
    ratio: 936 / 586, // = 1.597 ≈ φ (1.618)
  },

  // Vertical rhythm
  vertical: {
    baseUnit: 48, // h-12 in Tailwind
    sliderGap: 49, // ~= baseUnit
    titleToStep1: 105, // ~= 2 * baseUnit + 9
    stepToStep: 65, // between code blocks

    // Positions from top
    titleY: 66,
    step1Y: 171,
    step2Y: 236,
    step3StartY: 325,
    step3EndY: 618,
    step4Y: 666,
  },
};

// ============================================
// Component Specifications
// ============================================

const COMPONENTS = {
  title: {
    font: 'Geist Mono',
    weight: 500, // medium
    size: 48, // text-5xl
    lineHeight: 1.0, // leading-none
    style: 'italic',
    color: '#000000',
  },

  stepNumber: {
    font: 'Inter Tight',
    size: 14, // text-sm
    colors: ['#b0b0b0', '#8f8f8f', '#a1a1a1', '#858585'],
  },

  codeBlock: {
    background: '#eeeeee',
    borderRadius: 12, // rounded-xl
    height: 48, // h-12
    paddingLeft: 23,
    fontSize: 13,
    maxWidth: 586,
  },

  step4Block: {
    background: '#eeeeee',
    borderRadius: 16, // rounded-2xl
    padding: { top: 23, right: 40, bottom: 12, left: 23 },
    fontSize: 13,
    lineHeight: 1.35,
    maxWidth: 586,
    height: 264,
  },

  slider: {
    lineHeight: 6, // h-1.5
    lineColor: '#d9d9d9',
    knobSize: 30,
    knobBackground: '#000000',
    knobTextColor: '#ffffff',
    knobFontSize: 13,
  },

  previewBox: {
    background: '#000000',
    borderRadius: 76, // rounded-[76px]
    aspectRatio: 936 / 873, // ~1.072
    maxWidth: 936,
  },

  copyIcon: {
    size: 14,
    strokeWidth: 1.5,
  },
};

// ============================================
// Tailwind Class Mappings
// ============================================

const TAILWIND_MAPPINGS = {
  // Exact matches (no arbitrary values needed)
  exact: {
    'h-12': 48,
    'text-5xl': 48,
    'font-medium': 500,
    'leading-none': 1.0,
    'rounded-xl': 12,
    'rounded-2xl': 16,
    'h-1.5': 6,
    'text-sm': 14,
    'pr-10': 40,
    'pb-3': 12,
  },

  // Arbitrary values (CSS → Tailwind)
  arbitrary: {
    'left-[126px]': 126,
    'left-[166px]': 166,
    'w-[586px]': 586,
    'rounded-[76px]': 76,
    'pl-[23px]': 23,
    'pt-[23px]': 23,
    'text-[13px]': 13,
    'leading-[1.35]': 1.35,
  },

  // Responsive conversions (px → %)
  responsive: {
    'w-[38.2%]': 'content area (golden ratio)',
    'pl-[8.6%]': 'left margin',
    'max-w-[586px]': 'code block max width',
    'max-w-[936px]': 'preview max width',
  },
};

// ============================================
// Responsive Breakpoints
// ============================================

const BREAKPOINTS = {
  // Mobile: stack vertically
  sm: {
    layout: 'flex-col',
    contentWidth: '100%',
    previewWidth: '100%',
  },

  // Tablet: side by side, smaller preview
  md: {
    layout: 'flex-row',
    contentWidth: '50%',
    previewWidth: '50%',
  },

  // Desktop: golden ratio
  lg: {
    layout: 'flex-row',
    contentWidth: '38.2%',
    previewWidth: '61.8%',
  },
};

// ============================================
// Export for documentation
// ============================================

console.log('=== Layout Specification ===\n');
console.log('Golden Ratio Verification:');
console.log(`  Content:Preview = 586:936 = 1:${(936/586).toFixed(3)}`);
console.log(`  Golden ratio φ = 1:${GOLDEN_RATIO}`);
console.log(`  Deviation: ${(((936/586) - GOLDEN_RATIO) / GOLDEN_RATIO * 100).toFixed(2)}%`);
console.log();

console.log('Tailwind Exact Matches:');
Object.entries(TAILWIND_MAPPINGS.exact).forEach(([tw, px]) => {
  console.log(`  ${tw} = ${px}px`);
});
console.log();

console.log('Responsive Strategy:');
console.log('  sm: Stack vertically');
console.log('  md: 50/50 split');
console.log('  lg+: Golden ratio (38.2% / 61.8%)');

export { VIEWPORT, LAYOUT_INTENT, COMPONENTS, TAILWIND_MAPPINGS, BREAKPOINTS };

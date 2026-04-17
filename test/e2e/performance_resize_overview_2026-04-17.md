# Liquid Glass - Resize Performance Analysis Report

**Date**: 2026-04-17
**Target**: `/demo/parameter-lab.html`
**Method**: CDP (Chrome DevTools Protocol) via Puppeteer
**Test**: Controlled resize (10 steps, 100ms intervals)

---

## Executive Summary

Total resize duration: **2170ms** for 10 resize steps
Tracked operations: **8ms (0.4%)**
Untracked (idle/wait): **2162ms (99.6%)**

The actual render operations (toDataURL, _render, etc.) are extremely fast. The majority of time is spent in browser idle states, setTimeout waits, and CSS Property Engine overhead.

---

## CPU Profile Hot Spots

| Rank | Function | CPU Samples | Location |
|------|----------|-------------|----------|
| 1 | (idle) | 10749 | - |
| 2 | (program) | 609 | - |
| 3 | **`_extractSelectorsFromText`** | 167 | css-property-engine.ts:409 |
| 4 | `generateSpecularMap` | 47 | highlight.ts:12 |
| 5 | (garbage collector) | 47 | - |
| 6 | `_render` | 46 | filter-manager.ts:497 |
| 7 | `getBoundingClientRect` | 36 | - |
| 8 | `console.log` | 35 | - |
| 9 | `animateBackground` | 33 | parameter-lab.html |
| 10 | `toDataURL` | 25 | - |
| 11 | `setAttribute` | 25 | - |
| 12 | `getPropertyValue` | 18 | - |
| 13 | `compositeQuadrantToFull` | 15 | quad-wasm-generator.ts:58 |

---

## Render Pipeline Events

| Phase | Count | Total (ms) | Avg (ms) |
|-------|-------|------------|----------|
| toDataURL | 29 | 6.10 | 0.21 |
| putImageData | 29 | 1.70 | 0.06 |
| setTimeout.exec | 10 | 0.00 | 0.00 |

---

## toDataURL Detailed Analysis

| Canvas Size | Count | Duration (ms) | Avg Data (KB) |
|-------------|-------|---------------|---------------|
| 68x43 | 3 | 0.90 | 0.9 |
| 72x46 | 3 | 0.60 | 1.0 |
| 76x49 | 3 | 0.10 | 1.1 |
| 80x52 | 3 | 0.50 | 1.1 |
| 84x55 | 3 | 0.50 | 1.2 |
| 88x58 | 3 | 0.50 | 1.2 |
| 92x61 | 3 | 0.60 | 1.3 |
| 96x64 | 3 | 0.70 | 1.4 |
| 100x67 | 3 | 0.60 | 1.5 |
| 225x151 | 2 | 1.10 | 3.7 |

**Total**: 29 calls, 6.10ms, 39.1 KB

---

## Deferred Render Analysis (setTimeout)

### 50ms Delay (9 calls)
- **Source**: `FilterManager._renderWithRefreshRate`
- **Purpose**: Throttling render rate during active resize

### 300ms Delay (1 call)
- **Source**: `FilterManager._scheduleHighResRender`
- **Purpose**: Deferred high-resolution render after resize ends

---

## Critical Findings

### 1. CSS Property Engine Overhead (167 CPU samples)

**Hot Function**: `_extractSelectorsFromText` at `css-property-engine.ts:659`

```typescript
private _extractSelectorsFromText(text: string, selectors: string[]): void {
  if (!this._selectorExtractPattern) return;
  this._selectorExtractPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = this._selectorExtractPattern.exec(text)) !== null) {
    const selectorPart = match[1].trim();
    const parts = selectorPart.split(',');
    for (const part of parts) {
      const selector = part.trim();
      if (selector && !this._hasDynamicPseudoClass(selector)) {
        selectors.push(selector);
      }
    }
  }
}
```

**Trigger Chain**:
1. Resize causes element style changes
2. `MutationObserver` detects attribute changes (`style`, `class`)
3. `_scheduleScan()` is called
4. `_extractSelectorsFromText()` parses entire CSS text with regex

**Impact**: Each resize step triggers CSS text re-parsing, consuming significant CPU time.

---

### 2. Morph Animation Collision

Debug log shows rapid start/cancel cycles during resize:

```
[Morph] Morph animation STARTED
[Morph] Previous morph animation CANCELLED
[Morph] Morph animation STARTED
[Morph] Previous morph animation CANCELLED
...
```

Each resize step starts a new morph transition, immediately cancelling the previous one.

---

### 3. Time Budget Analysis

For 10 resize steps at 60fps:
- **Frame budget**: 167ms (10 frames x 16.67ms)
- **Actual duration**: 2170ms
- **Budget ratio**: 1299%

---

## Bottleneck Hierarchy

```
Level 1: Browser Wait Time (99.6% of total)
├── RAF/Paint/Composite scheduling
├── setTimeout waits (50ms x 9 = 450ms, 300ms x 1)
└── Async operation gaps

Level 2: CSS Property Engine (167 CPU samples)
├── _extractSelectorsFromText: regex parsing on every scan
├── MutationObserver active during resize
└── _scheduleScan triggered by style attribute changes

Level 3: Actual Render Operations (8ms total)
├── toDataURL: 6.1ms (29 calls, avg 0.21ms)
├── putImageData: 1.7ms (29 calls, avg 0.06ms)
├── generateSpecularMap: minimal
└── _render: minimal per call
```

---

## Debug Log Timeline (Sample)

```
[2825ms] [LiquidGlass] All log categories ENABLED
[3002ms] [Throttle] RefreshRate - rendering frame
[3003ms] [Prediction] Size history updated
[3004ms] [Prediction] Prediction SKIPPED (low-res preview mode)
[3004ms] [Progressive] Rendering at LOW resolution
[3005ms] [Progressive] Displacement map generated with WASM-SIMD
[3008ms] [Morph] Fast update eligibility check
[3008ms] [Morph] Starting MORPH transition
[3009ms] [Morph] Morph animation STARTED
[3009ms] [Interval] Adaptive interval calculated
[3009ms] [Interval] Adaptive interval UPDATED
[3010ms] [Throttle] RefreshRate - rendering frame
[3013ms] [Morph] Previous morph animation CANCELLED
[3061ms] [Progressive] High-res render SCHEDULED
[3119ms] [Progressive] High-res render cancelled (resize active)
```

---

## Optimization Recommendations

### High Priority

1. **CSS Property Engine**
   - Cache selector extraction results
   - Skip `_scheduleScan` during active resize
   - Increase `_minCheckInterval` during resize

2. **Morph Transitions**
   - Skip morph during active resize
   - Debounce transition starts
   - Coalesce rapid parameter changes

### Medium Priority

3. **setTimeout Optimization**
   - 50ms intervals are intentional throttling (acceptable)
   - 300ms high-res delay is correct behavior

4. **MutationObserver**
   - Temporarily disconnect during known resize operations
   - Re-observe after resize ends

### Low Priority (Already Optimized)

5. **toDataURL Performance**
   - Current: 0.21ms average per call
   - Already using low-resolution previews during resize
   - Canvas sizes are appropriately small (68x43 to 100x67)

---

## Test Environment

- **Browser**: Chromium (headless via Puppeteer)
- **Viewport**: 1400x900
- **Resize Pattern**: 10 steps, 20px horizontal / 15px vertical per step, 100ms intervals
- **Profiler**: CDP Profiler with 100us sampling interval
- **Async Stack Depth**: 32

---

## Files Analyzed

- `src/engines/css-property-engine.ts` - CSS property observation
- `src/core/filter/filter-manager.ts` - Core render pipeline
- `src/core/displacement/quad-wasm-generator.ts` - WASM displacement generation
- `src/drivers/css-properties/index.ts` - CSS properties driver

---

## Scripts Used

| Script | Purpose |
|--------|---------|
| `scripts/cdp-resize-analysis.mjs` | Main resize performance analysis |
| `scripts/cdp-detailed-stacktrace.mjs` | Function-level timing breakdown |
| `scripts/cdp-async-analysis.mjs` | Async flow and render pipeline analysis |

---

*Generated by CDP Performance Analysis*

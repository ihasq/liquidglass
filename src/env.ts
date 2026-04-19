/**
 * Development mode detection
 *
 * This module provides a global `__DEV__` flag that is:
 * - `true` in development (Vite dev server, unbundled imports)
 * - `false` in production builds (replaced by Vite define, then dead-code eliminated)
 *
 * Usage:
 * ```typescript
 * import { __DEV__ } from './env';
 *
 * if (__DEV__) {
 *   console.log('Debug info:', data);
 * }
 * ```
 *
 * In production builds, the entire `if (__DEV__) { ... }` block is removed
 * by the minifier (dead code elimination).
 *
 * Pattern inspired by Lit's development mode detection.
 */

/**
 * Development mode flag.
 *
 * This value is replaced at build time:
 * - Development: `true` (enables debug logs, warnings, validation)
 * - Production: `false` (all debug code stripped)
 *
 * The expression uses a pattern that:
 * 1. Can be statically replaced by bundlers (Vite/Rollup define)
 * 2. Falls back to runtime detection for unbundled usage
 * 3. Supports tree-shaking when `false`
 */
export const __DEV__: boolean =
  // This will be replaced by Vite's define option in production builds
  // In development, it evaluates to true via the fallback
  (globalThis as { __LIQUIDGLASS_DEV__?: boolean }).__LIQUIDGLASS_DEV__ ??
  (
    // Fallback: check if running in a development-like environment
    (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') ||
    // Vite dev server detection
    (typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true) ||
    // Default to true if we can't determine (safer for debugging)
    true
  );

/**
 * Library version (injected at build time)
 */
export const __VERSION__: string =
  (globalThis as { __LIQUIDGLASS_VERSION__?: string }).__LIQUIDGLASS_VERSION__ ?? '0.0.0-dev';

// =============================================================================
// DEBUG LOG CONTROL SYSTEM
// =============================================================================

/**
 * Log categories that can be individually enabled/disabled
 */
export type LogCategory = 'throttle' | 'prediction' | 'morph' | 'progressive' | 'interval';

/**
 * Interface for a single log category controller
 */
export interface LogCategoryController {
  /** Enable logging for this category */
  enable(): void;
  /** Disable logging for this category */
  disable(): void;
  /** Check if logging is enabled for this category */
  isEnabled(): boolean;
}

/**
 * Interface for the debug log controller
 */
export interface DebugLogController {
  throttle: LogCategoryController;
  prediction: LogCategoryController;
  morph: LogCategoryController;
  progressive: LogCategoryController;
  interval: LogCategoryController;
  /** Enable all log categories */
  enableAll(): void;
  /** Disable all log categories */
  disableAll(): void;
  /** Get status of all categories */
  status(): Record<LogCategory, boolean>;
}

/**
 * Interface for the development-only debug API
 */
export interface LiquidGlassDevAPI {
  debug: {
    log: DebugLogController;
  };
  version: string;
}

// Internal state for log category enablement (default: all OFF)
const _logState: Record<LogCategory, boolean> = {
  throttle: false,
  prediction: false,
  morph: false,
  progressive: false,
  interval: false,
};

/**
 * Check if a log category is enabled
 * @internal
 */
export function isLogEnabled(category: LogCategory): boolean {
  return __DEV__ && _logState[category];
}

/**
 * Create a controller for a single log category
 */
function createCategoryController(category: LogCategory): LogCategoryController {
  return {
    enable() {
      _logState[category] = true;
      console.log(`[LiquidGlass] Log category "${category}" ENABLED`);
    },
    disable() {
      _logState[category] = false;
      console.log(`[LiquidGlass] Log category "${category}" DISABLED`);
    },
    isEnabled() {
      return _logState[category];
    },
  };
}

/**
 * Create the debug log controller
 */
function createDebugLogController(): DebugLogController {
  return {
    throttle: createCategoryController('throttle'),
    prediction: createCategoryController('prediction'),
    morph: createCategoryController('morph'),
    progressive: createCategoryController('progressive'),
    interval: createCategoryController('interval'),
    enableAll() {
      for (const category of Object.keys(_logState) as LogCategory[]) {
        _logState[category] = true;
      }
      console.log('[LiquidGlass] All log categories ENABLED');
    },
    disableAll() {
      for (const category of Object.keys(_logState) as LogCategory[]) {
        _logState[category] = false;
      }
      console.log('[LiquidGlass] All log categories DISABLED');
    },
    status() {
      return { ..._logState };
    },
  };
}

/**
 * Development-only debug API
 *
 * Available in browser console as `lgc_dev`:
 *
 * ```js
 * // Enable specific category
 * lgc_dev.debug.log.throttle.enable()
 * lgc_dev.debug.log.prediction.enable()
 *
 * // Disable specific category
 * lgc_dev.debug.log.throttle.disable()
 *
 * // Enable/disable all
 * lgc_dev.debug.log.enableAll()
 * lgc_dev.debug.log.disableAll()
 *
 * // Check status
 * lgc_dev.debug.log.status()
 * lgc_dev.debug.log.throttle.isEnabled()
 *
 * // Version info
 * lgc_dev.version
 * ```
 */
export const lgc_dev: LiquidGlassDevAPIWithProfiler | undefined = __DEV__
  ? {
      debug: {
        log: createDebugLogController(),
      },
      profiler: createPerformanceProfiler(),
      version: __VERSION__,
    }
  : undefined;

// Expose to global scope in development
if (__DEV__) {
  (globalThis as { lgc_dev?: LiquidGlassDevAPIWithProfiler }).lgc_dev = lgc_dev;
}

// =============================================================================
// PERFORMANCE PROFILING SYSTEM
// =============================================================================

/**
 * Rendering step names for performance profiling
 */
export type RenderStep =
  | 'getBounds'
  | 'getStyle'
  | 'prediction'
  | 'displacementMap'
  | 'specularMap'
  | 'svgUpdate'
  | 'morph';

/**
 * Single frame timing data
 */
export interface FrameTiming {
  frameId: number;
  timestamp: number;
  totalMs: number;
  steps: Record<RenderStep, number>;
}

/**
 * Performance profiler controller interface
 */
export interface PerformanceProfiler {
  /** Enable profiling */
  enable(): void;
  /** Disable profiling */
  disable(): void;
  /** Check if profiling is enabled */
  isEnabled(): boolean;
  /** Get recent frame timings (last N frames) */
  getFrames(count?: number): FrameTiming[];
  /** Get average step durations across recent frames */
  getAverages(frameCount?: number): Record<RenderStep, number>;
  /** Clear all recorded data */
  clear(): void;
  /** Subscribe to frame updates */
  subscribe(callback: (frame: FrameTiming) => void): () => void;
}

// Internal profiler state
const _profilerState = {
  enabled: false,
  frameId: 0,
  currentFrame: null as { startTime: number; steps: Partial<Record<RenderStep, number>> } | null,
  frames: [] as FrameTiming[],
  maxFrames: 120,  // Keep last 120 frames (~2 seconds at 60fps)
  subscribers: new Set<(frame: FrameTiming) => void>(),
};

/**
 * Start a new frame measurement
 * @internal
 */
export function _profilerStartFrame(): void {
  if (!_profilerState.enabled) return;
  _profilerState.currentFrame = {
    startTime: performance.now(),
    steps: {},
  };
}

/**
 * Mark the start of a render step
 * @internal
 */
export function _profilerMarkStep(step: RenderStep): void {
  if (!_profilerState.enabled || !_profilerState.currentFrame) return;
  performance.mark(`lgc-${step}-start`);
}

/**
 * Mark the end of a render step and record duration
 * @internal
 */
export function _profilerEndStep(step: RenderStep): void {
  if (!_profilerState.enabled || !_profilerState.currentFrame) return;

  const endMark = `lgc-${step}-end`;
  const startMark = `lgc-${step}-start`;

  performance.mark(endMark);

  try {
    const measure = performance.measure(`lgc-${step}`, startMark, endMark);
    _profilerState.currentFrame.steps[step] = measure.duration;
  } catch {
    // Marks may not exist if step was skipped
  }

  // Clean up marks
  performance.clearMarks(startMark);
  performance.clearMarks(endMark);
  performance.clearMeasures(`lgc-${step}`);
}

/**
 * End the current frame measurement
 * @internal
 */
export function _profilerEndFrame(): void {
  if (!_profilerState.enabled || !_profilerState.currentFrame) return;

  const frame = _profilerState.currentFrame;
  const totalMs = performance.now() - frame.startTime;

  // Fill in missing steps with 0
  const steps: Record<RenderStep, number> = {
    getBounds: frame.steps.getBounds ?? 0,
    getStyle: frame.steps.getStyle ?? 0,
    prediction: frame.steps.prediction ?? 0,
    displacementMap: frame.steps.displacementMap ?? 0,
    specularMap: frame.steps.specularMap ?? 0,
    svgUpdate: frame.steps.svgUpdate ?? 0,
    morph: frame.steps.morph ?? 0,
  };

  const timing: FrameTiming = {
    frameId: _profilerState.frameId++,
    timestamp: Date.now(),
    totalMs,
    steps,
  };

  _profilerState.frames.push(timing);

  // Keep only last maxFrames
  while (_profilerState.frames.length > _profilerState.maxFrames) {
    _profilerState.frames.shift();
  }

  // Notify subscribers
  for (const cb of _profilerState.subscribers) {
    try {
      cb(timing);
    } catch (e) {
      console.error('[LiquidGlass] Profiler subscriber error:', e);
    }
  }

  _profilerState.currentFrame = null;
}

/**
 * Create the performance profiler controller
 */
function createPerformanceProfiler(): PerformanceProfiler {
  return {
    enable() {
      _profilerState.enabled = true;
      console.log('[LiquidGlass] Performance profiler ENABLED');
    },
    disable() {
      _profilerState.enabled = false;
      console.log('[LiquidGlass] Performance profiler DISABLED');
    },
    isEnabled() {
      return _profilerState.enabled;
    },
    getFrames(count = 60) {
      return _profilerState.frames.slice(-count);
    },
    getAverages(frameCount = 60) {
      const frames = _profilerState.frames.slice(-frameCount);
      if (frames.length === 0) {
        return {
          getBounds: 0,
          getStyle: 0,
          prediction: 0,
          displacementMap: 0,
          specularMap: 0,
          svgUpdate: 0,
          morph: 0,
        };
      }

      const sums: Record<RenderStep, number> = {
        getBounds: 0,
        getStyle: 0,
        prediction: 0,
        displacementMap: 0,
        specularMap: 0,
        svgUpdate: 0,
        morph: 0,
      };

      for (const frame of frames) {
        for (const step of Object.keys(sums) as RenderStep[]) {
          sums[step] += frame.steps[step];
        }
      }

      for (const step of Object.keys(sums) as RenderStep[]) {
        sums[step] /= frames.length;
      }

      return sums;
    },
    clear() {
      _profilerState.frames = [];
      _profilerState.frameId = 0;
      console.log('[LiquidGlass] Profiler data cleared');
    },
    subscribe(callback) {
      _profilerState.subscribers.add(callback);
      return () => {
        _profilerState.subscribers.delete(callback);
      };
    },
  };
}

// Add profiler to dev API
export interface LiquidGlassDevAPIWithProfiler extends LiquidGlassDevAPI {
  profiler: PerformanceProfiler;
}

/**
 * Production-ready performance profiler instance.
 * Unlike `lgc_dev.profiler`, this is always available regardless of build mode.
 *
 * Usage:
 * ```typescript
 * import { profiler } from 'liquidglass.css/env';
 *
 * profiler.enable();
 * const unsubscribe = profiler.subscribe((frame) => {
 *   console.log('Frame timing:', frame);
 * });
 * ```
 */
export const profiler: PerformanceProfiler = createPerformanceProfiler();

// Type augmentation for global scope
declare global {
  // eslint-disable-next-line no-var
  var __LIQUIDGLASS_DEV__: boolean | undefined;
  // eslint-disable-next-line no-var
  var __LIQUIDGLASS_VERSION__: string | undefined;
  // eslint-disable-next-line no-var
  var lgc_dev: LiquidGlassDevAPIWithProfiler | undefined;
}

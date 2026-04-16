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
export const lgc_dev: LiquidGlassDevAPI | undefined = __DEV__
  ? {
      debug: {
        log: createDebugLogController(),
      },
      version: __VERSION__,
    }
  : undefined;

// Expose to global scope in development
if (__DEV__) {
  (globalThis as { lgc_dev?: LiquidGlassDevAPI }).lgc_dev = lgc_dev;
}

// Type augmentation for global scope
declare global {
  // eslint-disable-next-line no-var
  var __LIQUIDGLASS_DEV__: boolean | undefined;
  // eslint-disable-next-line no-var
  var __LIQUIDGLASS_VERSION__: string | undefined;
  // eslint-disable-next-line no-var
  var lgc_dev: LiquidGlassDevAPI | undefined;
}

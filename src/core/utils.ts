/**
 * Core utilities for Liquid Glass
 *
 * Shared utilities used across FilterManager and Driver.
 */

import {
  __DEV__,
  isLogEnabled,
} from '../env';
import type { SizeSample, PredictedSize } from './types';

// =============================================================================
// DEBUG LOGGING UTILITIES
// =============================================================================

const LOG_PREFIX = '[LiquidGlass]';

type LogCategory = 'throttle' | 'prediction' | 'morph' | 'progressive' | 'interval';

const LOG_COLORS: Record<LogCategory, string> = {
  throttle: 'color: #f59e0b',    // amber
  prediction: 'color: #8b5cf6',  // purple
  morph: 'color: #06b6d4',       // cyan
  progressive: 'color: #10b981', // emerald
  interval: 'color: #ec4899',    // pink
};

/**
 * Create a category-scoped logger function.
 *
 * @param category - Log category name (must be enabled via lgc_dev.debug.log.<category>.enable())
 * @returns Logger function that only logs when __DEV__ and category is enabled
 */
export function createLogger(category: LogCategory): (message: string, data?: Record<string, unknown>) => void {
  const color = LOG_COLORS[category];
  const tag = `[${category.charAt(0).toUpperCase() + category.slice(1)}]`;

  return (message: string, data?: Record<string, unknown>): void => {
    if (__DEV__ && isLogEnabled(category)) {
      console.log(`%c${LOG_PREFIX} ${tag} ${message}`, color, data ?? '');
    }
  };
}

// Pre-created loggers for common categories
export const logThrottle = createLogger('throttle');
export const logPrediction = createLogger('prediction');
export const logMorph = createLogger('morph');
export const logProgressive = createLogger('progressive');
export const logInterval = createLogger('interval');

// =============================================================================
// SINGLETON DOM MANAGEMENT
// =============================================================================

let _svgRoot: SVGSVGElement | null = null;
let _styleSheet: CSSStyleSheet | null = null;

/**
 * Get or create the singleton SVG root element for filter definitions.
 * Automatically re-creates if the element was removed from DOM.
 */
export function getSvgRoot(): SVGSVGElement {
  if (_svgRoot && document.body.contains(_svgRoot)) {
    return _svgRoot;
  }

  _svgRoot = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  _svgRoot.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');
  _svgRoot.setAttribute('aria-hidden', 'true');

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  _svgRoot.appendChild(defs);

  document.body.appendChild(_svgRoot);
  return _svgRoot;
}

/**
 * Get or create the singleton stylesheet for liquid glass CSS rules.
 */
export function getStyleSheet(): CSSStyleSheet {
  if (_styleSheet) return _styleSheet;

  const style = document.createElement('style');
  style.setAttribute('data-liquid-glass', 'core');
  document.head.appendChild(style);
  _styleSheet = style.sheet!;
  return _styleSheet;
}

// =============================================================================
// FILTER ID GENERATION
// =============================================================================

/**
 * Generate a unique filter ID using crypto.getRandomValues.
 * Format: _lgXXXXXXXX (base36 encoded)
 */
export function generateFilterId(): string {
  const array = new Uint32Array(2);
  crypto.getRandomValues(array);
  return `_lg${array[0].toString(36)}${array[1].toString(36)}`;
}

// =============================================================================
// SIZE PREDICTION UTILITIES
// =============================================================================

// Prediction configuration
const PREDICTION_HISTORY_SIZE = 5;
const PREDICTION_HORIZON_BASE_MS = 100;
const PREDICTION_VARIANCE_K = 0.01;

/**
 * Calculate velocity vector from size history samples.
 *
 * @param history - Array of size samples with timestamps
 * @returns Velocity in px/sec for width, height, and radius
 */
export function calculateVelocity(history: SizeSample[]): { vw: number; vh: number; vr: number } {
  if (history.length < 2) return { vw: 0, vh: 0, vr: 0 };

  let vw = 0, vh = 0, vr = 0;
  let count = 0;

  for (let i = 1; i < history.length; i++) {
    const dt = (history[i].timestamp - history[i - 1].timestamp) / 1000;
    if (dt > 0 && dt < 1) {
      vw += (history[i].width - history[i - 1].width) / dt;
      vh += (history[i].height - history[i - 1].height) / dt;
      vr += (history[i].radius - history[i - 1].radius) / dt;
      count++;
    }
  }

  if (count === 0) return { vw: 0, vh: 0, vr: 0 };
  return { vw: vw / count, vh: vh / count, vr: vr / count };
}

/**
 * Predict future size based on velocity and variance-adjusted horizon.
 *
 * Algorithm:
 * 1. Calculate average velocity from history
 * 2. Calculate velocity variance for confidence
 * 3. Adaptive horizon: shorter for high-variance (unpredictable) motion
 * 4. Linear extrapolation: predicted = current + velocity × horizon
 *
 * @param history - Array of size samples
 * @returns Predicted size with confidence (0-1)
 */
export function predictSize(history: SizeSample[]): PredictedSize {
  if (history.length < 2) {
    const last = history[history.length - 1] || { width: 0, height: 0, radius: 0 };
    logPrediction('Insufficient history for prediction', {
      historyLength: history.length,
      fallback: { width: last.width, height: last.height, radius: last.radius },
    });
    return { width: last.width, height: last.height, radius: last.radius, confidence: 0 };
  }

  const { vw, vh, vr } = calculateVelocity(history);
  const last = history[history.length - 1];

  // Calculate velocity variance for confidence
  let varianceW = 0, varianceH = 0;
  for (let i = 1; i < history.length; i++) {
    const dt = (history[i].timestamp - history[i - 1].timestamp) / 1000;
    if (dt > 0 && dt < 1) {
      const instVw = (history[i].width - history[i - 1].width) / dt;
      const instVh = (history[i].height - history[i - 1].height) / dt;
      varianceW += (instVw - vw) ** 2;
      varianceH += (instVh - vh) ** 2;
    }
  }
  const avgVariance = (varianceW + varianceH) / (2 * (history.length - 1));

  // Adaptive horizon based on variance
  const horizon = PREDICTION_HORIZON_BASE_MS / (1 + PREDICTION_VARIANCE_K * avgVariance);
  const t = horizon / 1000;

  // Confidence based on history length and variance
  const historyConfidence = Math.min(history.length / PREDICTION_HISTORY_SIZE, 1);
  const varianceConfidence = 1 / (1 + avgVariance * 0.001);
  const confidence = historyConfidence * varianceConfidence;

  const predicted = {
    width: Math.max(1, Math.round(last.width + vw * t)),
    height: Math.max(1, Math.round(last.height + vh * t)),
    radius: Math.max(0, last.radius + vr * t),
    confidence,
  };

  logPrediction('Size prediction calculated', {
    velocity: { vw: vw.toFixed(1), vh: vh.toFixed(1), vr: vr.toFixed(2) },
    variance: avgVariance.toFixed(2),
    horizon: `${horizon.toFixed(1)}ms`,
    confidence: `${(confidence * 100).toFixed(1)}%`,
    current: { w: last.width, h: last.height, r: last.radius.toFixed(1) },
    predicted: { w: predicted.width, h: predicted.height, r: predicted.radius.toFixed(1) },
    delta: {
      w: predicted.width - last.width,
      h: predicted.height - last.height,
      r: (predicted.radius - last.radius).toFixed(1),
    },
  });

  return predicted;
}

/**
 * Calculate adaptive throttle interval based on render context.
 *
 * Formula:
 *   areaScore = min(area / 480000, 1)           // Normalized to 800×600
 *   changeScore = min(changeRatio / 0.3, 1)     // Normalized to 30% change
 *   priority = areaScore × 0.6 + changeScore × 0.4
 *   countPenalty = min(elementCount - 1, 5) × 50  // Max 250ms
 *   baseInterval = minInterval + countPenalty
 *   result = baseInterval + (1 - priority) × (maxInterval - baseInterval)
 *
 * @param area - Element area in pixels
 * @param changeRatio - Size change ratio (0-1)
 * @param elementCount - Number of tracked elements
 * @param minInterval - Minimum interval in ms
 * @param maxInterval - Maximum interval in ms
 * @returns Computed interval in ms
 */
export function getAdaptiveInterval(
  area: number,
  changeRatio: number,
  elementCount: number,
  minInterval: number,
  maxInterval: number
): number {
  const areaScore = Math.min(area / (800 * 600), 1);
  const changeScore = Math.min(changeRatio / 0.3, 1);
  const priority = areaScore * 0.6 + changeScore * 0.4;
  const countPenalty = Math.min(elementCount - 1, 5) * 50;
  const baseInterval = minInterval + countPenalty;
  const result = Math.round(baseInterval + (1 - priority) * (maxInterval - baseInterval));

  logInterval('Adaptive interval calculated', {
    input: {
      area: `${(area / 1000).toFixed(1)}k px²`,
      changeRatio: `${(changeRatio * 100).toFixed(1)}%`,
      elementCount,
    },
    scores: {
      areaScore: `${(areaScore * 100).toFixed(1)}%`,
      changeScore: `${(changeScore * 100).toFixed(1)}%`,
      priority: `${(priority * 100).toFixed(1)}%`,
    },
    penalty: `${countPenalty}ms (${elementCount} elements)`,
    baseInterval: `${baseInterval}ms`,
    result: `${result}ms`,
  });

  return result;
}

// Export prediction constants for testing/configuration
export { PREDICTION_HISTORY_SIZE };

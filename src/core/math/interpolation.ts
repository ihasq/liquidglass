/**
 * Interpolation and blending functions
 */

/**
 * Standard smoothstep (C1 continuity)
 * f(0) = 0, f(1) = 1, f'(0) = 0, f'(1) = 0
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Ken Perlin's smootherstep (C2 continuity)
 * f(0) = 0, f(1) = 1, f'(0) = 0, f'(1) = 0, f''(0) = 0, f''(1) = 0
 */
export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Clamp value to range
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

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
 * Linear interpolation
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Bilinear interpolation for 2D lookup tables
 */
export function bilinearInterpolate(
  v00: number, v10: number, v01: number, v11: number,
  tx: number, ty: number
): number {
  const v0 = lerp(v00, v10, tx);
  const v1 = lerp(v01, v11, tx);
  return lerp(v0, v1, ty);
}

/**
 * Clamp value to range
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Convert polar coordinates to Cartesian
 */
export function polarToCartesian(r: number, theta: number): { x: number; y: number } {
  return {
    x: r * Math.cos(theta),
    y: r * Math.sin(theta)
  };
}

/**
 * Convert Cartesian coordinates to polar
 */
export function cartesianToPolar(x: number, y: number): { r: number; theta: number } {
  return {
    r: Math.sqrt(x * x + y * y),
    theta: Math.atan2(y, x)
  };
}

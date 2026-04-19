/**
 * Transform Utilities for Specular Angle Compensation
 *
 * Extracts accumulated Z-axis rotation from CSS transform chains.
 * Used to compensate specular highlight angle so light appears fixed
 * in world space regardless of element rotation.
 *
 * ## Supported Transforms (Phase 1)
 *
 * | Transform | Support | Notes |
 * |-----------|---------|-------|
 * | rotate() | Full | Z-axis rotation |
 * | rotateZ() | Full | Same as rotate() |
 * | matrix() | Full | Z rotation extracted via atan2(b, a) |
 * | matrix3d() | Partial | Z rotation component only |
 * | Parent transforms | Full | Accumulated via matrix multiplication |
 *
 * ## Not Supported (Phase 2+)
 * - rotateX(), rotateY(), rotate3d() - 3D tilts affect lighting differently
 * - skew() - Non-orthogonal transforms have no unique rotation angle
 *
 * ## Usage
 *
 * ```ts
 * const rotation = getAccumulatedZRotation(element);
 * const compensatedAngle = worldLightAngle - rotation;
 * ```
 */

/**
 * Result of Z-rotation extraction
 */
export interface ZRotationResult {
  /** Accumulated Z rotation in radians */
  radians: number;
  /** Accumulated Z rotation in degrees */
  degrees: number;
  /** Whether skew was detected (rotation may be inaccurate) */
  hasSkew: boolean;
  /** Whether 3D transforms were detected (Z rotation only, X/Y ignored) */
  has3D: boolean;
}

/**
 * Extract accumulated Z-axis rotation from element and all ancestors.
 *
 * Uses DOMMatrix API to parse computed transform matrices and multiply
 * them to get the final accumulated transformation. Z rotation is then
 * extracted via atan2(b, a) from the 2D portion of the matrix.
 *
 * @param element - Target element
 * @param stopAt - Optional ancestor to stop at (exclusive). Defaults to documentElement.
 * @returns Z rotation result with radians, degrees, and warning flags
 *
 * @example
 * ```ts
 * // Element has transform: rotate(45deg)
 * // Parent has transform: rotate(30deg)
 * const result = getAccumulatedZRotation(element);
 * // result.degrees === 75 (45 + 30)
 * ```
 */
export function getAccumulatedZRotation(
  element: Element,
  stopAt: Element | null = null
): ZRotationResult {
  // Collect ancestor chain (from root to element)
  const chain: Element[] = [];
  let current: Element | null = element;
  const stopElement = stopAt ?? document.documentElement;

  while (current && current !== stopElement && current !== document.documentElement.parentElement) {
    chain.unshift(current);
    current = current.parentElement;
  }

  // Multiply matrices from root to element
  let accumulated = new DOMMatrix();
  let hasSkew = false;
  let has3D = false;

  for (const el of chain) {
    if (!(el instanceof HTMLElement)) continue;

    const style = getComputedStyle(el);
    const transformStr = style.transform;

    if (!transformStr || transformStr === 'none') continue;

    const matrix = new DOMMatrix(transformStr);

    // Detect 3D transforms
    if (!matrix.is2D) {
      has3D = true;
    }

    // Detect skew: in a pure rotation+scale, vectors are orthogonal
    // a*c + b*d = 0 for orthogonal transforms
    const dotProduct = matrix.a * matrix.c + matrix.b * matrix.d;
    if (Math.abs(dotProduct) > 0.001) {
      hasSkew = true;
    }

    // Accumulate transformation
    accumulated = accumulated.multiply(matrix);
  }

  // Extract Z rotation from accumulated matrix
  // For 2D matrix [a, b, c, d, tx, ty]: rotation = atan2(b, a)
  const radians = Math.atan2(accumulated.b, accumulated.a);
  const degrees = radians * (180 / Math.PI);

  return {
    radians,
    degrees,
    hasSkew,
    has3D,
  };
}

/**
 * Get Z rotation of a single element (not including ancestors)
 *
 * @param element - Target element
 * @returns Z rotation in radians, or 0 if no transform
 */
export function getElementZRotation(element: Element): number {
  if (!(element instanceof HTMLElement)) return 0;

  const style = getComputedStyle(element);
  const transformStr = style.transform;

  if (!transformStr || transformStr === 'none') return 0;

  const matrix = new DOMMatrix(transformStr);
  return Math.atan2(matrix.b, matrix.a);
}

/**
 * Check if an element or its ancestors have any transform
 *
 * @param element - Target element
 * @returns true if any ancestor has a non-identity transform
 */
export function hasAnyTransform(element: Element): boolean {
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    if (current instanceof HTMLElement) {
      const transform = getComputedStyle(current).transform;
      if (transform && transform !== 'none') {
        return true;
      }
    }
    current = current.parentElement;
  }

  return false;
}

/**
 * Normalize angle to [-180, 180] range
 *
 * @param degrees - Angle in degrees
 * @returns Normalized angle in [-180, 180]
 */
export function normalizeAngle(degrees: number): number {
  let result = degrees % 360;
  if (result > 180) result -= 360;
  if (result < -180) result += 360;
  return result;
}

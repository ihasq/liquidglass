/**
 * Snell's Law implementation for light refraction
 * n1 * sin(theta1) = n2 * sin(theta2)
 *
 * Extended with Cauchy dispersion model for chromatic aberration:
 * n(λ) = A + B/λ² + C/λ⁴
 */

export interface RefractionResult {
  angle: number;           // Refracted angle
  displacement: number;    // Displacement magnitude
  isTotalReflection: boolean;  // True if TIR occurred
}

/**
 * Chromatic refraction result for RGB channels
 */
export interface ChromaticRefractionResult {
  r: RefractionResult;  // Red channel (650nm)
  g: RefractionResult;  // Green channel (550nm)
  b: RefractionResult;  // Blue channel (450nm)
}

/**
 * Cauchy dispersion coefficients for common glass types
 * n(λ) = A + B/λ² where λ is in nanometers
 */
export interface CauchyCoefficients {
  A: number;  // Base refractive index (dimensionless)
  B: number;  // Dispersion coefficient (nm²)
}

/**
 * Preset Cauchy coefficients for common optical materials
 */
export const GLASS_PRESETS: Record<string, CauchyCoefficients> = {
  // Crown glass (BK7) - low dispersion
  'crown': { A: 1.5046, B: 4200 },
  // Flint glass - high dispersion
  'flint': { A: 1.6100, B: 8500 },
  // Standard glass (current default approximation)
  'standard': { A: 1.4900, B: 3300 },
  // Fused silica - very low dispersion
  'silica': { A: 1.4580, B: 3540 },
  // Dense flint - very high dispersion (strong chromatic effect)
  'dense-flint': { A: 1.7200, B: 12000 },
};

/**
 * Standard wavelengths for RGB primaries (in nanometers)
 */
export const RGB_WAVELENGTHS = {
  r: 650,  // Red
  g: 550,  // Green
  b: 450,  // Blue
} as const;

/**
 * Calculate wavelength-dependent refractive index using Cauchy's equation
 *
 * n(λ) = A + B/λ²
 *
 * @param wavelength - Wavelength in nanometers
 * @param coefficients - Cauchy coefficients (A, B)
 * @returns Refractive index at the given wavelength
 */
export function calculateRefractiveIndex(
  wavelength: number,
  coefficients: CauchyCoefficients = GLASS_PRESETS['standard']
): number {
  const { A, B } = coefficients;
  return A + B / (wavelength * wavelength);
}

/**
 * Calculate Abbe number (dispersion measure) from Cauchy coefficients
 * V = (n_d - 1) / (n_F - n_C)
 * where d=587.6nm (yellow), F=486.1nm (blue), C=656.3nm (red)
 *
 * Higher V = lower dispersion
 * Crown glass: V ≈ 60, Flint glass: V ≈ 35
 */
export function calculateAbbeNumber(coefficients: CauchyCoefficients): number {
  const n_d = calculateRefractiveIndex(587.6, coefficients);  // Yellow (Fraunhofer d-line)
  const n_F = calculateRefractiveIndex(486.1, coefficients);  // Blue (Fraunhofer F-line)
  const n_C = calculateRefractiveIndex(656.3, coefficients);  // Red (Fraunhofer C-line)
  return (n_d - 1) / (n_F - n_C);
}

/**
 * Calculate refraction using Snell's Law
 *
 * @param incidentAngle - Angle of incidence (from surface normal)
 * @param n1 - Refractive index of incident medium (default: 1.0 for air)
 * @param n2 - Refractive index of refracting medium (default: 1.5 for glass)
 * @param thickness - Effective thickness of the glass at this point
 */
export function calculateRefraction(
  incidentAngle: number,
  n1: number = 1.0,
  n2: number = 1.5,
  thickness: number = 1.0
): RefractionResult {
  const eta = n1 / n2;  // Relative refractive index
  const sinTheta1 = Math.sin(incidentAngle);
  const sinTheta2 = eta * sinTheta1;

  // Check for Total Internal Reflection
  if (Math.abs(sinTheta2) > 1.0) {
    return {
      angle: incidentAngle,  // Reflect at same angle
      displacement: 0,
      isTotalReflection: true
    };
  }

  const theta2 = Math.asin(sinTheta2);

  // Displacement = thickness * tan(refracted_angle)
  const displacement = thickness * Math.tan(theta2);

  return {
    angle: theta2,
    displacement,
    isTotalReflection: false
  };
}

/**
 * Calculate chromatic refraction for RGB channels
 *
 * This implements the physical phenomenon of chromatic dispersion where
 * different wavelengths refract at different angles due to wavelength-dependent
 * refractive indices (Cauchy dispersion).
 *
 * Mathematical derivation:
 * 1. Cauchy's equation: n(λ) = A + B/λ²
 * 2. For each wavelength λ ∈ {650nm, 550nm, 450nm}:
 *    - Calculate n(λ) from Cauchy coefficients
 *    - Apply Snell's law: sin(θ₂) = (n₁/n(λ)) × sin(θ₁)
 *    - Compute displacement: d(λ) = thickness × tan(θ₂(λ))
 *
 * The angular dispersion (difference in refraction angle) is:
 * Δθ = θ₂(blue) - θ₂(red)
 *
 * For small angles: Δθ ≈ θ₁ × (1/n_blue - 1/n_red)
 *
 * @param incidentAngle - Angle of incidence (from surface normal)
 * @param n1 - Refractive index of incident medium (default: 1.0 for air)
 * @param thickness - Effective thickness of the glass
 * @param glassType - Glass type preset name or custom Cauchy coefficients
 */
export function calculateChromaticRefraction(
  incidentAngle: number,
  n1: number = 1.0,
  thickness: number = 1.0,
  glassType: string | CauchyCoefficients = 'standard'
): ChromaticRefractionResult {
  const coefficients = typeof glassType === 'string'
    ? GLASS_PRESETS[glassType] ?? GLASS_PRESETS['standard']
    : glassType;

  // Calculate refractive index for each RGB wavelength
  const n_r = calculateRefractiveIndex(RGB_WAVELENGTHS.r, coefficients);
  const n_g = calculateRefractiveIndex(RGB_WAVELENGTHS.g, coefficients);
  const n_b = calculateRefractiveIndex(RGB_WAVELENGTHS.b, coefficients);

  // Apply Snell's law for each channel
  return {
    r: calculateRefraction(incidentAngle, n1, n_r, thickness),
    g: calculateRefraction(incidentAngle, n1, n_g, thickness),
    b: calculateRefraction(incidentAngle, n1, n_b, thickness),
  };
}

/**
 * Calculate chromatic displacement vector for RGB channels
 *
 * Returns separate displacement vectors for R, G, B channels, enabling
 * chromatic aberration effects where color fringes appear at edges.
 *
 * The displacement difference between channels creates the characteristic
 * "rainbow fringing" of chromatic aberration:
 * - Blue light bends more (higher n) → larger displacement
 * - Red light bends less (lower n) → smaller displacement
 *
 * @param rho - Normalized radius [0, 1]
 * @param theta - Angle in radians (atan2(y, x))
 * @param slope - Surface slope at this point
 * @param thickness - Glass thickness
 * @param glassType - Glass type preset or custom Cauchy coefficients
 */
export function calculateChromaticDisplacementVector(
  rho: number,
  theta: number,
  slope: number,
  thickness: number,
  glassType: string | CauchyCoefficients = 'standard'
): { r: { dx: number; dy: number }; g: { dx: number; dy: number }; b: { dx: number; dy: number } } {
  if (rho === 0 || slope === 0) {
    const zero = { dx: 0, dy: 0 };
    return { r: zero, g: zero, b: zero };
  }

  // Normal angle from slope
  const normalAngle = Math.atan(Math.abs(slope));

  // Calculate chromatic refraction
  const chromatic = calculateChromaticRefraction(normalAngle, 1.0, thickness, glassType);

  const processChannel = (refraction: RefractionResult) => {
    if (refraction.isTotalReflection) {
      return { dx: 0, dy: 0 };
    }
    let d = refraction.displacement;
    if (slope < 0) d = -d;
    return {
      dx: d * Math.cos(theta),
      dy: d * Math.sin(theta)
    };
  };

  return {
    r: processChannel(chromatic.r),
    g: processChannel(chromatic.g),
    b: processChannel(chromatic.b),
  };
}

/**
 * Convert surface slope to normal angle
 * The normal angle is measured from vertical (perpendicular to surface)
 */
function slopeToNormalAngle(slope: number): number {
  return Math.atan(Math.abs(slope));
}

/**
 * Calculate displacement vector from refraction
 *
 * @param rho - Normalized radius [0, 1]
 * @param theta - Angle in radians (atan2(y, x))
 * @param slope - Surface slope at this point
 * @param refractiveIndex - Glass refractive index
 * @param thickness - Glass thickness
 */
export function calculateDisplacementVector(
  rho: number,
  theta: number,
  slope: number,
  refractiveIndex: number,
  thickness: number
): { dx: number; dy: number } {
  if (rho === 0 || slope === 0) {
    return { dx: 0, dy: 0 };
  }

  // Normal angle from slope
  const normalAngle = slopeToNormalAngle(slope);

  // Apply Snell's law
  const refraction = calculateRefraction(normalAngle, 1.0, refractiveIndex, thickness);

  if (refraction.isTotalReflection) {
    return { dx: 0, dy: 0 };
  }

  // Displacement magnitude
  let d = refraction.displacement;

  // Sign: negative slope means displacement towards center
  if (slope < 0) {
    d = -d;
  }

  // Convert to Cartesian displacement (radial direction)
  return {
    dx: d * Math.cos(theta),
    dy: d * Math.sin(theta)
  };
}

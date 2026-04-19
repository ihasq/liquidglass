/**
 * Snell's Law implementation for light refraction
 * n1 * sin(theta1) = n2 * sin(theta2)
 */

export interface RefractionResult {
  angle: number;           // Refracted angle
  displacement: number;    // Displacement magnitude
  isTotalReflection: boolean;  // True if TIR occurred
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

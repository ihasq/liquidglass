/**
 * Surface height profiles for glass shapes
 * All functions take normalized radius rho in [0, 1] and return height and slope
 */

import { smootherstep } from './interpolation';

export type ProfileType = 'circle' | 'squircle' | 'concave' | 'lip' | 'parabolic';

export interface ProfileResult {
  height: number;  // Surface height at this radius
  slope: number;   // dh/drho - derivative of height
}

/**
 * Convex circular profile (spherical dome)
 * h(rho) = sqrt(1 - rho^2)
 * dh/drho = -rho / sqrt(1 - rho^2)
 */
export function circleProfile(rho: number): ProfileResult {
  const rhoSq = rho * rho;
  if (rhoSq >= 1) {
    return { height: 0, slope: -Infinity };
  }
  const sqrtTerm = Math.sqrt(1 - rhoSq);
  return {
    height: sqrtTerm,
    slope: -rho / sqrtTerm
  };
}

/**
 * Convex squircle profile (Apple's preferred soft curvature)
 * h(rho) = (1 - rho^4)^(1/4)
 * dh/drho = -rho^3 * (1 - rho^4)^(-3/4)
 */
export function squircleProfile(rho: number): ProfileResult {
  const rho4 = Math.pow(rho, 4);
  if (rho4 >= 1) {
    return { height: 0, slope: -Infinity };
  }
  const base = 1 - rho4;
  const height = Math.pow(base, 0.25);
  const slope = -Math.pow(rho, 3) * Math.pow(base, -0.75);
  return { height, slope };
}

/**
 * Concave profile (inverted - causes ray divergence)
 * h(rho) = -sqrt(1 - rho^2) + 1
 */
export function concaveProfile(rho: number): ProfileResult {
  const rhoSq = rho * rho;
  if (rhoSq >= 1) {
    return { height: 0, slope: Infinity };
  }
  const sqrtTerm = Math.sqrt(1 - rhoSq);
  return {
    height: 1 - sqrtTerm,
    slope: rho / sqrtTerm
  };
}

/**
 * Parabolic profile (simple, computationally efficient)
 * h(rho) = 1 - rho^2
 * dh/drho = -2 * rho
 */
export function parabolicProfile(rho: number): ProfileResult {
  return {
    height: 1 - rho * rho,
    slope: -2 * rho
  };
}

/**
 * Lip profile - blend of convex center and concave edge
 * Uses smootherstep to transition between profiles
 */
export function lipProfile(rho: number, blendStart: number = 0.3, blendEnd: number = 0.7): ProfileResult {
  const convex = squircleProfile(rho);
  const concave = concaveProfile(rho);

  const blend = smootherstep(blendStart, blendEnd, rho);

  return {
    height: convex.height * (1 - blend) + concave.height * blend,
    slope: convex.slope * (1 - blend) + concave.slope * blend
  };
}

/**
 * Get profile function by type
 */
export function getProfile(type: ProfileType): (rho: number) => ProfileResult {
  switch (type) {
    case 'circle': return circleProfile;
    case 'squircle': return squircleProfile;
    case 'concave': return concaveProfile;
    case 'parabolic': return parabolicProfile;
    case 'lip': return lipProfile;
    default: return squircleProfile;
  }
}

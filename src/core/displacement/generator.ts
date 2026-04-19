/**
 * Displacement map generator using Canvas
 * Generates RGB-encoded displacement maps for SVG feDisplacementMap
 */

import { getProfile, ProfileType } from '../math/profiles';
import { smootherstep, clamp } from '../math/interpolation';

export interface DisplacementMapOptions {
  width: number;
  height: number;
  profile: ProfileType;
  refractiveIndex: number;
  thickness: number;
  refractionLevel: number;  // 0-1 multiplier for effect strength
  borderRadius: number;     // In pixels, for rounded corners
}

export interface DisplacementMapResult {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  maxDisplacement: number;
}

/**
 * Build a 1D lookup table for radially symmetric displacement
 *
 * For convex surfaces (like glass lenses):
 * - Light bends inward (toward center)
 * - This means we sample the background from OUTSIDE the ray's landing point
 * - Therefore, displacement vectors point OUTWARD (away from center)
 *
 * The LUT stores normalized displacement magnitude [0, 1] where:
 * - 0 = no displacement (at center or edge)
 * - 1 = maximum displacement (somewhere in between)
 */
function buildRadialLUT(
  samples: number,
  profile: ProfileType,
  refractiveIndex: number,
  thickness: number
): Float32Array {
  const lut = new Float32Array(samples);
  const profileFn = getProfile(profile);

  let maxDisp = 0;

  // rho here represents distance from border (0 = at edge, 1 = at center)
  // We iterate from edge to center
  for (let i = 0; i < samples; i++) {
    const distFromBorder = i / (samples - 1);  // 0 at edge, 1 at center

    if (distFromBorder <= 0.001) {
      lut[i] = 0;  // No displacement at edge
      continue;
    }

    // Get slope at this distance from border
    // For convex squircle, slope is negative (surface goes down from center)
    const { slope, height } = profileFn(distFromBorder);

    if (!isFinite(slope) || Math.abs(slope) < 0.001) {
      lut[i] = 0;
      continue;
    }

    // Calculate the normal angle from the slope
    const normalAngle = Math.atan(Math.abs(slope));

    // Apply Snell's law: n1 * sin(θ1) = n2 * sin(θ2)
    // For light entering glass from air: sin(θ2) = sin(θ1) / n
    const sinTheta1 = Math.sin(normalAngle);
    const sinTheta2 = sinTheta1 / refractiveIndex;

    // Check for total internal reflection (shouldn't happen for n > 1)
    if (sinTheta2 >= 1.0) {
      lut[i] = lut[i - 1] || 0;
      continue;
    }

    const theta2 = Math.asin(sinTheta2);

    // Displacement = height * tan(refracted_angle)
    // For convex surface, height is positive and increases toward center
    const displacement = height * thickness * Math.tan(theta2);

    // Store positive displacement (outward direction will be applied later)
    lut[i] = displacement;
    maxDisp = Math.max(maxDisp, Math.abs(displacement));
  }

  // Normalize LUT to [0, 1]
  if (maxDisp > 0) {
    for (let i = 0; i < samples; i++) {
      lut[i] = Math.abs(lut[i]) / maxDisp;
    }
  }

  return lut;
}

/**
 * Sample LUT with linear interpolation
 */
function sampleLUT(lut: Float32Array, rho: number): number {
  const idx = rho * (lut.length - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(i0 + 1, lut.length - 1);
  const t = idx - i0;
  return lut[i0] * (1 - t) + lut[i1] * t;
}

/**
 * Calculate distance from border with border radius support
 * Returns:
 *  - distFromBorder: normalized [0, 1] where 0 = at edge, 1 = at center
 *  - gradX, gradY: direction toward nearest border (normalized)
 *  - inBounds: whether point is inside the shape
 */
function calculateDistanceFromBorder(
  x: number, y: number,
  width: number, height: number,
  borderRadius: number
): { distFromBorder: number; gradX: number; gradY: number; inBounds: boolean } {
  const centerX = width / 2;
  const centerY = height / 2;

  // Offset from center
  const dx = x - centerX;
  const dy = y - centerY;

  // For rounded rectangle, calculate distance to edge
  const halfW = width / 2;
  const halfH = height / 2;
  const r = Math.min(borderRadius, halfW, halfH);

  // Inner rectangle (without rounded corners)
  const innerW = halfW - r;
  const innerH = halfH - r;

  let edgeDist: number;
  let gradX = 0;
  let gradY = 0;

  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const signX = dx >= 0 ? 1 : -1;
  const signY = dy >= 0 ? 1 : -1;

  if (absX <= innerW && absY <= innerH) {
    // Inside inner rectangle - find nearest edge
    const distToX = halfW - absX;
    const distToY = halfH - absY;
    if (distToX < distToY) {
      edgeDist = distToX;
      gradX = signX;  // Point toward left/right edge
      gradY = 0;
    } else {
      edgeDist = distToY;
      gradX = 0;
      gradY = signY;  // Point toward top/bottom edge
    }
  } else if (absX <= innerW) {
    // Top/bottom edge region
    edgeDist = halfH - absY;
    gradX = 0;
    gradY = signY;
  } else if (absY <= innerH) {
    // Left/right edge region
    edgeDist = halfW - absX;
    gradX = signX;
    gradY = 0;
  } else {
    // Corner region - direction toward corner circle center
    const cornerX = absX - innerW;
    const cornerY = absY - innerH;
    const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
    edgeDist = r - cornerDist;
    if (cornerDist > 0.001) {
      // Direction from corner circle center toward point (outward)
      gradX = (cornerX / cornerDist) * signX;
      gradY = (cornerY / cornerDist) * signY;
    }
  }

  // Normalize: 0 at edge, 1 at center
  const maxDist = Math.min(halfW, halfH);
  const distFromBorder = clamp(edgeDist / maxDist, 0, 1);

  return {
    distFromBorder,
    gradX,
    gradY,
    inBounds: edgeDist >= 0
  };
}

/**
 * Generate a displacement map canvas
 *
 * The displacement map encodes how much each pixel should be displaced:
 * - R channel: X displacement (128 = none, <128 = left, >128 = right)
 * - G channel: Y displacement (128 = none, <128 = up, >128 = down)
 *
 * For convex glass (like liquid glass effect):
 * - The glass acts as a convex lens, bending light inward
 * - To simulate this, we sample the background from OUTWARD positions
 * - Displacement vectors point OUTWARD (radially away from center)
 * - This creates the "magnifying glass" bulge effect
 */
export function generateDisplacementMap(options: DisplacementMapOptions): DisplacementMapResult {
  const {
    width, height,
    profile,
    refractiveIndex,
    thickness,
    refractionLevel,
    borderRadius
  } = options;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  // Build LUT - stores normalized displacement magnitude [0, 1]
  // LUT index 0 = at edge, index max = at center
  const lut = buildRadialLUT(256, profile, refractiveIndex, thickness);

  const centerX = width / 2;
  const centerY = height / 2;
  const halfW = width / 2;
  const halfH = height / 2;

  // For border-radius clipping
  const r = Math.min(borderRadius, halfW, halfH);
  const innerW = halfW - r;
  const innerH = halfH - r;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const idx = (py * width + px) * 4;

      // Vector from center to this pixel
      const dx = px - centerX;
      const dy = py - centerY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      // Check if inside rounded rectangle bounds
      let inBounds = true;
      if (absX > innerW && absY > innerH) {
        const cornerX = absX - innerW;
        const cornerY = absY - innerH;
        if (cornerX * cornerX + cornerY * cornerY > r * r) {
          inBounds = false;
        }
      } else if (absX > halfW || absY > halfH) {
        inBounds = false;
      }

      if (!inBounds) {
        // Outside bounds - neutral displacement
        data[idx] = 128;
        data[idx + 1] = 128;
        data[idx + 2] = 0;
        data[idx + 3] = 255;
        continue;
      }

      // Rectangular edge-based displacement (matches kube.io pattern)
      // X displacement near left/right edges, Y displacement near top/bottom

      let dispX = 0;
      let dispY = 0;

      // Distance from each edge
      const distFromLeft = px;
      const distFromRight = width - 1 - px;
      const distFromTop = py;
      const distFromBottom = height - 1 - py;

      // Edge threshold - kube.io uses ~25% from edge
      const edgeThreshold = Math.min(halfW, halfH) * 0.25;

      // Helper function for edge displacement magnitude
      // Kube.io pattern: gradual transition from saturation
      const calcMag = (distFromEdge: number, threshold: number) => {
        // Very smooth saturation at edge (2 pixels full, 2 pixels transition)
        if (distFromEdge <= 2) {
          return refractionLevel * 1.25;
        }
        if (distFromEdge <= 4) {
          // Smooth transition from saturation
          const t = (distFromEdge - 2) / 2;
          return refractionLevel * (1.25 - t * 0.15);  // Gentle drop
        }
        // Main falloff
        const adjustedDist = distFromEdge - 4;
        const adjustedThreshold = threshold - 4;
        const edgeFactor = clamp(1 - (adjustedDist / adjustedThreshold), 0, 1);
        return Math.pow(edgeFactor, 3.0) * refractionLevel * 1.1;
      };

      // X displacement (left/right edges)
      if (distFromLeft < edgeThreshold) {
        dispX = calcMag(distFromLeft, edgeThreshold);
      } else if (distFromRight < edgeThreshold) {
        dispX = -calcMag(distFromRight, edgeThreshold);
      }

      // Y displacement (top/bottom edges)
      if (distFromTop < edgeThreshold) {
        dispY = calcMag(distFromTop, edgeThreshold);
      } else if (distFromBottom < edgeThreshold) {
        dispY = -calcMag(distFromBottom, edgeThreshold);
      }

      // Encode to RGB
      // 128 = no displacement
      // 0 = -1 (max negative), 255 = +1 (max positive)
      data[idx] = clamp(Math.round(128 + dispX * 127), 0, 255);     // R = X
      data[idx + 1] = clamp(Math.round(128 + dispY * 127), 0, 255); // G = Y
      data[idx + 2] = 0;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Calculate max displacement for filter scale
  const maxDisplacement = Math.min(halfW, halfH) * refractionLevel;

  return {
    canvas,
    dataUrl: canvas.toDataURL('image/png'),
    maxDisplacement
  };
}

/**
 * Generate displacement map for squircle shape (most common)
 */
export function generateSquircleDisplacementMap(
  width: number,
  height: number,
  refractiveIndex: number = 1.5,
  refractionLevel: number = 0.8,
  borderRadius: number = 20
): DisplacementMapResult {
  return generateDisplacementMap({
    width,
    height,
    profile: 'squircle',
    refractiveIndex,
    thickness: 1.0,
    refractionLevel,
    borderRadius
  });
}

/**
 * Specular highlight map generator
 * Creates rim lighting effect based on surface normals and light direction
 */

import { getProfile, ProfileType } from '../math/profiles';
import { smootherstep, clamp } from '../math/interpolation';

export interface SpecularMapOptions {
  width: number;
  height: number;
  profile: ProfileType;
  lightDirection: { x: number; y: number };  // Normalized 2D direction
  intensity: number;      // 0-1 highlight intensity
  saturation: number;     // Color saturation factor
  borderRadius: number;
}

export interface SpecularMapResult {
  canvas: HTMLCanvasElement;
  dataUrl: string;
}

/**
 * Calculate specular intensity based on surface normal and light direction
 */
function calculateSpecular(
  normalX: number,
  normalY: number,
  lightX: number,
  lightY: number
): number {
  // Dot product of normal and light direction
  // Higher values where surface faces the light
  const dot = normalX * lightX + normalY * lightY;

  // Use Fresnel-like falloff for rim lighting
  // Stronger at edges where normal is perpendicular to view
  const fresnel = Math.pow(1 - Math.abs(dot), 2);

  // Combine for rim light effect
  return clamp(fresnel + Math.max(0, dot) * 0.3, 0, 1);
}

/**
 * Generate specular highlight map
 */
export function generateSpecularMap(options: SpecularMapOptions): SpecularMapResult {
  const {
    width, height,
    profile,
    lightDirection,
    intensity,
    saturation,
    borderRadius
  } = options;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  const profileFn = getProfile(profile);
  const centerX = width / 2;
  const centerY = height / 2;

  // Normalize light direction
  const lightLen = Math.sqrt(lightDirection.x ** 2 + lightDirection.y ** 2);
  const lightX = lightDirection.x / lightLen;
  const lightY = lightDirection.y / lightLen;

  const halfW = width / 2;
  const halfH = height / 2;
  const r = Math.min(borderRadius, halfW, halfH);
  const innerW = halfW - r;
  const innerH = halfH - r;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const idx = (py * width + px) * 4;

      const dx = px - centerX;
      const dy = py - centerY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      // Check bounds with border radius
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
        // Outside - fully transparent
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
        continue;
      }

      // Calculate distance to the nearest edge of the rounded rectangle
      // This matches kube.io's edge-based specular pattern
      let edgeDist: number;
      let normalX = 0, normalY = 0;

      if (absX <= innerW && absY <= innerH) {
        // Inside inner rectangle
        const distToX = halfW - absX;
        const distToY = halfH - absY;
        edgeDist = Math.min(distToX, distToY);
      } else if (absX <= innerW) {
        // Top/bottom edge region
        edgeDist = halfH - absY;
        normalY = dy >= 0 ? 1 : -1;
      } else if (absY <= innerH) {
        // Left/right edge region
        edgeDist = halfW - absX;
        normalX = dx >= 0 ? 1 : -1;
      } else {
        // Corner region
        const cornerX = absX - innerW;
        const cornerY = absY - innerH;
        const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
        edgeDist = r - cornerDist;
        if (cornerDist > 0.001) {
          normalX = (cornerX / cornerDist) * (dx >= 0 ? 1 : -1);
          normalY = (cornerY / cornerDist) * (dy >= 0 ? 1 : -1);
        }
      }

      // Normalize edge distance to [0, 1] where 0 = at edge
      const maxDist = Math.min(halfW, halfH);
      const edgeNorm = clamp(edgeDist / maxDist, 0, 1);

      // Kube.io pattern: very thin ring at edge (y=1-3 from boundary)
      // At 300px height, y=1-3 means edgeNorm = 0.003 to 0.01
      // Peak at y=2, so center the ring there
      const ringInset = 0.005;  // Start at ~1.5 pixels from edge
      const ringWidth = 0.013;  // Span ~3-4 pixels total

      // Gaussian profile for the ring
      let edgeFactor = 0;
      if (edgeNorm >= ringInset && edgeNorm <= ringInset + ringWidth) {
        const ringPos = (edgeNorm - ringInset) / ringWidth;  // 0 to 1 within ring
        edgeFactor = Math.sin(ringPos * Math.PI);  // Peak at center of ring
      }

      // Concentrate on top/bottom edges (where Y normal dominates)
      const yDominance = Math.abs(normalY) > 0.5 ? 1 : 0;

      // Match kube.io peak alpha of ~191/255 = 0.75
      const finalSpec = edgeFactor * yDominance * intensity * 1.2;

      // Pure white highlight
      const brightness = Math.round(255 * finalSpec);
      const r_val = brightness;
      const g_val = brightness;
      const b_val = brightness;
      const alpha = Math.round(255 * clamp(finalSpec * 1.5, 0, 1));

      data[idx] = clamp(r_val, 0, 255);
      data[idx + 1] = clamp(g_val, 0, 255);
      data[idx + 2] = clamp(b_val, 0, 255);
      data[idx + 3] = alpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  return {
    canvas,
    dataUrl: canvas.toDataURL('image/png')
  };
}

/**
 * Generate default specular map with standard lighting
 */
export function generateDefaultSpecularMap(
  width: number,
  height: number,
  profile: ProfileType = 'squircle',
  intensity: number = 0.5,
  borderRadius: number = 20
): SpecularMapResult {
  return generateSpecularMap({
    width,
    height,
    profile,
    lightDirection: { x: 0.7, y: -0.7 },  // Top-right light
    intensity,
    saturation: 0.3,
    borderRadius
  });
}

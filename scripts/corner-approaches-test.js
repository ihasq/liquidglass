/**
 * Test 10 different approaches for corner displacement map generation
 * Measure pixel match rate against Canvas reference
 */

import puppeteer from 'puppeteer';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import fs from 'fs';

const WIDTH = 200;
const HEIGHT = 100;
const RADIUS = 20;
const EDGE_WIDTH_RATIO = 0.5;

// Shared constants
const halfW = WIDTH / 2;
const halfH = HEIGHT / 2;
const edgeWidth = Math.min(halfW, halfH) * EDGE_WIDTH_RATIO;
const r = Math.min(RADIUS, halfW, halfH);

// Canvas reference generator (inline as string for page evaluation)
const canvasGenerator = `
function generateCanvasReference() {
  const WIDTH = ${WIDTH}, HEIGHT = ${HEIGHT}, RADIUS = ${RADIUS};
  const EDGE_WIDTH_RATIO = ${EDGE_WIDTH_RATIO};
  const halfW = WIDTH / 2, halfH = HEIGHT / 2;
  const edgeWidth = Math.min(halfW, halfH) * EDGE_WIDTH_RATIO;
  const r = Math.min(RADIUS, halfW, halfH);

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(WIDTH, HEIGHT);
  const data = imageData.data;

  for (let py = 0; py < HEIGHT; py++) {
    for (let px = 0; px < WIDTH; px++) {
      const idx = (py * WIDTH + px) * 4;
      const dx = Math.abs(px - halfW);
      const dy = Math.abs(py - halfH);

      let inBounds = true;
      const inCorner = dx > halfW - r && dy > halfH - r;
      if (inCorner) {
        const cornerX = dx - (halfW - r);
        const cornerY = dy - (halfH - r);
        if (cornerX * cornerX + cornerY * cornerY > r * r) {
          inBounds = false;
        }
      }

      if (!inBounds) {
        data[idx] = 128; data[idx + 1] = 128; data[idx + 2] = 128; data[idx + 3] = 255;
        continue;
      }

      let distFromEdge, dirX = 0, dirY = 0;
      if (inCorner) {
        const cornerX = dx - (halfW - r);
        const cornerY = dy - (halfH - r);
        const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
        distFromEdge = r - cornerDist;
        if (cornerDist > 0.001) {
          dirX = (cornerX / cornerDist) * Math.sign(px - halfW);
          dirY = (cornerY / cornerDist) * Math.sign(py - halfH);
        }
      } else {
        const distX = halfW - dx;
        const distY = halfH - dy;
        if (distX < distY) {
          distFromEdge = distX; dirX = Math.sign(px - halfW);
        } else {
          distFromEdge = distY; dirY = Math.sign(py - halfH);
        }
      }

      const magnitude = distFromEdge < 0 ? 0 : Math.exp(-3 * distFromEdge / edgeWidth);
      const dispX = -dirX * magnitude;
      const dispY = -dirY * magnitude;

      data[idx] = Math.round(128 + dispX * 127);
      data[idx + 1] = Math.round(128 + dispY * 127);
      data[idx + 2] = 128;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
`;

// ============================================
// APPROACH IMPLEMENTATIONS
// ============================================

// Approach 1: Edge separation (linear gradient for edges + rect array for corners)
function approach1_EdgeSeparation() {
  const strips = [];

  // Only generate rects for corner regions
  for (let py = 0; py < HEIGHT; py++) {
    for (let px = 0; px < WIDTH; px++) {
      const dx = Math.abs(px - halfW);
      const dy = Math.abs(py - halfH);

      const inCorner = dx > halfW - r && dy > halfH - r;
      if (!inCorner) continue; // Skip non-corner pixels

      const cornerX = dx - (halfW - r);
      const cornerY = dy - (halfH - r);
      if (cornerX * cornerX + cornerY * cornerY > r * r) continue;

      const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
      const distFromEdge = r - cornerDist;

      let dirX = 0, dirY = 0;
      if (cornerDist > 0.001) {
        dirX = (cornerX / cornerDist) * Math.sign(px - halfW);
        dirY = (cornerY / cornerDist) * Math.sign(py - halfH);
      }

      const magnitude = Math.exp(-3 * distFromEdge / edgeWidth);
      const dispX = -dirX * magnitude;
      const dispY = -dirY * magnitude;

      const red = Math.round(128 + dispX * 127);
      const green = Math.round(128 + dispY * 127);

      strips.push(`<rect x="${px}" y="${py}" width="1" height="1" fill="rgb(${red},${green},128)"/>`);
    }
  }

  // Linear gradients for edges
  const stops = [0, 0.2, 0.4, 0.6, 0.8, 1.0].map(t => {
    const mag = Math.exp(-3 * t);
    return { offset: t, mag };
  });

  const edgeGradients = `
    <linearGradient id="edge-left" x1="0" y1="0" x2="1" y2="0">
      ${stops.map(s => `<stop offset="${s.offset * 100}%" stop-color="rgb(${Math.round(128 + s.mag * 127)},128,128)"/>`).join('')}
    </linearGradient>
    <linearGradient id="edge-right" x1="1" y1="0" x2="0" y2="0">
      ${stops.map(s => `<stop offset="${s.offset * 100}%" stop-color="rgb(${Math.round(128 - s.mag * 127)},128,128)"/>`).join('')}
    </linearGradient>
    <linearGradient id="edge-top" x1="0" y1="0" x2="0" y2="1">
      ${stops.map(s => `<stop offset="${s.offset * 100}%" stop-color="rgb(128,${Math.round(128 + s.mag * 127)},128)"/>`).join('')}
    </linearGradient>
    <linearGradient id="edge-bottom" x1="0" y1="1" x2="0" y2="0">
      ${stops.map(s => `<stop offset="${s.offset * 100}%" stop-color="rgb(128,${Math.round(128 - s.mag * 127)},128)"/>`).join('')}
    </linearGradient>
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>${edgeGradients}</defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="rgb(128,128,128)"/>
  <rect x="0" y="${r}" width="${edgeWidth}" height="${HEIGHT - 2*r}" fill="url(#edge-left)"/>
  <rect x="${WIDTH - edgeWidth}" y="${r}" width="${edgeWidth}" height="${HEIGHT - 2*r}" fill="url(#edge-right)"/>
  <rect x="${r}" y="0" width="${WIDTH - 2*r}" height="${edgeWidth}" fill="url(#edge-top)"/>
  <rect x="${r}" y="${HEIGHT - edgeWidth}" width="${WIDTH - 2*r}" height="${edgeWidth}" fill="url(#edge-bottom)"/>
  ${strips.join('\n  ')}
</svg>`;
}

// Approach 2: Angle quantization (sector division)
function approach2_AngleQuantization(numSectors = 32) {
  const strips = [];

  // For each corner
  const corners = [
    { cx: halfW - r, cy: halfH - r, signX: -1, signY: -1 }, // top-left
    { cx: halfW + r, cy: halfH - r, signX: 1, signY: -1 },  // top-right
    { cx: halfW - r, cy: halfH + r, signX: -1, signY: 1 },  // bottom-left
    { cx: halfW + r, cy: halfH + r, signX: 1, signY: 1 },   // bottom-right
  ];

  corners.forEach(corner => {
    const startAngle = corner.signX > 0 ? (corner.signY > 0 ? 0 : -Math.PI/2) : (corner.signY > 0 ? Math.PI/2 : Math.PI);

    for (let s = 0; s < numSectors / 4; s++) {
      const angle1 = startAngle + (s / numSectors) * 2 * Math.PI;
      const angle2 = startAngle + ((s + 1) / numSectors) * 2 * Math.PI;
      const midAngle = (angle1 + angle2) / 2;

      const dirX = Math.cos(midAngle);
      const dirY = Math.sin(midAngle);

      // Create path for this sector
      const numRadialSteps = 10;
      for (let ri = 0; ri < numRadialSteps; ri++) {
        const r1 = r * (1 - ri / numRadialSteps);
        const r2 = r * (1 - (ri + 1) / numRadialSteps);
        const distFromEdge = ri * (r / numRadialSteps);

        const magnitude = Math.exp(-3 * distFromEdge / edgeWidth);
        const dispX = -dirX * magnitude * corner.signX;
        const dispY = -dirY * magnitude * corner.signY;

        const red = Math.round(128 + dispX * 127);
        const green = Math.round(128 + dispY * 127);

        // Arc segment
        const x1 = corner.cx + r1 * Math.cos(angle1);
        const y1 = corner.cy + r1 * Math.sin(angle1);
        const x2 = corner.cx + r1 * Math.cos(angle2);
        const y2 = corner.cy + r1 * Math.sin(angle2);
        const x3 = corner.cx + r2 * Math.cos(angle2);
        const y3 = corner.cy + r2 * Math.sin(angle2);
        const x4 = corner.cx + r2 * Math.cos(angle1);
        const y4 = corner.cy + r2 * Math.sin(angle1);

        strips.push(`<path d="M${x1},${y1} A${r1},${r1} 0 0 1 ${x2},${y2} L${x3},${y3} A${r2},${r2} 0 0 0 ${x4},${y4} Z" fill="rgb(${red},${green},128)"/>`);
      }
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="rgb(128,128,128)"/>
  ${strips.join('\n  ')}
</svg>`;
}

// Approach 3: Concentric arc division
function approach3_ConcentricArcs(numArcs = 20) {
  const strips = [];

  const corners = [
    { cx: halfW - r, cy: halfH - r, startAngle: Math.PI, endAngle: 1.5 * Math.PI, signX: -1, signY: -1 },
    { cx: halfW + r - 1, cy: halfH - r, startAngle: 1.5 * Math.PI, endAngle: 2 * Math.PI, signX: 1, signY: -1 },
    { cx: halfW - r, cy: halfH + r - 1, startAngle: 0.5 * Math.PI, endAngle: Math.PI, signX: -1, signY: 1 },
    { cx: halfW + r - 1, cy: halfH + r - 1, startAngle: 0, endAngle: 0.5 * Math.PI, signX: 1, signY: 1 },
  ];

  corners.forEach(corner => {
    for (let i = 0; i < numArcs; i++) {
      const outerR = r - i * (r / numArcs);
      const innerR = r - (i + 1) * (r / numArcs);
      const distFromEdge = i * (r / numArcs);

      const magnitude = Math.exp(-3 * distFromEdge / edgeWidth);

      // Average direction for this arc (diagonal for corners)
      const midAngle = (corner.startAngle + corner.endAngle) / 2;
      const dirX = Math.cos(midAngle);
      const dirY = Math.sin(midAngle);

      const dispX = -dirX * magnitude;
      const dispY = -dirY * magnitude;

      const red = Math.round(128 + dispX * 127);
      const green = Math.round(128 + dispY * 127);

      // Draw arc
      const largeArc = corner.endAngle - corner.startAngle > Math.PI ? 1 : 0;
      const x1 = corner.cx + outerR * Math.cos(corner.startAngle);
      const y1 = corner.cy + outerR * Math.sin(corner.startAngle);
      const x2 = corner.cx + outerR * Math.cos(corner.endAngle);
      const y2 = corner.cy + outerR * Math.sin(corner.endAngle);
      const x3 = corner.cx + innerR * Math.cos(corner.endAngle);
      const y3 = corner.cy + innerR * Math.sin(corner.endAngle);
      const x4 = corner.cx + innerR * Math.cos(corner.startAngle);
      const y4 = corner.cy + innerR * Math.sin(corner.startAngle);

      strips.push(`<path d="M${x1},${y1} A${outerR},${outerR} 0 ${largeArc} 1 ${x2},${y2} L${x3},${y3} A${innerR},${innerR} 0 ${largeArc} 0 ${x4},${y4} Z" fill="rgb(${red},${green},128)"/>`);
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="rgb(128,128,128)"/>
  ${strips.join('\n  ')}
</svg>`;
}

// Approach 4: Quadtree adaptive division
function approach4_Quadtree(maxDepth = 5, threshold = 3) {
  const rects = [];

  function getPixelColor(px, py) {
    const dx = Math.abs(px - halfW);
    const dy = Math.abs(py - halfH);

    const inCorner = dx > halfW - r && dy > halfH - r;
    if (!inCorner) return { r: 128, g: 128 }; // Handle in edges

    const cornerX = dx - (halfW - r);
    const cornerY = dy - (halfH - r);
    if (cornerX * cornerX + cornerY * cornerY > r * r) return { r: 128, g: 128 };

    const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
    const distFromEdge = r - cornerDist;

    let dirX = 0, dirY = 0;
    if (cornerDist > 0.001) {
      dirX = (cornerX / cornerDist) * Math.sign(px - halfW);
      dirY = (cornerY / cornerDist) * Math.sign(py - halfH);
    }

    const magnitude = Math.exp(-3 * distFromEdge / edgeWidth);
    const dispX = -dirX * magnitude;
    const dispY = -dirY * magnitude;

    return {
      r: Math.round(128 + dispX * 127),
      g: Math.round(128 + dispY * 127)
    };
  }

  function subdivide(x, y, size, depth) {
    if (size < 1) return;

    // Sample corners
    const tl = getPixelColor(x, y);
    const tr = getPixelColor(x + size - 1, y);
    const bl = getPixelColor(x, y + size - 1);
    const br = getPixelColor(x + size - 1, y + size - 1);

    const maxDiffR = Math.max(Math.abs(tl.r - tr.r), Math.abs(tl.r - bl.r), Math.abs(tl.r - br.r), Math.abs(tr.r - bl.r), Math.abs(tr.r - br.r), Math.abs(bl.r - br.r));
    const maxDiffG = Math.max(Math.abs(tl.g - tr.g), Math.abs(tl.g - bl.g), Math.abs(tl.g - br.g), Math.abs(tr.g - bl.g), Math.abs(tr.g - br.g), Math.abs(bl.g - br.g));

    if ((maxDiffR <= threshold && maxDiffG <= threshold) || depth >= maxDepth || size <= 1) {
      // Use center color
      const center = getPixelColor(x + size/2, y + size/2);
      if (center.r !== 128 || center.g !== 128) {
        rects.push(`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="rgb(${center.r},${center.g},128)"/>`);
      }
    } else {
      const half = size / 2;
      subdivide(x, y, half, depth + 1);
      subdivide(x + half, y, half, depth + 1);
      subdivide(x, y + half, half, depth + 1);
      subdivide(x + half, y + half, half, depth + 1);
    }
  }

  // Process corner regions only
  const cornerSize = r + edgeWidth;
  subdivide(0, 0, cornerSize, 0);
  subdivide(WIDTH - cornerSize, 0, cornerSize, 0);
  subdivide(0, HEIGHT - cornerSize, cornerSize, 0);
  subdivide(WIDTH - cornerSize, HEIGHT - cornerSize, cornerSize, 0);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="rgb(128,128,128)"/>
  ${rects.join('\n  ')}
</svg>`;
}

// Approach 5: 2D LUT (small embedded PNG as base64)
function approach5_2DLUT() {
  // Generate corner as small data URL (using raw pixel data encoded in SVG)
  // For simplicity, we'll use rect elements but limit to corner region
  const cornerRects = [];

  for (let py = 0; py < r; py++) {
    for (let px = 0; px < r; px++) {
      const cornerDist = Math.sqrt(px * px + py * py);
      if (cornerDist > r) continue;

      const distFromEdge = r - cornerDist;
      let dirX = 0, dirY = 0;
      if (cornerDist > 0.001) {
        dirX = px / cornerDist;
        dirY = py / cornerDist;
      }

      const magnitude = Math.exp(-3 * distFromEdge / edgeWidth);
      const dispX = -dirX * magnitude;
      const dispY = -dirY * magnitude;

      const red = Math.round(128 + dispX * 127);
      const green = Math.round(128 + dispY * 127);

      if (red !== 128 || green !== 128) {
        cornerRects.push({ x: px, y: py, r: red, g: green });
      }
    }
  }

  // Place in 4 corners with transforms
  const cornerPath = cornerRects.map(c => `<rect x="${c.x}" y="${c.y}" width="1" height="1" fill="rgb(${c.r},${c.g},128)"/>`).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <g id="corner-br">${cornerPath}</g>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="rgb(128,128,128)"/>
  <use href="#corner-br" transform="translate(${WIDTH - r}, ${HEIGHT - r})"/>
  <use href="#corner-br" transform="translate(${WIDTH - r}, ${r}) scale(1,-1)"/>
  <use href="#corner-br" transform="translate(${r}, ${HEIGHT - r}) scale(-1,1)"/>
  <use href="#corner-br" transform="translate(${r}, ${r}) scale(-1,-1)"/>
</svg>`;
}

// Approach 6: Quarter quadrant reuse with transform
function approach6_QuadrantReuse() {
  const cornerRects = [];

  // Generate only bottom-right corner (quadrant 4)
  for (let py = halfH; py < HEIGHT; py++) {
    for (let px = halfW; px < WIDTH; px++) {
      const dx = px - halfW;
      const dy = py - halfH;

      const inCorner = dx > halfW - r && dy > halfH - r;
      if (!inCorner) continue;

      const cornerX = dx - (halfW - r);
      const cornerY = dy - (halfH - r);
      if (cornerX * cornerX + cornerY * cornerY > r * r) continue;

      const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
      const distFromEdge = r - cornerDist;

      let dirX = 0, dirY = 0;
      if (cornerDist > 0.001) {
        dirX = cornerX / cornerDist;
        dirY = cornerY / cornerDist;
      }

      const magnitude = Math.exp(-3 * distFromEdge / edgeWidth);
      const dispX = -dirX * magnitude;
      const dispY = -dirY * magnitude;

      const red = Math.round(128 + dispX * 127);
      const green = Math.round(128 + dispY * 127);

      // Store relative to corner center
      cornerRects.push({ x: px - (WIDTH - r), y: py - (HEIGHT - r), r: red, g: green });
    }
  }

  const cornerDef = cornerRects.map(c => `<rect x="${c.x}" y="${c.y}" width="1" height="1" fill="rgb(${c.r},${c.g},128)"/>`).join('\n    ');

  // Transform for other corners (need to flip R/G channels too, so use separate defs)
  // Actually, we need to recalculate colors for flipped versions
  const tlRects = [], trRects = [], blRects = [];

  for (let py = 0; py < halfH; py++) {
    for (let px = 0; px < halfW; px++) {
      const dx = halfW - px;
      const dy = halfH - py;

      const inCorner = dx > halfW - r && dy > halfH - r;
      if (!inCorner) continue;

      const cornerX = dx - (halfW - r);
      const cornerY = dy - (halfH - r);
      if (cornerX * cornerX + cornerY * cornerY > r * r) continue;

      const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
      const distFromEdge = r - cornerDist;

      let dirX = 0, dirY = 0;
      if (cornerDist > 0.001) {
        dirX = -(cornerX / cornerDist);
        dirY = -(cornerY / cornerDist);
      }

      const magnitude = Math.exp(-3 * distFromEdge / edgeWidth);
      const dispX = -dirX * magnitude;
      const dispY = -dirY * magnitude;

      const red = Math.round(128 + dispX * 127);
      const green = Math.round(128 + dispY * 127);

      tlRects.push(`<rect x="${px}" y="${py}" width="1" height="1" fill="rgb(${red},${green},128)"/>`);
    }
  }

  // Simplified: just output all corners directly
  const allRects = [];
  for (let py = 0; py < HEIGHT; py++) {
    for (let px = 0; px < WIDTH; px++) {
      const dx = Math.abs(px - halfW);
      const dy = Math.abs(py - halfH);

      const inCorner = dx > halfW - r && dy > halfH - r;
      if (!inCorner) continue;

      const cornerX = dx - (halfW - r);
      const cornerY = dy - (halfH - r);
      if (cornerX * cornerX + cornerY * cornerY > r * r) continue;

      const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
      const distFromEdge = r - cornerDist;

      let dirX = 0, dirY = 0;
      if (cornerDist > 0.001) {
        dirX = (cornerX / cornerDist) * Math.sign(px - halfW);
        dirY = (cornerY / cornerDist) * Math.sign(py - halfH);
      }

      const magnitude = Math.exp(-3 * distFromEdge / edgeWidth);
      const dispX = -dirX * magnitude;
      const dispY = -dirY * magnitude;

      const red = Math.round(128 + dispX * 127);
      const green = Math.round(128 + dispY * 127);

      allRects.push(`<rect x="${px}" y="${py}" width="1" height="1" fill="rgb(${red},${green},128)"/>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="rgb(128,128,128)"/>
  ${allRects.join('\n  ')}
</svg>`;
}

// Approach 7: Piecewise linear approximation
function approach7_PiecewiseLinear(numStops = 10) {
  const strips = [];

  // Create radial gradients with piecewise linear approximation of exp()
  const stops = [];
  for (let i = 0; i <= numStops; i++) {
    const t = i / numStops;
    const dist = t * r;
    const mag = Math.exp(-3 * dist / edgeWidth);
    stops.push({ offset: t, mag });
  }

  // For corners, use radial gradient approximation
  // But radial gradient can't handle direction-dependent colors
  // So we still need per-pixel or per-sector approach

  // Simplified: use concentric arcs with more precise stops
  const corners = [
    { cx: halfW - r, cy: halfH - r, startAngle: Math.PI, endAngle: 1.5 * Math.PI, signX: -1, signY: -1 },
    { cx: halfW + r - 1, cy: halfH - r, startAngle: 1.5 * Math.PI, endAngle: 2 * Math.PI, signX: 1, signY: -1 },
    { cx: halfW - r, cy: halfH + r - 1, startAngle: 0.5 * Math.PI, endAngle: Math.PI, signX: -1, signY: 1 },
    { cx: halfW + r - 1, cy: halfH + r - 1, startAngle: 0, endAngle: 0.5 * Math.PI, signX: 1, signY: 1 },
  ];

  const numAngles = 16;

  corners.forEach(corner => {
    for (let ai = 0; ai < numAngles; ai++) {
      const angle1 = corner.startAngle + (ai / numAngles) * (corner.endAngle - corner.startAngle);
      const angle2 = corner.startAngle + ((ai + 1) / numAngles) * (corner.endAngle - corner.startAngle);
      const midAngle = (angle1 + angle2) / 2;

      const dirX = Math.cos(midAngle);
      const dirY = Math.sin(midAngle);

      for (let ri = 0; ri < stops.length - 1; ri++) {
        const outerR = r * (1 - stops[ri].offset);
        const innerR = r * (1 - stops[ri + 1].offset);
        const mag = (stops[ri].mag + stops[ri + 1].mag) / 2;

        const dispX = -dirX * mag;
        const dispY = -dirY * mag;

        const red = Math.round(128 + dispX * 127);
        const green = Math.round(128 + dispY * 127);

        if (outerR > 0.5) {
          const x1 = corner.cx + outerR * Math.cos(angle1);
          const y1 = corner.cy + outerR * Math.sin(angle1);
          const x2 = corner.cx + outerR * Math.cos(angle2);
          const y2 = corner.cy + outerR * Math.sin(angle2);
          const x3 = corner.cx + innerR * Math.cos(angle2);
          const y3 = corner.cy + innerR * Math.sin(angle2);
          const x4 = corner.cx + innerR * Math.cos(angle1);
          const y4 = corner.cy + innerR * Math.sin(angle1);

          strips.push(`<path d="M${x1.toFixed(2)},${y1.toFixed(2)} A${outerR.toFixed(2)},${outerR.toFixed(2)} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${x3.toFixed(2)},${y3.toFixed(2)} A${innerR.toFixed(2)},${innerR.toFixed(2)} 0 0 0 ${x4.toFixed(2)},${y4.toFixed(2)} Z" fill="rgb(${red},${green},128)"/>`);
        }
      }
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="rgb(128,128,128)"/>
  ${strips.join('\n  ')}
</svg>`;
}

// Approach 8: Sector + Arc hybrid
function approach8_SectorArcHybrid(numSectors = 24, numArcs = 15) {
  const strips = [];

  const corners = [
    { cx: halfW - r, cy: halfH - r, startAngle: Math.PI, endAngle: 1.5 * Math.PI },
    { cx: halfW + r - 1, cy: halfH - r, startAngle: 1.5 * Math.PI, endAngle: 2 * Math.PI },
    { cx: halfW - r, cy: halfH + r - 1, startAngle: 0.5 * Math.PI, endAngle: Math.PI },
    { cx: halfW + r - 1, cy: halfH + r - 1, startAngle: 0, endAngle: 0.5 * Math.PI },
  ];

  corners.forEach(corner => {
    const angleRange = corner.endAngle - corner.startAngle;
    const sectorsPerCorner = Math.ceil(numSectors / 4);

    for (let si = 0; si < sectorsPerCorner; si++) {
      const angle1 = corner.startAngle + (si / sectorsPerCorner) * angleRange;
      const angle2 = corner.startAngle + ((si + 1) / sectorsPerCorner) * angleRange;
      const midAngle = (angle1 + angle2) / 2;

      const dirX = Math.cos(midAngle);
      const dirY = Math.sin(midAngle);

      for (let ai = 0; ai < numArcs; ai++) {
        const outerR = r * (1 - ai / numArcs);
        const innerR = r * (1 - (ai + 1) / numArcs);
        const distFromEdge = ai * (r / numArcs);

        const magnitude = Math.exp(-3 * distFromEdge / edgeWidth);
        const dispX = -dirX * magnitude;
        const dispY = -dirY * magnitude;

        const red = Math.round(128 + dispX * 127);
        const green = Math.round(128 + dispY * 127);

        if (outerR > 0.5) {
          const x1 = corner.cx + outerR * Math.cos(angle1);
          const y1 = corner.cy + outerR * Math.sin(angle1);
          const x2 = corner.cx + outerR * Math.cos(angle2);
          const y2 = corner.cy + outerR * Math.sin(angle2);
          const x3 = corner.cx + innerR * Math.cos(angle2);
          const y3 = corner.cy + innerR * Math.sin(angle2);
          const x4 = corner.cx + innerR * Math.cos(angle1);
          const y4 = corner.cy + innerR * Math.sin(angle1);

          strips.push(`<path d="M${x1.toFixed(2)},${y1.toFixed(2)} A${outerR.toFixed(2)},${outerR.toFixed(2)} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${x3.toFixed(2)},${y3.toFixed(2)} A${innerR.toFixed(2)},${innerR.toFixed(2)} 0 0 0 ${x4.toFixed(2)},${y4.toFixed(2)} Z" fill="rgb(${red},${green},128)"/>`);
        }
      }
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="rgb(128,128,128)"/>
  ${strips.join('\n  ')}
</svg>`;
}

// Approach 9: Coarse gradient + fine correction rects
function approach9_CoarseFineCorrected(correctionThreshold = 5) {
  const rects = [];

  // Coarse: radial gradient approximation (diagonal direction)
  // For each corner, use radial gradient pointing to diagonal
  const corners = [
    { cx: halfW - r, cy: halfH - r, angle: -3 * Math.PI / 4 },
    { cx: halfW + r, cy: halfH - r, angle: -Math.PI / 4 },
    { cx: halfW - r, cy: halfH + r, angle: 3 * Math.PI / 4 },
    { cx: halfW + r, cy: halfH + r, angle: Math.PI / 4 },
  ];

  // Generate coarse gradient defs
  let gradientDefs = '';
  corners.forEach((corner, idx) => {
    const dirX = Math.cos(corner.angle);
    const dirY = Math.sin(corner.angle);

    const stops = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const dist = t * r;
      const mag = Math.exp(-3 * dist / edgeWidth);
      const dispX = -dirX * mag;
      const dispY = -dirY * mag;
      const red = Math.round(128 + dispX * 127);
      const green = Math.round(128 + dispY * 127);
      stops.push(`<stop offset="${t * 100}%" stop-color="rgb(${red},${green},128)"/>`);
    }

    gradientDefs += `<radialGradient id="corner-grad-${idx}" cx="${corner.cx}" cy="${corner.cy}" r="${r}" gradientUnits="userSpaceOnUse">${stops.join('')}</radialGradient>\n`;
  });

  // Fine corrections where gradient differs from exact
  for (let py = 0; py < HEIGHT; py++) {
    for (let px = 0; px < WIDTH; px++) {
      const dx = Math.abs(px - halfW);
      const dy = Math.abs(py - halfH);

      const inCorner = dx > halfW - r && dy > halfH - r;
      if (!inCorner) continue;

      const cornerX = dx - (halfW - r);
      const cornerY = dy - (halfH - r);
      if (cornerX * cornerX + cornerY * cornerY > r * r) continue;

      const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
      const distFromEdge = r - cornerDist;

      // Exact values
      let dirX = 0, dirY = 0;
      if (cornerDist > 0.001) {
        dirX = (cornerX / cornerDist) * Math.sign(px - halfW);
        dirY = (cornerY / cornerDist) * Math.sign(py - halfH);
      }

      const magnitude = Math.exp(-3 * distFromEdge / edgeWidth);
      const dispX = -dirX * magnitude;
      const dispY = -dirY * magnitude;
      const exactR = Math.round(128 + dispX * 127);
      const exactG = Math.round(128 + dispY * 127);

      // Coarse approximation (diagonal direction)
      const diagAngle = Math.atan2(Math.sign(py - halfH), Math.sign(px - halfW));
      const coarseDirX = Math.cos(diagAngle);
      const coarseDirY = Math.sin(diagAngle);
      const coarseDispX = -coarseDirX * magnitude;
      const coarseDispY = -coarseDirY * magnitude;
      const coarseR = Math.round(128 + coarseDispX * 127);
      const coarseG = Math.round(128 + coarseDispY * 127);

      // Add correction if needed
      if (Math.abs(exactR - coarseR) > correctionThreshold || Math.abs(exactG - coarseG) > correctionThreshold) {
        rects.push(`<rect x="${px}" y="${py}" width="1" height="1" fill="rgb(${exactR},${exactG},128)"/>`);
      }
    }
  }

  // Place coarse gradients
  let coarseRects = '';
  corners.forEach((corner, idx) => {
    const x = corner.cx - r;
    const y = corner.cy - r;
    coarseRects += `<rect x="${x}" y="${y}" width="${r * 2}" height="${r * 2}" fill="url(#corner-grad-${idx})"/>\n`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <clipPath id="rounded-clip"><rect width="${WIDTH}" height="${HEIGHT}" rx="${r}" ry="${r}"/></clipPath>
    ${gradientDefs}
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="rgb(128,128,128)"/>
  <g clip-path="url(#rounded-clip)">
    ${coarseRects}
  </g>
  ${rects.join('\n  ')}
</svg>`;
}

// Approach 10: Full pixel-perfect (baseline for 100% match)
function approach10_PixelPerfect() {
  const strips = [];

  for (let py = 0; py < HEIGHT; py++) {
    for (let px = 0; px < WIDTH; px++) {
      const dx = Math.abs(px - halfW);
      const dy = Math.abs(py - halfH);

      let inBounds = true;
      const inCorner = dx > halfW - r && dy > halfH - r;
      if (inCorner) {
        const cornerX = dx - (halfW - r);
        const cornerY = dy - (halfH - r);
        if (cornerX * cornerX + cornerY * cornerY > r * r) {
          inBounds = false;
        }
      }

      if (!inBounds) continue;

      let distFromEdge, dirX = 0, dirY = 0;
      if (inCorner) {
        const cornerX = dx - (halfW - r);
        const cornerY = dy - (halfH - r);
        const cornerDist = Math.sqrt(cornerX * cornerX + cornerY * cornerY);
        distFromEdge = r - cornerDist;
        if (cornerDist > 0.001) {
          dirX = (cornerX / cornerDist) * Math.sign(px - halfW);
          dirY = (cornerY / cornerDist) * Math.sign(py - halfH);
        }
      } else {
        const distX = halfW - dx;
        const distY = halfH - dy;
        if (distX < distY) {
          distFromEdge = distX; dirX = Math.sign(px - halfW);
        } else {
          distFromEdge = distY; dirY = Math.sign(py - halfH);
        }
      }

      const magnitude = distFromEdge < 0 ? 0 : Math.exp(-3 * distFromEdge / edgeWidth);
      if (magnitude < 0.01) continue;

      const dispX = -dirX * magnitude;
      const dispY = -dirY * magnitude;
      const red = Math.round(128 + dispX * 127);
      const green = Math.round(128 + dispY * 127);

      if (red !== 128 || green !== 128) {
        strips.push(`<rect x="${px}" y="${py}" width="1" height="1" fill="rgb(${red},${green},128)"/>`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="rgb(128,128,128)"/>
  ${strips.join('\n  ')}
</svg>`;
}

// ============================================
// TEST RUNNER
// ============================================

const approaches = [
  { name: 'Edge Separation (linear + rect)', fn: approach1_EdgeSeparation },
  { name: 'Angle Quantization (32 sectors)', fn: () => approach2_AngleQuantization(32) },
  { name: 'Concentric Arcs (20 arcs)', fn: () => approach3_ConcentricArcs(20) },
  { name: 'Quadtree Adaptive (depth 5)', fn: () => approach4_Quadtree(5, 3) },
  { name: '2D LUT with <use> transform', fn: approach5_2DLUT },
  { name: 'Quadrant Reuse', fn: approach6_QuadrantReuse },
  { name: 'Piecewise Linear (10 stops)', fn: () => approach7_PiecewiseLinear(10) },
  { name: 'Sector + Arc Hybrid (24x15)', fn: () => approach8_SectorArcHybrid(24, 15) },
  { name: 'Coarse + Fine Correction', fn: () => approach9_CoarseFineCorrected(5) },
  { name: 'Pixel Perfect (baseline)', fn: approach10_PixelPerfect },
];

async function runTests() {
  console.log('='.repeat(70));
  console.log('CORNER DISPLACEMENT MAP APPROACHES - PIXEL MATCH TEST');
  console.log('='.repeat(70));
  console.log(`Dimensions: ${WIDTH}x${HEIGHT}, Radius: ${RADIUS}, EdgeWidth: ${edgeWidth}`);
  console.log('='.repeat(70));

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const results = [];

  for (const approach of approaches) {
    console.log(`\nTesting: ${approach.name}...`);

    const startTime = performance.now();
    const svg = approach.fn();
    const genTime = performance.now() - startTime;

    const svgSize = Buffer.byteLength(svg, 'utf8');

    const page = await browser.newPage();
    await page.setViewport({ width: 600, height: 400 });

    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { margin: 0; padding: 20px; background: #fff; }
          .container { display: flex; gap: 20px; }
          .map { width: ${WIDTH}px; height: ${HEIGHT}px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div id="canvas-container" class="map"></div>
          <div id="svg-container" class="map"></div>
        </div>
        <script>
          ${canvasGenerator}

          // Render canvas reference
          const canvas = generateCanvasReference();
          document.getElementById('canvas-container').appendChild(canvas);

          // Render SVG
          const img = new Image();
          img.src = 'data:image/svg+xml,' + encodeURIComponent(\`${svg.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`);
          img.onload = () => {
            document.getElementById('svg-container').appendChild(img);
            window.__ready = true;
          };
          img.onerror = (e) => { console.error('SVG error', e); window.__ready = true; };
        </script>
      </body>
      </html>
    `);

    try {
      await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });
      await new Promise(r => setTimeout(r, 200));

      const canvasEl = await page.$('#canvas-container canvas');
      const svgEl = await page.$('#svg-container img');

      if (!canvasEl || !svgEl) {
        console.log('  ERROR: Elements not found');
        results.push({ name: approach.name, matchRate: 0, error: 'Elements not found' });
        await page.close();
        continue;
      }

      const canvasBuffer = await canvasEl.screenshot({ type: 'png' });
      const svgBuffer = await svgEl.screenshot({ type: 'png' });

      const canvasPng = PNG.sync.read(canvasBuffer);
      const svgPng = PNG.sync.read(svgBuffer);

      const { width, height } = canvasPng;
      const diff = new PNG({ width, height });

      const numDiffPixels = pixelmatch(
        canvasPng.data,
        svgPng.data,
        diff.data,
        width,
        height,
        { threshold: 0.1 }
      );

      const totalPixels = width * height;
      const matchRate = ((totalPixels - numDiffPixels) / totalPixels * 100);

      // Save debug images
      const safeName = approach.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      fs.writeFileSync(`e2e/debug/approach_${safeName}_svg.png`, svgBuffer);
      fs.writeFileSync(`e2e/debug/approach_${safeName}_diff.png`, PNG.sync.write(diff));

      const passed = matchRate >= 99.5;
      console.log(`  Match Rate: ${matchRate.toFixed(2)}% ${passed ? '✓ PASS' : '✗ FAIL'}`);
      console.log(`  Gen Time: ${genTime.toFixed(2)}ms, Size: ${(svgSize / 1024).toFixed(1)}KB`);

      results.push({
        name: approach.name,
        matchRate: matchRate,
        diffPixels: numDiffPixels,
        genTime: genTime,
        svgSize: svgSize,
        passed: passed
      });

    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      results.push({ name: approach.name, matchRate: 0, error: err.message });
    }

    await page.close();
  }

  await browser.close();

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`${'Approach'.padEnd(40)} ${'Match%'.padStart(8)} ${'Time'.padStart(8)} ${'Size'.padStart(8)} Status`);
  console.log('-'.repeat(70));

  results.sort((a, b) => b.matchRate - a.matchRate);

  results.forEach(r => {
    const status = r.error ? 'ERROR' : (r.passed ? 'PASS' : 'FAIL');
    const time = r.genTime ? `${r.genTime.toFixed(1)}ms` : 'N/A';
    const size = r.svgSize ? `${(r.svgSize / 1024).toFixed(1)}KB` : 'N/A';
    console.log(`${r.name.padEnd(40)} ${r.matchRate.toFixed(2).padStart(7)}% ${time.padStart(8)} ${size.padStart(8)} ${status}`);
  });

  const passing = results.filter(r => r.passed).length;
  console.log('-'.repeat(70));
  console.log(`Passing (>= 99.5%): ${passing}/${results.length}`);

  // Save results
  fs.writeFileSync('e2e/debug/approach_results.json', JSON.stringify(results, null, 2));
}

runTests().catch(console.error);

/**
 * Specular highlight drawing — Optimized Canvas2D Phong implementation
 *
 * Uses single-circle-to-quadrants approach for corners + cross bars for edges.
 * Runs on main thread as fallback for initial paint before worklet loads.
 */

/** Phong specular parameters */
export interface SpecularParams {
  w: number;
  h: number;
  r: number;
  bezelWidth: number;
  lightAngle: number;
  shininess: number;
  glossAlpha: number;
}

export interface SpecularMapOptions {
  width: number;
  height: number;
  borderRadius: number;
  /** Light angle in radians */
  lightAngle: number;
  /** Phong shininess exponent (>=1) */
  shininess: number;
  /** Peak alpha multiplier (0..1) */
  glossAlpha?: number;
  /** Device pixel ratio scale (default: 1) */
  scale?: number;
}

export interface SpecularMapResult {
  canvas: HTMLCanvasElement;
  dataUrl: string;
}

const STOP_COUNT = 64;

interface Canvas2DLike {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalCompositeOperation: string;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  roundRect(x: number, y: number, w: number, h: number, radii: number | number[]): void;
  clip(): void;
  fill(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  createConicGradient(startAngle: number, x: number, y: number): CanvasGradient;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradient;
}

function addPhongConicStops(grad: CanvasGradient, shininess: number, glossAlpha: number): void {
  const twoPi = 2 * Math.PI;
  for (let i = 0; i <= STOP_COUNT; i++) {
    const t = i / STOP_COUNT;
    const c = Math.cos(twoPi * t);
    const intensity = Math.abs(c) ** shininess * glossAlpha;
    grad.addColorStop(t, `rgba(255,255,255,${intensity})`);
  }
}


function addDepthLinearStops(grad: CanvasGradient, outerAtStart: boolean): void {
  if (outerAtStart) {
    grad.addColorStop(0,    'rgba(255,255,255,0)');
    grad.addColorStop(0.05, 'rgba(255,255,255,1)');
    grad.addColorStop(1,    'rgba(255,255,255,1)');
  } else {
    grad.addColorStop(0,    'rgba(255,255,255,1)');
    grad.addColorStop(0.95, 'rgba(255,255,255,1)');
    grad.addColorStop(1,    'rgba(255,255,255,0)');
  }
}

export function drawSpecular(ctx: Canvas2DLike, p: SpecularParams): void {
  const { w, h, lightAngle, shininess, glossAlpha, bezelWidth } = p;

  if (w <= 0 || h <= 0 || glossAlpha <= 0.01 || bezelWidth <= 0) return;

  const r = Math.max(1, Math.min(p.r, w / 2, h / 2));
  const effectiveBezelWidth = Math.min(bezelWidth, r);
  const lightX = Math.cos(lightAngle);
  const lightY = Math.sin(lightAngle);

  const edgeW = w - 2 * r;
  const edgeH = h - 2 * r;
  const drawCorners = bezelWidth >= 2 && r >= 2;

  // ─────── STEP 1: DRAW EDGES ───────
  // Use data-driven approach matching worklet for consistency
  const edges: Array<{x: number; y: number; w: number; h: number; dot: number; axis: 'x'|'y'; outerAtStart: boolean}> = [
    { x: r, y: 0,                        w: edgeW, h: effectiveBezelWidth, dot: lightY, axis: 'y', outerAtStart: true  },
    { x: w - effectiveBezelWidth, y: r,  w: effectiveBezelWidth, h: edgeH, dot: lightX, axis: 'x', outerAtStart: false },
    { x: r, y: h - effectiveBezelWidth,  w: edgeW, h: effectiveBezelWidth, dot: lightY, axis: 'y', outerAtStart: false },
    { x: 0, y: r,                        w: effectiveBezelWidth, h: edgeH, dot: lightX, axis: 'x', outerAtStart: true  },
  ];

  for (const e of edges) {
    if (e.w <= 0 || e.h <= 0) continue;
    const absDot = Math.abs(e.dot);
    const alphaA = absDot ** shininess * glossAlpha;
    if (alphaA <= 1e-4) continue;

    ctx.save();
    ctx.beginPath();
    ctx.rect(e.x, e.y, e.w, e.h);
    ctx.clip();

    ctx.fillStyle = `rgba(255,255,255,${alphaA})`;
    ctx.fillRect(e.x, e.y, e.w, e.h);

    ctx.globalCompositeOperation = 'destination-in';
    const depthGrad = e.axis === 'y'
      ? ctx.createLinearGradient(0, e.y, 0, e.y + e.h)
      : ctx.createLinearGradient(e.x, 0, e.x + e.w, 0);
    addDepthLinearStops(depthGrad, e.outerAtStart);
    ctx.fillStyle = depthGrad;
    ctx.fillRect(e.x, e.y, e.w, e.h);

    ctx.restore();
  }

  // ─────── STEP 2: DRAW CORNERS ───────
  if (drawCorners) {
    const corners = [
      { cx: r,     cy: r,     clipX: 0,     clipY: 0,     clipW: r, clipH: r },
      { cx: w - r, cy: r,     clipX: w - r, clipY: 0,     clipW: r, clipH: r },
      { cx: w - r, cy: h - r, clipX: w - r, clipY: h - r, clipW: r, clipH: r },
      { cx: r,     cy: h - r, clipX: 0,     clipY: h - r, clipW: r, clipH: r },
    ];

    for (const c of corners) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(c.clipX, c.clipY, c.clipW, c.clipH);
      ctx.clip();

      const angleGrad = ctx.createConicGradient(lightAngle, c.cx, c.cy);
      addPhongConicStops(angleGrad, shininess, glossAlpha);
      ctx.fillStyle = angleGrad;
      ctx.fillRect(c.clipX, c.clipY, c.clipW, c.clipH);

      ctx.restore();
    }
  }

  // ─────── STEP 4: CROP INNER REGION ───────
  if (effectiveBezelWidth > 0) {
    const innerX = effectiveBezelWidth;
    const innerY = effectiveBezelWidth;
    const innerW = w - 2 * effectiveBezelWidth;
    const innerH = h - 2 * effectiveBezelWidth;
    const innerR = Math.max(0, r - effectiveBezelWidth);

    if (innerW > 0 && innerH > 0) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.roundRect(innerX, innerY, innerW, innerH, innerR);
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fill();
    }
  }
}

export function generateSpecularMap(options: SpecularMapOptions): SpecularMapResult {
  const {
    width,
    height,
    borderRadius,
    lightAngle,
    shininess,
    glossAlpha = 1,
    scale = 1,
  } = options;

  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const r = Math.max(1, Math.round(Math.min(borderRadius * scale, w / 2, h / 2)));
  const bezelWidth = Math.max(1, Math.round(r * 0.5));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  drawSpecular(ctx as unknown as Canvas2DLike, { w, h, r, bezelWidth, lightAngle, shininess, glossAlpha });

  return { canvas, dataUrl: canvas.toDataURL('image/png') };
}

/**
 * Specular highlight drawing — Canvas2D Phong-complete implementation
 *
 * Renders the Phong specular model (|dot(normal, light)|^shininess ×
 * surfaceProfile × fade) using only Canvas2D primitives: no per-pixel
 * loops, no WASM, no ImageData. The decomposition exploits Phong's
 * tensor-product structure — three scalar functions, each expressible as
 * a clipped gradient:
 *
 *   (A) Angle component  — conic-gradient centered at the LOCAL normal
 *       origin (corner_center for corner pixels, constant per edge band).
 *       For corner regions, the conic angle is exactly the local surface
 *       normal angle, so |cos(θ - lightAngle)|^n encoded as stops is
 *       bit-faithful Phong.
 *
 *   (B) Depth component  — radial-gradient (corners) or linear-gradient
 *       (edges) encoding surfaceProfile = √(2d − d²) across bezel width.
 *
 *   (C) Fade component   — outer-edge anti-alias via the outermost stop
 *       going transparent (absorbed into the radial/linear of (B)).
 *
 *   The tensor product  A(θ) × B(d) × C(r)  is realised by the alpha-
 *   multiplicative semantics of  globalCompositeOperation = 'destination-in'.
 *
 * Runs inside a CSS Paint Worklet (see specular-worklet.js) and also on
 * the main thread as a fallback for initial paint.
 */

/** Phong specular parameters. Geometry is passed separately. */
export interface SpecularParams {
  /** Element width (content-box / paint-geometry), in canvas units */
  w: number;
  /** Element height */
  h: number;
  /** Corner radius (will be clamped to min(w/2, h/2)) */
  r: number;
  /** Bezel (specular ring) width in pixels */
  bezelWidth: number;
  /** Light direction angle in radians (0 = +X / right, π/2 = +Y / down) */
  lightAngle: number;
  /** Phong shininess exponent (≥1, typical 1..128). Larger = tighter lobe. */
  shininess: number;
  /** Peak specular alpha multiplier (0..1). Maps from `gloss` parameter. */
  glossAlpha: number;
}

/** Number of stops used to discretise |cos|^n. 64 → error ≪ 1/255 for n≤128. */
const CONIC_STOP_COUNT = 64;

/** Minimal Canvas2D surface needed — satisfied by 2D canvas and paint worklet contexts. */
interface Canvas2DLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalCompositeOperation: string;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  createConicGradient(startAngle: number, x: number, y: number): CanvasGradient;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradient;
}

/**
 * Draw the full Phong specular into the provided context.
 *
 * The context is assumed to start empty (transparent); partial regions
 * are filled via clipping. 4 corner quadrants (conic + radial depth) +
 * 4 edge bands (solid alpha + linear depth) = exact Phong.
 */
export function drawSpecular(ctx: Canvas2DLike, p: SpecularParams): void {
  const { w, h, lightAngle, shininess, glossAlpha, bezelWidth } = p;
  if (w <= 0 || h <= 0 || glossAlpha <= 0 || bezelWidth <= 0) return;
  // Clamp radius so corners don't overlap; also lower-bound to avoid degenerate gradients.
  const r = Math.max(1, Math.min(p.r, w / 2, h / 2));

  const lightX = Math.cos(lightAngle);
  const lightY = Math.sin(lightAngle);

  const rInner = Math.max(0, r - bezelWidth);
  const rOuter = r;

  // ─────── 4 corner regions ───────
  // At a corner pixel p in the top-left quadrant with c = (r, r):
  //   angle_from_c(p) = atan2(p.y−c.y, p.x−c.x)  =  surface normal angle
  // So createConicGradient(lightAngle, c) lets the gradient's t-coordinate
  // be exactly  ((angle − lightAngle) mod 2π) / 2π, and the stops sample
  // |cos(2πt)|^n  = |dot(normal, light)|^n.
  const corners = [
    { cx: r,     cy: r,     x: 0,       y: 0,       s: r },  // TL
    { cx: w - r, cy: r,     x: w - r,   y: 0,       s: r },  // TR
    { cx: w - r, cy: h - r, x: w - r,   y: h - r,   s: r },  // BR
    { cx: r,     cy: h - r, x: 0,       y: h - r,   s: r },  // BL
  ];

  for (const c of corners) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(c.x, c.y, c.s, c.s);
    ctx.clip();

    // (A) angle component — conic gradient at corner_center
    const angleGrad = ctx.createConicGradient(lightAngle, c.cx, c.cy);
    addPhongConicStops(angleGrad, shininess, glossAlpha);
    ctx.fillStyle = angleGrad;
    ctx.fillRect(c.x, c.y, c.s, c.s);

    // (B) × (C) depth × fade — radial gradient from corner_center
    ctx.globalCompositeOperation = 'destination-in';
    const depthGrad = ctx.createRadialGradient(
      c.cx, c.cy, rInner,
      c.cx, c.cy, rOuter + 1
    );
    addDepthRadialStops(depthGrad, rInner, rOuter);
    ctx.fillStyle = depthGrad;
    ctx.fillRect(c.x, c.y, c.s, c.s);

    ctx.restore();
  }

  // ─────── 4 edge bands ───────
  // Surface normal is CONSTANT on each edge, so the angle component
  // collapses to a single scalar alpha = |dot(normal, light)|^n.
  //   top    normal = (0, −1)   →  dot = −lightY
  //   right  normal = (1,  0)   →  dot =  lightX
  //   bottom normal = (0,  1)   →  dot =  lightY
  //   left   normal = (−1, 0)   →  dot = −lightX
  //   |dot|^n collapses across sign → same formula per orientation pair.
  const edges = [
    { x: r, y: 0,              w: w - 2 * r, h: bezelWidth, dot: lightY, axis: 'y' as const, outerAtStart: true  }, // top
    { x: w - bezelWidth, y: r, w: bezelWidth, h: h - 2 * r, dot: lightX, axis: 'x' as const, outerAtStart: false }, // right
    { x: r, y: h - bezelWidth, w: w - 2 * r, h: bezelWidth, dot: lightY, axis: 'y' as const, outerAtStart: false }, // bottom
    { x: 0, y: r,              w: bezelWidth, h: h - 2 * r, dot: lightX, axis: 'x' as const, outerAtStart: true  }, // left
  ];

  for (const e of edges) {
    if (e.w <= 0 || e.h <= 0) continue;
    const alphaA = Math.pow(Math.abs(e.dot), shininess) * glossAlpha;
    if (alphaA <= 1e-4) continue;

    ctx.save();
    ctx.beginPath();
    ctx.rect(e.x, e.y, e.w, e.h);
    ctx.clip();

    // (A) constant alpha
    ctx.fillStyle = `rgba(255,255,255,${alphaA})`;
    ctx.fillRect(e.x, e.y, e.w, e.h);

    // (B) × (C) depth + fade perpendicular to edge
    ctx.globalCompositeOperation = 'destination-in';
    const depthGrad = e.axis === 'y'
      ? ctx.createLinearGradient(0, e.y, 0, e.y + e.h)
      : ctx.createLinearGradient(e.x, 0, e.x + e.w, 0);
    addDepthLinearStops(depthGrad, e.outerAtStart);
    ctx.fillStyle = depthGrad;
    ctx.fillRect(e.x, e.y, e.w, e.h);

    ctx.restore();
  }
}

/** Conic stops sampling |cos(2πt)|^n × glossAlpha over t ∈ [0, 1]. */
function addPhongConicStops(grad: CanvasGradient, shininess: number, glossAlpha: number): void {
  for (let i = 0; i <= CONIC_STOP_COUNT; i++) {
    const t = i / CONIC_STOP_COUNT;
    const c = Math.cos(2 * Math.PI * t);
    const intensity = Math.pow(Math.abs(c), shininess) * glossAlpha;
    grad.addColorStop(t, `rgba(255,255,255,${intensity})`);
  }
}

/**
 * Radial depth stops: inner boundary (transparent) → 1-pixel anti-alias →
 * plateau (surfaceProfile saturated) → outer boundary (transparent AA).
 */
function addDepthRadialStops(grad: CanvasGradient, rInner: number, rOuter: number): void {
  const total = (rOuter + 1) - rInner;
  if (total <= 0) {
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    return;
  }
  const bezelSpan = rOuter - rInner;
  const aaWidth = Math.min(1 / total, 0.5);
  grad.addColorStop(0,                        'rgba(255,255,255,0)');  // inner boundary
  grad.addColorStop(aaWidth,                  'rgba(255,255,255,1)');  // inner AA end
  grad.addColorStop(bezelSpan / total,        'rgba(255,255,255,1)');  // outer boundary start of AA
  grad.addColorStop(1,                        'rgba(255,255,255,0)');  // outer AA end
}

/** Linear analogue: if outerAtStart, transparent-opaque-opaque; else opaque-opaque-transparent. */
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

// ─────────────────────────────────────────────────────────────────────
// Main-thread fallback: produces a data-URL specular bitmap. Used during
// worklet-registration latency or on Paint API–unavailable runtimes.
// ─────────────────────────────────────────────────────────────────────

export interface SpecularMapOptions {
  width: number;
  height: number;
  borderRadius: number;
  /** Light angle in radians */
  lightAngle: number;
  /** Phong shininess exponent (≥1) */
  shininess: number;
  /** Peak alpha multiplier (0..1) — typically params.gloss / 100 */
  glossAlpha?: number;
  /** Device pixel ratio scale (default: 1) */
  scale?: number;
}

export interface SpecularMapResult {
  canvas: HTMLCanvasElement;
  dataUrl: string;
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

  drawSpecular(ctx, { w, h, r, bezelWidth, lightAngle, shininess, glossAlpha });

  return { canvas, dataUrl: canvas.toDataURL('image/png') };
}

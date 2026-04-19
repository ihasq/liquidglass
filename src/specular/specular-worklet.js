/**
 * CSS Paint Worklet: liquid-glass-specular
 *
 * Renders the Phong specular model exclusively with Canvas2D primitives
 * (clip + gradient + destination-in), no per-pixel loop. See
 * highlight.ts for the full algorithmic derivation.
 *
 * Registered inputs (all @property-typed CSS custom properties):
 *   --lg-spec-angle      <angle>   light direction (e.g. -60deg)
 *   --lg-spec-shininess  <number>  Phong exponent (1..128)
 *   --lg-spec-width      <length>  bezel width in px
 *   --lg-spec-gloss      <number>  peak alpha 0..1
 *   --lg-spec-radius     <length>  corner radius in px
 *
 * Browser contract:
 *   The browser re-invokes paint() automatically when any inputProperty
 *   or element geometry changes — replacing our JS ResizeObserver +
 *   cache-invalidation state machine.
 */

const STOP_COUNT = 64;

function addPhongConicStops(grad, shininess, glossAlpha) {
  const twoPi = 2 * Math.PI;
  for (let i = 0; i <= STOP_COUNT; i++) {
    const t = i / STOP_COUNT;
    const c = Math.cos(twoPi * t);
    // Math.pow(Math.abs(c), shininess) inlined for hot path
    const intensity = (c < 0 ? -c : c) ** shininess * glossAlpha;
    grad.addColorStop(t, `rgba(255,255,255,${intensity})`);
  }
}

function addDepthRadialStops(grad, rInner, rOuter) {
  const total = (rOuter + 1) - rInner;
  if (total <= 0) {
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    return;
  }
  const bezelSpan = rOuter - rInner;
  const aaWidth = Math.min(1 / total, 0.5);
  grad.addColorStop(0,                  'rgba(255,255,255,0)');
  grad.addColorStop(aaWidth,            'rgba(255,255,255,1)');
  grad.addColorStop(bezelSpan / total,  'rgba(255,255,255,1)');
  grad.addColorStop(1,                  'rgba(255,255,255,0)');
}

function addDepthLinearStops(grad, outerAtStart) {
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

function drawSpecular(ctx, p) {
  const { w, h, lightAngle, shininess, glossAlpha, bezelWidth } = p;

  // Early return for invisible or degenerate cases
  if (w <= 0 || h <= 0 || glossAlpha <= 0.01 || bezelWidth <= 0) return;

  const r = Math.max(1, Math.min(p.r, w / 2, h / 2));
  const lightX = Math.cos(lightAngle);
  const lightY = Math.sin(lightAngle);
  const rInner = Math.max(0, r - bezelWidth);
  const rOuter = r;

  // Skip corners if bezel is too thin (< 2px) — edges alone suffice
  const drawCorners = bezelWidth >= 2 && r >= 2;

  if (drawCorners) {
    // 4 corner regions — conic + radial depth
    const corners = [
      { cx: r,     cy: r,     x: 0,     y: 0,     s: r },
      { cx: w - r, cy: r,     x: w - r, y: 0,     s: r },
      { cx: w - r, cy: h - r, x: w - r, y: h - r, s: r },
      { cx: r,     cy: h - r, x: 0,     y: h - r, s: r },
    ];
    for (const c of corners) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(c.x, c.y, c.s, c.s);
      ctx.clip();

      const angleGrad = ctx.createConicGradient(lightAngle, c.cx, c.cy);
      addPhongConicStops(angleGrad, shininess, glossAlpha);
      ctx.fillStyle = angleGrad;
      ctx.fillRect(c.x, c.y, c.s, c.s);

      ctx.globalCompositeOperation = 'destination-in';
      const depthGrad = ctx.createRadialGradient(c.cx, c.cy, rInner, c.cx, c.cy, rOuter + 1);
      addDepthRadialStops(depthGrad, rInner, rOuter);
      ctx.fillStyle = depthGrad;
      ctx.fillRect(c.x, c.y, c.s, c.s);

      ctx.restore();
    }
  }

  // 4 edge bands — constant-alpha + linear depth
  const edges = [
    { x: r, y: 0,              w: w - 2 * r, h: bezelWidth, dot: lightY, axis: 'y', outerAtStart: true  },
    { x: w - bezelWidth, y: r, w: bezelWidth, h: h - 2 * r, dot: lightX, axis: 'x', outerAtStart: false },
    { x: r, y: h - bezelWidth, w: w - 2 * r, h: bezelWidth, dot: lightY, axis: 'y', outerAtStart: false },
    { x: 0, y: r,              w: bezelWidth, h: h - 2 * r, dot: lightX, axis: 'x', outerAtStart: true  },
  ];
  for (const e of edges) {
    if (e.w <= 0 || e.h <= 0) continue;
    // Inline Math.pow(Math.abs(e.dot), shininess) for hot path
    const absDot = e.dot < 0 ? -e.dot : e.dot;
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
}

/** CSS value parsing helpers. Worklet props come as CSSUnitValue or tokens. */
function cssNumber(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'number') return v;
  if ('value' in v) return v.value;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

class LiquidGlassSpecular {
  // Observe the same CSS properties the schema already defines, plus a
  // radius value the driver mirrors from the element's border-radius.
  static get inputProperties() {
    return [
      '--liquidglass-specular-angle',
      '--liquidglass-specular-shininess',
      '--liquidglass-specular-width',
      '--liquidglass-gloss',
      '--liquidglass-radius',
    ];
  }

  static get contextOptions() {
    return { alpha: true };
  }

  paint(ctx, geom, props) {
    const w = geom.width;
    const h = geom.height;
    // angle in deg → rad
    const angleDeg = cssNumber(props.get('--liquidglass-specular-angle'), -60);
    const shininess = Math.max(1, cssNumber(props.get('--liquidglass-specular-shininess'), 8));
    const bezelWidth = Math.max(1, cssNumber(props.get('--liquidglass-specular-width'), 2));
    // gloss is 0..100 in schema; convert to 0..1 alpha
    const gloss100 = cssNumber(props.get('--liquidglass-gloss'), 50);
    const radius = Math.max(1, cssNumber(props.get('--liquidglass-radius'), 24));

    drawSpecular(ctx, {
      w, h,
      r: radius,
      bezelWidth,
      lightAngle: (angleDeg * Math.PI) / 180,
      shininess,
      glossAlpha: Math.max(0, Math.min(1, gloss100 / 100)),
    });
  }
}

registerPaint('liquid-glass-specular', LiquidGlassSpecular);

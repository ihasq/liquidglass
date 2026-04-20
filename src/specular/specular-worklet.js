/**
 * CSS Paint Worklet: liquid-glass-specular
 *
 * Renders the Phong specular model exclusively with Canvas2D primitives
 * (clip + gradient + destination-in), no per-pixel loop.
 */

const STOP_COUNT = 64;

function addPhongConicStops(grad, shininess, glossAlpha) {
  const twoPi = 2 * Math.PI;
  for (let i = 0; i <= STOP_COUNT; i++) {
    const t = i / STOP_COUNT;
    const c = Math.cos(twoPi * t);
    const intensity = (c < 0 ? -c : c) ** shininess * glossAlpha;
    grad.addColorStop(t, `rgba(255,255,255,${intensity})`);
  }
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

  if (w <= 0 || h <= 0 || glossAlpha <= 0.01 || bezelWidth <= 0) return;

  const r = Math.max(1, Math.min(p.r, w / 2, h / 2));
  const effectiveBezelWidth = Math.min(bezelWidth, r);
  const lightX = Math.cos(lightAngle);
  const lightY = Math.sin(lightAngle);
  const drawCorners = bezelWidth >= 2 && r >= 2;

  // ─────── STEP 1: DRAW EDGES ───────
  const edges = [
    { x: r, y: 0,                        w: w - 2 * r, h: effectiveBezelWidth, dot: lightY, axis: 'y', outerAtStart: true  },
    { x: w - effectiveBezelWidth, y: r,  w: effectiveBezelWidth, h: h - 2 * r, dot: lightX, axis: 'x', outerAtStart: false },
    { x: r, y: h - effectiveBezelWidth,  w: w - 2 * r, h: effectiveBezelWidth, dot: lightY, axis: 'y', outerAtStart: false },
    { x: 0, y: r,                        w: effectiveBezelWidth, h: h - 2 * r, dot: lightX, axis: 'x', outerAtStart: true  },
  ];

  for (const e of edges) {
    if (e.w <= 0 || e.h <= 0) continue;
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

  // ─────── STEP 3: CROP INNER REGION ───────
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

function cssNumber(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'number') return v;
  if ('value' in v) return v.value;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

class LiquidGlassSpecular {
  static get inputProperties() {
    return [
      '--glass-specular-angle',
      '--glass-specular-angle-local', // Transform-compensated angle (set by driver)
      '--glass-specular-shininess',
      '--glass-specular-width',
      '--glass-gloss',
      '--glass-radius',
      '--glass-device-pixel-ratio', // Device pixel ratio for physical pixel sizing
    ];
  }

  static get contextOptions() {
    return { alpha: true };
  }

  paint(ctx, geom, props) {
    const w = geom.width;
    const h = geom.height;
    // Prefer local (transform-compensated) angle, fall back to world angle
    const localAngleRaw = props.get('--glass-specular-angle-local');
    const worldAngleRaw = props.get('--glass-specular-angle');
    const angleDeg = localAngleRaw && String(localAngleRaw).trim() !== ''
      ? cssNumber(localAngleRaw, -60)
      : cssNumber(worldAngleRaw, -60);
    const shininess = Math.max(1, cssNumber(props.get('--glass-specular-shininess'), 8));
    const bezelWidthRaw = Math.max(0.1, cssNumber(props.get('--glass-specular-width'), 2));
    const gloss100 = cssNumber(props.get('--glass-gloss'), 50);
    const radius = Math.max(1, cssNumber(props.get('--glass-radius'), 24));

    // Convert bezelWidth from physical pixels to CSS pixels
    // bezelWidth is specified in device pixels, divide by dpr to get CSS pixels
    const dpr = Math.max(1, cssNumber(props.get('--glass-device-pixel-ratio'), 1));
    const bezelWidth = bezelWidthRaw / dpr;

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

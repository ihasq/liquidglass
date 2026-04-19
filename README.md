<p align="center">
  <img src="https://raw.githubusercontent.com/ihasq/liquidglass.css/main/assets/logo.svg" alt="liquidglass.css" width="400">
</p>

<h1 align="center">liquidglass.css</h1>

<p align="center">
  <strong>Liquid glass effect, as CSS properties. As it should be.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/liquidglass.css"><img src="https://img.shields.io/npm/v/liquidglass.css.svg?style=flat-square&color=00d4ff" alt="npm version"></a>
  <a href="https://bundlephobia.com/package/liquidglass.css"><img src="https://img.shields.io/bundlephobia/minzip/liquidglass.css?style=flat-square&color=00d4ff" alt="bundle size"></a>
  <a href="https://github.com/ihasq/liquidglass.css/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/liquidglass.css?style=flat-square&color=00d4ff" alt="license"></a>
</p>

<br>

```css
.card {
  --liquidglass-refraction: 80%;
  --liquidglass-thickness: 50%;
  --liquidglass-softness: 15%;
  --liquidglass-gloss: 60%;
  --liquidglass-saturation: 45%;
  --liquidglass-dispersion: 30%;
  --liquidglass-specular-angle: -60deg;
  --liquidglass-specular-width: 2px;
  border-radius: 20px;
}
```

<p align="center">
  <img src="https://raw.githubusercontent.com/ihasq/liquidglass.css/main/assets/demo.gif" alt="Demo" width="600">
</p>

---

## Features

- **Typed CSS Custom Properties** — Registered via `@property` so values
  accept their canonical units (`<length>`, `<percentage>`, `<angle>`)
- **Physics-Based** — Snell's law refraction, not blur approximation
- **GPU-First Renderer** — WebGPU → WebGL2 → WASM-SIMD auto-fallback
- **CSS Paint Worklet Specular** — Phong highlight via Canvas2D, no
  per-pixel loop, repaints on geometry/parameter change automatically
- **Auto Radius Tracking** — `border-radius` is mirrored to
  `--liquidglass-radius` via a global MutationObserver + ResizeObserver
- **Framework Agnostic** — Works with React, Vue, Svelte, or vanilla
- **Adaptive Performance** — Smart throttling at scale

## Quick Start

```bash
npm install liquidglass.css
```

One import. That's it.

```js
import "liquidglass.css";
```

```css
.glass-panel {
  --liquidglass-refraction: 60%;
  --liquidglass-thickness: 50%;
  --liquidglass-softness: 15%;
  border-radius: 24px;
}
```

`border-radius` is observed automatically — you don't have to keep
`--liquidglass-radius` in sync. Bare numbers (e.g. `60` instead of
`60%`) are also accepted for backward compatibility.

```html
<div class="glass-panel">
  Your content here
</div>
```

## Parameters

All parameters are registered as typed CSS Custom Properties. Each
prefix is `--liquidglass-`.

### Surface

| Property | Unit | Range | Default | Description |
|----------|------|-------|---------|-------------|
| `refraction` | `<percentage>` | 0–100 | 50 | Lens distortion intensity |
| `thickness` | `<percentage>` | 0–100 | 50 | Edge steepness / glass depth |
| `softness` | `<percentage>` | 0–100 | 10 | Background blur amount |
| `gloss` | `<percentage>` | 0–100 | 50 | Specular highlight intensity |
| `saturation` | `<percentage>` | 0–100 | 45 | Color saturation boost |
| `dispersion` | `<percentage>` | 0–100 | 30 | Chromatic edge blur |

### Specular (CSS Paint Worklet)

| Property | Unit | Range | Default | Description |
|----------|------|-------|---------|-------------|
| `specular-angle` | `<angle>` | -180–180 | -60deg | Light direction |
| `specular-width` | `<length>` | 1–50 | 2px | Bezel highlight width |
| `specular-shininess` | `<number>` | 1–128 | 8 | Phong exponent |

### Renderer (advanced)

| Property | Values | Default | Description |
|----------|--------|---------|-------------|
| `displacement-renderer` | `gpu` \| `gl2` \| `wasm` | `gpu` | Displacement backend (auto-fallback) |
| `displacement-resolution` | `<percentage>` | 40 | Map resolution |
| `displacement-min-resolution` | `<percentage>` | 10 | Min resolution during resize |
| `displacement-smoothing` | `<percentage>` | 0 | Map smoothing blur |
| `displacement-refresh-interval` | `<integer>` | 12 | Frame skip during resize |
| `enable-optimization` | 0 \| 1 | 1 | Master optimization toggle |

## Dynamic Updates

Parameters respond to any CSS change:

```css
/* Hover state */
.glass-panel:hover {
  --liquidglass-refraction: 80%;
}

/* Media queries */
@media (prefers-reduced-motion: reduce) {
  .glass-panel {
    --liquidglass-refraction: 0%;
  }
}

/* Complex selectors */
.container > div:nth-child(2) {
  --liquidglass-refraction: 60%;
}
```

Or via JavaScript:

```js
element.style.setProperty('--liquidglass-refraction', '90%');
element.style.setProperty('--liquidglass-specular-angle', '45deg');
element.style.setProperty('--liquidglass-specular-width', '3px');
```

## How It Works

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   1. Renderer (WebGPU / WebGL2 / WASM-SIMD) generates the        │
│      displacement map from border-radius                         │
│                              ↓                                   │
│   2. SVG filter chain (feImage → feDisplacementMap → output)     │
│      refracts the backdrop, with optional slope-blur dispersion  │
│                              ↓                                   │
│   3. CSS Paint Worklet draws the Phong specular bezel directly   │
│      onto the element via Canvas2D — no SVG primitive            │
│                              ↓                                   │
│   4. Adaptive throttling and predictive resize keep it smooth    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

The displacement map encodes refraction vectors:
- **Red channel** → X displacement
- **Green channel** → Y displacement
- **Blue channel** → Edge mask for dispersion

Specular runs on its own paint worklet, so changing
`--liquidglass-specular-*` does not invalidate the displacement
bitmap — and resizing does not rerun the specular path.

## Framework Examples

### React

```tsx
import "liquidglass.css";

function GlassCard({ children }) {
  return (
    <div className="glass-card">
      {children}
    </div>
  );
}
```

```css
.glass-card {
  --liquidglass-refraction: 70%;
  --liquidglass-gloss: 60%;
  border-radius: 20px;
}
```

### Vue

```vue
<script setup>
import "liquidglass.css";
</script>

<template>
  <div class="glass-panel">
    <slot />
  </div>
</template>

<style scoped>
.glass-panel {
  --liquidglass-refraction: 70%;
  --liquidglass-gloss: 60%;
  border-radius: 16px;
}
</style>
```

### Vanilla

```html
<script type="module">
  import "https://unpkg.com/liquidglass.css";
</script>

<div style="
  --liquidglass-refraction: 80%;
  --liquidglass-softness: 20%;
  border-radius: 24px;
">
  Content
</div>
```

## Browser Support

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome | 105+ | Full support (CSS Paint API + backdrop-filter SVG) |
| Edge | 105+ | Full support |
| Safari | — | backdrop-filter SVG not supported |
| Firefox | — | backdrop-filter SVG / CSS Paint API not supported |

> **Note:** Unsupported browsers gracefully fall back to `backdrop-filter: blur(20px)`. The specular bezel layer simply doesn't render when CSS Paint API is missing.

## Performance

- **GPU-First Renderer** — WebGPU when available, WebGL2 next, WASM-SIMD as last resort. Switch explicitly via `--liquidglass-displacement-renderer: gl2;` etc.
- **CSS Paint API Specular** — The browser caches and re-invokes the worklet only when a registered `@property` value or geometry changes. No JS render loop for highlights.
- **Adaptive Throttling** — Rendering intervals scale with element count
- **Viewport Culling** — Off-screen elements pause updates
- **Predictive Rendering** — Anticipates size changes during resize
- **Morph Transitions** — Crossfade prevents jarring updates

## Roadmap

- [x] CSS Houdini paint worklet (specular)
- [x] WebGPU / WebGL2 / WASM-SIMD displacement renderers
- [x] Typed `@property` registration for all parameters
- [ ] Firefox/Safari support via canvas fallback
- [ ] Animated displacement maps
- [ ] Custom displacement textures

## Contributing

```bash
git clone https://github.com/ihasq/liquidglass.css.git
cd liquidglass.css
npm install
npm run dev
```

Open `http://localhost:8788/demo/parameter-lab/` to experiment with all
parameters live (preset library, recorder/replay, renderer switcher).

Quality gates:

```bash
npm run build       # tsc + vite lib build
npm run test        # type / build / SMT / e2e integrity suite
npx knip            # static dead-code analysis
```

## License

MIT License.

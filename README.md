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
  --glass-refraction: 80%;
  --glass-thickness: 50%;
  --glass-softness: 15%;
  --glass-gloss: 60%;
  --glass-saturation: 45%;
  --glass-dispersion: 30%;
  --glass-specular-angle: -60deg;
  --glass-specular-width: 2px;
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
  `--glass-radius` via a global MutationObserver + ResizeObserver
- **Tailwind CSS v4** — Native plugin via `@plugin "liquidglass.css"`
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
  --glass-refraction: 60%;
  --glass-thickness: 50%;
  --glass-softness: 15%;
  border-radius: 24px;
}
```

`border-radius` is observed automatically — you don't have to keep
`--glass-radius` in sync. Bare numbers (e.g. `60` instead of
`60%`) are also accepted for backward compatibility.

```html
<div class="glass-panel">
  Your content here
</div>
```

## Tailwind CSS v4

Native plugin support — same import, just add `@plugin` in CSS.

```js
import "liquidglass.css";
```

```css
@import "tailwindcss";
@plugin "liquidglass.css";
```

```html
<div class="glass-refraction-[80%] glass-thickness-50 glass-softness-[15%] rounded-2xl">
  Your content here
</div>
```

All parameters are available as utilities:

| Utility | CSS Property |
|---------|--------------|
| `glass-refraction-{value}` | `--glass-refraction` |
| `glass-thickness-{value}` | `--glass-thickness` |
| `glass-softness-{value}` | `--glass-softness` |
| `glass-gloss-{value}` | `--glass-gloss` |
| `glass-saturation-{value}` | `--glass-saturation` |
| `glass-dispersion-{value}` | `--glass-dispersion` |
| `glass-specular-angle-{value}` | `--glass-specular-angle` |
| `glass-specular-width-{value}` | `--glass-specular-width` |
| `glass-specular-shininess-{value}` | `--glass-specular-shininess` |
| `glass-{value}` | `--glass-refraction` (shorthand) |

Arbitrary values work: `glass-refraction-[73%]`, `glass-specular-angle-[-45deg]`.

## Parameters

All parameters are registered as typed CSS Custom Properties. Each
prefix is `--glass-`.

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
  --glass-refraction: 80%;
}

/* Media queries */
@media (prefers-reduced-motion: reduce) {
  .glass-panel {
    --glass-refraction: 0%;
  }
}

/* Complex selectors */
.container > div:nth-child(2) {
  --glass-refraction: 60%;
}
```

Or via JavaScript:

```js
element.style.setProperty('--glass-refraction', '90%');
element.style.setProperty('--glass-specular-angle', '45deg');
element.style.setProperty('--glass-specular-width', '3px');
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
`--glass-specular-*` does not invalidate the displacement
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
  --glass-refraction: 70%;
  --glass-gloss: 60%;
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
  --glass-refraction: 70%;
  --glass-gloss: 60%;
  border-radius: 16px;
}
</style>
```

### Vanilla

```html
<script type="module">
  import "https://unpkg.com/liquidglass.css/dist/liquidglass.js";
</script>

<div style="
  --glass-refraction: 80%;
  --glass-softness: 20%;
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

- **GPU-First Renderer** — WebGPU when available, WebGL2 next, WASM-SIMD as last resort. Switch explicitly via `--glass-displacement-renderer: gl2;` etc.
- **CSS Paint API Specular** — The browser caches and re-invokes the worklet only when a registered `@property` value or geometry changes. No JS render loop for highlights.
- **Adaptive Throttling** — Rendering intervals scale with element count
- **Viewport Culling** — Off-screen elements pause updates
- **Predictive Rendering** — Anticipates size changes during resize
- **Morph Transitions** — Crossfade prevents jarring updates

## Roadmap

- [x] CSS Houdini paint worklet (specular)
- [x] WebGPU / WebGL2 / WASM-SIMD displacement renderers
- [x] Typed `@property` registration for all parameters
- [x] Tailwind CSS v4 native plugin
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

Visit [liquidglass-css.pages.dev/labs/](https://liquidglass-css.pages.dev/labs/)
to experiment with parameters live, or run `cd site && npm run dev` locally.

Quality gates:

```bash
npm run build       # tsc + vite lib build
npm run test        # type / build / SMT / e2e integrity suite
npx knip            # static dead-code analysis
```

## Acknowledgments

This project would not have been possible without the groundbreaking work of [**@KubeKhrm**](https://x.com/KubeKhrm) and [**kube.io**](https://kube.io).

His invention goes far beyond simply applying displacement via SVG filters. He identified the precise mathematical formulas required to simulate physically-accurate glass refraction — deriving how border-radius geometry translates into displacement vectors that create the characteristic lens distortion effect. The core technique of encoding these computed refraction vectors into RGB channels and applying them via `feDisplacementMap` — the very heart of liquidglass.css — originated from his brilliant research.

We stand on the shoulders of giants. Thank you, Kube.

## License

MIT License.

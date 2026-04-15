<p align="center">
  <img src="https://raw.githubusercontent.com/user/liquidglass/main/assets/logo.svg" alt="liquidglass.css" width="400">
</p>

<h1 align="center">liquidglass.css</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/liquidglass.css"><img src="https://img.shields.io/npm/v/liquidglass.css.svg?style=flat-square&color=00d4ff" alt="npm version"></a>
  <a href="https://bundlephobia.com/package/liquidglass.css"><img src="https://img.shields.io/bundlephobia/minzip/liquidglass.css?style=flat-square&color=00d4ff" alt="bundle size"></a>
  <a href="https://github.com/user/liquidglass/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/liquidglass.css?style=flat-square&color=00d4ff" alt="license"></a>
</p>

<br>

```css
.card {
  --liquidglass-refraction: 80;
  border-radius: 20px;
}
```

<p align="center">
  <img src="https://raw.githubusercontent.com/user/liquidglass/main/assets/demo.gif" alt="Demo" width="600">
</p>

---

## Features

- **CSS Custom Properties** — `--liquidglass-*` works like any standard CSS property
- **Physics-Based** — Snell's law refraction, not blur approximation
- **WASM SIMD** — Displacement maps in <5ms
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

Now use either approach:

### CSS Custom Properties

```css
.glass-panel {
  --liquidglass-refraction: 60;
  --liquidglass-thickness: 50;
  --liquidglass-softness: 15;
  border-radius: 24px;
}
```

```html
<div class="glass-panel">
  Your content here
</div>
```

### Web Component

```html
<liquid-glass refraction="70" thickness="50" style="border-radius: 20px;">
  <h2>Glass Card</h2>
  <p>Content with lens effect</p>
</liquid-glass>
```

Both work simultaneously. No configuration needed.

## Parameters

| Property | Range | Default | Description |
|----------|-------|---------|-------------|
| `refraction` | 0-100 | 50 | Lens distortion intensity |
| `thickness` | 0-100 | 50 | Edge steepness / glass depth |
| `softness` | 0-100 | 10 | Blur amount at edges |
| `gloss` | 0-100 | 50 | Specular highlight intensity |
| `saturation` | 0-100 | 45 | Color saturation boost |
| `dispersion` | 0-100 | 30 | Chromatic edge blur (like real glass) |

## Dynamic Updates

Parameters respond to any CSS change:

```css
/* Hover state */
.glass-panel:hover {
  --liquidglass-refraction: 80;
}

/* Media queries */
@media (prefers-reduced-motion: reduce) {
  .glass-panel {
    --liquidglass-refraction: 0;
  }
}

/* Complex selectors work too */
.container > div:nth-child(2) {
  --liquidglass-refraction: 60;
}
```

Or via JavaScript:

```js
element.style.setProperty('--liquidglass-refraction', '90');
```

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   1. WASM generates displacement map from border-radius │
│                         ↓                               │
│   2. SVG filter applies feDisplacementMap to backdrop   │
│                         ↓                               │
│   3. Specular highlights add glass-like reflections     │
│                         ↓                               │
│   4. Adaptive throttling keeps it smooth at scale       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

The displacement map encodes refraction vectors:
- **Red channel** → X displacement
- **Green channel** → Y displacement
- **Blue channel** → Edge mask for dispersion

## Framework Examples

### React

```tsx
// main.tsx or App.tsx
import "liquidglass.css";

function GlassCard({ children }) {
  return (
    <div className="glass-card">
      {children}
    </div>
  );
}

// Or use the Web Component directly
function GlassBox() {
  return (
    <liquid-glass refraction="70" style={{ borderRadius: 20 }}>
      Content
    </liquid-glass>
  );
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

  <!-- Or use Web Component -->
  <liquid-glass refraction="80">
    Content
  </liquid-glass>
</template>

<style scoped>
.glass-panel {
  --liquidglass-refraction: 70;
  --liquidglass-gloss: 60;
  border-radius: 16px;
}
</style>
```

### Vanilla

```html
<script type="module">
  import "https://unpkg.com/liquidglass.css";
</script>

<!-- CSS approach -->
<div style="
  --liquidglass-refraction: 80;
  --liquidglass-softness: 20;
  border-radius: 24px;
">
  CSS Custom Properties
</div>

<!-- Web Component approach -->
<liquid-glass refraction="80" style="border-radius: 24px;">
  Web Component
</liquid-glass>
```

## Browser Support

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome | 105+ | Full support |
| Edge | 105+ | Full support |
| Safari | — | backdrop-filter SVG not supported |
| Firefox | — | backdrop-filter SVG not supported |

> **Note:** Unsupported browsers gracefully fall back to `backdrop-filter: blur(20px)`.

## Performance

- **WASM SIMD** — Displacement maps generated in <5ms for typical elements
- **Adaptive Throttling** — Rendering intervals scale with element count
- **Viewport Culling** — Off-screen elements pause updates
- **Predictive Rendering** — Anticipates size changes during resize
- **Morph Transitions** — Crossfade prevents jarring updates

## Roadmap

- [ ] Firefox/Safari support via canvas fallback
- [ ] CSS Houdini paint worklet
- [ ] Animated displacement maps
- [ ] Custom displacement textures
- [ ] React/Vue component wrappers

## Contributing

```bash
git clone https://github.com/user/liquidglass.git
cd liquidglass
npm install
npm run dev
```

Open `http://localhost:5173/demo/parameter-lab.html` to experiment.

## License

MIT License. Use it anywhere.


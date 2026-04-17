export const styles = `
:root {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --accent: #0f3460;
  --highlight: #e94560;
  --text: #eaeaea;
  --text-dim: #8892b0;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

#app {
  display: contents;
}

body {
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
  background: var(--bg-primary);
  color: var(--text);
  display: flex;
  overflow: hidden;
}

.background-content {
  position: fixed;
  inset: -300px;
  z-index: -1;
  will-change: transform;
  pointer-events: none;
}

.control-panel {
  width: 380px;
  min-width: 380px;
  background: rgba(22, 33, 62, 0.95);
  border-right: 1px solid rgba(255,255,255,0.1);
  padding: 24px;
  overflow-y: auto;
  max-height: 100vh;
}

.panel-header { margin-bottom: 24px; }
.panel-header h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
.panel-header p { font-size: 12px; color: var(--text-dim); }

.section { margin-bottom: 28px; }

.section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-dim);
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(255,255,255,0.1);
}

.control { margin-bottom: 16px; }

.control-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.control-label { font-size: 13px; font-weight: 500; }

.control-value {
  font-size: 12px;
  color: var(--highlight);
  font-family: 'SF Mono', Monaco, monospace;
  background: rgba(233, 69, 96, 0.15);
  padding: 2px 8px;
  border-radius: 4px;
}

.control-desc {
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 8px;
}

input[type="range"] {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  background: rgba(255,255,255,0.1);
  border-radius: 3px;
  outline: none;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  background: var(--highlight);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(233, 69, 96, 0.4);
}

input[type="color"] {
  width: 100%;
  height: 36px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  background: transparent;
}

.preset-buttons {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-top: 8px;
}

.preset-btn {
  padding: 10px 12px;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 8px;
  background: rgba(255,255,255,0.05);
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.preset-btn:hover {
  background: rgba(233, 69, 96, 0.2);
  border-color: var(--highlight);
}

.preset-btn.active {
  background: var(--highlight);
  border-color: var(--highlight);
}

.preview-area {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.interactive-element {
  position: absolute;
  cursor: move;
  user-select: none;
}

.interactive-element.selected::before {
  content: '';
  position: absolute;
  inset: -4px;
  border: 2px solid var(--highlight);
  border-radius: inherit;
  pointer-events: none;
}

.interactive-element.dragging { z-index: 1000; }

.interactive-element .glass-panel {
  -webkit-transform: translate3d(0, 0, 0);
  transform: translate3d(0, 0, 0);
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
}

.resize-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: var(--highlight);
  border: 2px solid white;
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 10;
}

.interactive-element.selected .resize-handle,
.interactive-element:hover .resize-handle { opacity: 1; }

.resize-handle.nw { top: -6px; left: -6px; cursor: nw-resize; }
.resize-handle.ne { top: -6px; right: -6px; cursor: ne-resize; }
.resize-handle.sw { bottom: -6px; left: -6px; cursor: sw-resize; }
.resize-handle.se { bottom: -6px; right: -6px; cursor: se-resize; }
.resize-handle.n { top: -6px; left: 50%; transform: translateX(-50%); cursor: n-resize; }
.resize-handle.s { bottom: -6px; left: 50%; transform: translateX(-50%); cursor: s-resize; }
.resize-handle.e { top: 50%; right: -6px; transform: translateY(-50%); cursor: e-resize; }
.resize-handle.w { top: 50%; left: -6px; transform: translateY(-50%); cursor: w-resize; }

.rotate-handle {
  position: absolute;
  top: -40px;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 20px;
  background: var(--highlight);
  border: 2px solid white;
  border-radius: 50%;
  cursor: grab;
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rotate-handle::before {
  content: '↻';
  color: white;
  font-size: 12px;
  font-weight: bold;
}

.rotate-handle::after {
  content: '';
  position: absolute;
  bottom: -22px;
  left: 50%;
  width: 2px;
  height: 20px;
  background: var(--highlight);
  transform: translateX(-50%);
}

.interactive-element.selected .rotate-handle,
.interactive-element:hover .rotate-handle { opacity: 1; }

.rotate-handle:active { cursor: grabbing; }

.glass-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 48px;
  color: white;
  text-align: center;
  background: rgba(255, 255, 255, 0.08);
}

.glass-panel h2 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
  text-shadow: 0 2px 8px rgba(0,0,0,0.3);
  pointer-events: none;
}

.glass-panel p {
  font-size: 13px;
  opacity: 0.8;
  pointer-events: none;
}

.element-label {
  position: absolute;
  bottom: -28px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.2s;
}

.interactive-element.selected .element-label,
.interactive-element:hover .element-label { opacity: 1; }

.delete-handle {
  position: absolute;
  top: -12px;
  right: -12px;
  width: 24px;
  height: 24px;
  background: #e94560;
  border: 2px solid #fff;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: bold;
  color: #fff;
  opacity: 0;
  transition: opacity 0.2s, transform 0.15s;
  z-index: 100;
}

.delete-handle:hover {
  transform: scale(1.15);
  background: #ff6b6b;
}

.interactive-element.selected .delete-handle,
.interactive-element:hover .delete-handle { opacity: 1; }

.code-output {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: rgba(22, 33, 62, 0.95);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  padding: 16px;
  max-width: 400px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
}

.code-output-title {
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.code-output code {
  display: block;
  white-space: pre-wrap;
  color: #43e97b;
  line-height: 1.5;
}

.copy-btn {
  margin-top: 12px;
  padding: 8px 16px;
  background: var(--highlight);
  border: none;
  border-radius: 6px;
  color: white;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  width: 100%;
}

.copy-btn:hover { opacity: 0.9; }

.stats {
  position: fixed;
  top: 20px;
  right: 20px;
  background: rgba(22, 33, 62, 0.9);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 11px;
  font-family: 'SF Mono', Monaco, monospace;
}

.floating-toggle {
  position: fixed;
  bottom: 20px;
  left: 400px;
  width: 36px;
  height: 36px;
  background: rgba(22, 33, 62, 0.95);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px;
  color: var(--text);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  transition: all 0.2s;
}

.floating-toggle:hover {
  background: rgba(233, 69, 96, 0.3);
  border-color: var(--highlight);
}

.floating-controls-hidden .bg-control,
.floating-controls-hidden .stats,
.floating-controls-hidden .code-output,
.floating-controls-hidden .progressive-info { display: none !important; }

.stat-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 4px;
}

.stat-row:last-child { margin-bottom: 0; }
.stat-label { color: var(--text-dim); }
.stat-value { color: #43e97b; }

.bg-control {
  position: absolute;
  top: 16px;
  left: 16px;
  background: rgba(22, 33, 62, 0.9);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 11px;
  z-index: 100;
}

.bg-control-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.bg-control-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
}

.bg-play-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: rgba(255,255,255,0.1);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.bg-play-btn:hover { background: rgba(255,255,255,0.2); }
.bg-play-btn.paused { color: #43e97b; }

.bg-control-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.bg-control-row:last-child { margin-bottom: 0; }

.bg-control-row label {
  font-size: 11px;
  color: var(--text-dim);
  min-width: 50px;
}

.bg-control-row input[type="range"] {
  width: 80px;
  height: 4px;
}

.bg-control-row .value {
  font-size: 11px;
  color: #43e97b;
  min-width: 24px;
  text-align: center;
}

.view-mode-toggle {
  display: flex;
  gap: 4px;
}

.view-mode-btn {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 6px;
  background: rgba(255,255,255,0.05);
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.view-mode-btn:hover { background: rgba(255,255,255,0.1); }

.view-mode-btn.active {
  background: var(--highlight);
  border-color: var(--highlight);
  color: white;
}

.displacement-overlay {
  position: absolute;
  pointer-events: none;
  z-index: 10;
}

.displacement-boundary {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: 2px dashed rgba(255, 255, 255, 0.8);
  pointer-events: none;
  z-index: 11;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.5);
}

.resolution-status {
  position: absolute;
  top: 8px;
  left: 8px;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-family: 'SF Mono', Monaco, monospace;
  z-index: 20;
  pointer-events: none;
  white-space: nowrap;
}

.resolution-status.low-res { background: rgba(233, 69, 96, 0.9); }
.resolution-status.high-res { background: rgba(67, 233, 123, 0.9); }

.resolution-status.pending {
  background: rgba(255, 193, 7, 0.9);
  animation: pulse 0.5s ease-in-out infinite alternate;
}

@keyframes pulse {
  from { opacity: 0.7; }
  to { opacity: 1; }
}

.progressive-info {
  position: absolute;
  top: 220px;
  left: 16px;
  background: rgba(22, 33, 62, 0.95);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 11px;
  z-index: 100;
  display: none;
}

.progressive-info.visible { display: block; }

.progressive-info-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
  margin-bottom: 8px;
}

.progressive-info-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.progressive-info-row:last-child { margin-bottom: 0; }
.progressive-info-label { color: var(--text-dim); }
.progressive-info-value { color: #43e97b; font-family: 'SF Mono', Monaco, monospace; }

@media (max-width: 900px) {
  body { flex-direction: column; }
  .control-panel {
    width: 100%;
    min-width: auto;
    max-height: none;
    border-right: none;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }
}

/* Profiler Toggle Button */
.profiler-toggle {
  padding: 2px 8px;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 4px;
  background: rgba(255,255,255,0.05);
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.profiler-toggle:hover {
  background: rgba(255,255,255,0.1);
}

.profiler-toggle.active {
  background: var(--highlight);
  border-color: var(--highlight);
  color: white;
}

/* Performance Profiler Graph */
.profiler-graph {
  position: fixed;
  top: 130px;
  right: 20px;
  background: rgba(22, 33, 62, 0.95);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 12px;
  width: 320px;
  font-size: 11px;
  z-index: 100;
}

.profiler-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.profiler-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
}

.profiler-stats {
  display: flex;
  gap: 12px;
  align-items: center;
}

.profiler-total {
  font-family: 'SF Mono', Monaco, monospace;
  color: #43e97b;
  font-size: 11px;
  font-weight: 600;
}

.profiler-drops {
  font-family: 'SF Mono', Monaco, monospace;
  color: var(--text-dim);
  font-size: 10px;
}

.profiler-drops.has-drops {
  color: #ef4444;
  font-weight: 600;
}

.profiler-canvas-container {
  width: 100%;
  height: 100px;
  overflow-x: auto;
  overflow-y: hidden;
  border-radius: 4px;
  margin-bottom: 8px;
  background: rgba(0, 0, 0, 0.3);
  /* Hide scrollbar for cleaner look but keep functionality */
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.2) transparent;
}

.profiler-canvas-container::-webkit-scrollbar {
  height: 4px;
}

.profiler-canvas-container::-webkit-scrollbar-track {
  background: transparent;
}

.profiler-canvas-container::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.2);
  border-radius: 2px;
}

.profiler-canvas {
  height: 100%;
  min-width: 100%;
  display: block;
}

.profiler-legend {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px 12px;
  margin-bottom: 8px;
}

.profiler-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.profiler-legend-color {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.profiler-legend-label {
  color: var(--text-dim);
  font-size: 9px;
  flex: 1;
}

.profiler-legend-value {
  font-family: 'SF Mono', Monaco, monospace;
  color: var(--text);
  font-size: 9px;
}

.profiler-frame-info {
  font-size: 9px;
  color: var(--text-dim);
  text-align: center;
  padding-top: 4px;
  border-top: 1px solid rgba(255,255,255,0.1);
}
`;

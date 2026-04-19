export const styles = `
:root {
  --bg-primary: #f5f5f7;
  --bg-secondary: #ffffff;
  --bg-tertiary: #fafafa;
  --border: rgba(0, 0, 0, 0.08);
  --border-strong: rgba(0, 0, 0, 0.12);
  --text-primary: #1d1d1f;
  --text-secondary: #86868b;
  --text-tertiary: #aeaeb2;
  --accent: #0071e3;
  --accent-hover: #0077ed;
  --accent-light: rgba(0, 113, 227, 0.1);
  --success: #34c759;
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #000000;
    --bg-secondary: #1c1c1e;
    --bg-tertiary: #2c2c2e;
    --border: rgba(255, 255, 255, 0.08);
    --border-strong: rgba(255, 255, 255, 0.12);
    --text-primary: #f5f5f7;
    --text-secondary: #86868b;
    --text-tertiary: #636366;
    --accent: #0a84ff;
    --accent-hover: #409cff;
    --accent-light: rgba(10, 132, 255, 0.15);
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
    --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
  }
}

* { margin: 0; padding: 0; box-sizing: border-box; }

#app { display: contents; }

body {
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  display: flex;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.background-content {
  position: fixed;
  inset: -300px;
  z-index: -1;
  will-change: transform;
  pointer-events: none;
}

/* Control Panel */
.control-panel {
  width: 340px;
  min-width: 340px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  max-height: 100vh;
}

.panel-header {
  padding: 24px 24px 20px;
  border-bottom: 1px solid var(--border);
}

.panel-header h1 {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin-bottom: 4px;
}

.panel-header p {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.section {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
}

.section:last-child {
  border-bottom: none;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 16px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

/* Controls */
.control {
  margin-bottom: 20px;
}

.control:last-child {
  margin-bottom: 0;
}

.control-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.control-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.control-value {
  font-size: 13px;
  color: var(--accent);
  font-family: 'SF Mono', ui-monospace, monospace;
  font-weight: 500;
}

.control-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 10px;
  line-height: 1.4;
}

/* Range Input */
input[type="range"] {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  background: var(--border-strong);
  border-radius: 2px;
  outline: none;
  transition: background 0.2s;
}

input[type="range"]:hover {
  background: rgba(0, 0, 0, 0.15);
}

@media (prefers-color-scheme: dark) {
  input[type="range"]:hover {
    background: rgba(255, 255, 255, 0.15);
  }
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: var(--shadow-md);
  transition: transform 0.15s, box-shadow 0.15s;
}

input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.1);
  box-shadow: var(--shadow-lg);
}

input[type="range"]::-webkit-slider-thumb:active {
  transform: scale(0.95);
}

input[type="color"] {
  width: 100%;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  background: transparent;
  padding: 4px;
}

/* Preset Buttons */
.preset-buttons {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.preset-btn {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.preset-btn:hover {
  background: var(--accent-light);
  border-color: var(--accent);
  color: var(--accent);
}

.preset-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

/* Toggle Buttons */
.view-mode-toggle {
  display: flex;
  gap: 1px;
  background: var(--border);
  border-radius: var(--radius-sm);
  padding: 1px;
}

.view-mode-btn {
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.view-mode-btn:hover {
  color: var(--text-primary);
}

.view-mode-btn.active {
  background: var(--bg-secondary);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

/* Preview Area */
.preview-area {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: var(--bg-primary);
}

/* Interactive Element */
.interactive-element {
  position: absolute;
  cursor: move;
  user-select: none;
}

.interactive-element.selected::before {
  content: '';
  position: absolute;
  inset: -3px;
  border: 2px solid var(--accent);
  border-radius: inherit;
  pointer-events: none;
}

.interactive-element.dragging {
  z-index: 1000;
}

.interactive-element .glass-panel {
  -webkit-transform: translate3d(0, 0, 0);
  transform: translate3d(0, 0, 0);
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
}

/* Resize Handles */
.resize-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: var(--bg-secondary);
  border: 2px solid var(--accent);
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 10;
}

.interactive-element.selected .resize-handle,
.interactive-element:hover .resize-handle {
  opacity: 1;
}

.resize-handle.nw { top: -5px; left: -5px; cursor: nw-resize; }
.resize-handle.ne { top: -5px; right: -5px; cursor: ne-resize; }
.resize-handle.sw { bottom: -5px; left: -5px; cursor: sw-resize; }
.resize-handle.se { bottom: -5px; right: -5px; cursor: se-resize; }
.resize-handle.n { top: -5px; left: 50%; transform: translateX(-50%); cursor: n-resize; }
.resize-handle.s { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: s-resize; }
.resize-handle.e { top: 50%; right: -5px; transform: translateY(-50%); cursor: e-resize; }
.resize-handle.w { top: 50%; left: -5px; transform: translateY(-50%); cursor: w-resize; }

/* Rotate Handle */
.rotate-handle {
  position: absolute;
  top: -36px;
  left: 50%;
  transform: translateX(-50%);
  width: 18px;
  height: 18px;
  background: var(--bg-secondary);
  border: 2px solid var(--accent);
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
  content: '';
  width: 8px;
  height: 8px;
  border: 2px solid var(--accent);
  border-bottom: none;
  border-left: none;
  border-radius: 0 4px 0 0;
  transform: rotate(-45deg);
}

.rotate-handle::after {
  content: '';
  position: absolute;
  bottom: -18px;
  left: 50%;
  width: 1px;
  height: 16px;
  background: var(--accent);
  transform: translateX(-50%);
}

.interactive-element.selected .rotate-handle,
.interactive-element:hover .rotate-handle {
  opacity: 1;
}

.rotate-handle:active {
  cursor: grabbing;
}

/* Glass Panel */
.glass-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 48px;
  color: var(--text-primary);
  text-align: center;
}

.glass-panel h2 {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin-bottom: 4px;
  pointer-events: none;
}

.glass-panel p {
  font-size: 13px;
  color: var(--text-secondary);
  pointer-events: none;
}

/* Element Label */
.element-label {
  position: absolute;
  bottom: -24px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  font-family: 'SF Mono', ui-monospace, monospace;
  color: var(--text-tertiary);
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.2s;
}

.interactive-element.selected .element-label,
.interactive-element:hover .element-label {
  opacity: 1;
}

/* Delete Handle */
.delete-handle {
  position: absolute;
  top: -10px;
  right: -10px;
  width: 20px;
  height: 20px;
  background: #ff3b30;
  border: 2px solid var(--bg-secondary);
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: white;
  opacity: 0;
  transition: opacity 0.2s, transform 0.15s;
  z-index: 100;
}

.delete-handle:hover {
  transform: scale(1.1);
}

.interactive-element.selected .delete-handle,
.interactive-element:hover .delete-handle {
  opacity: 1;
}

/* Background Control */
.bg-control {
  position: absolute;
  top: 16px;
  left: 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
  font-size: 12px;
  z-index: 100;
  box-shadow: var(--shadow-md);
  min-width: 200px;
}

.bg-control-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.bg-control-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.bg-play-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.bg-play-btn:hover {
  background: var(--accent-light);
}

.bg-play-btn.paused {
  color: var(--success);
}

.bg-control-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.bg-control-row:last-child {
  margin-bottom: 0;
}

.bg-control-row label {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 60px;
}

.bg-control-row input[type="range"] {
  width: 80px;
  height: 3px;
}

.bg-control-row .value {
  font-size: 12px;
  font-family: 'SF Mono', ui-monospace, monospace;
  color: var(--accent);
  min-width: 28px;
  text-align: right;
}

/* Code Output */
.code-output {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
  max-width: 360px;
  box-shadow: var(--shadow-lg);
}

.code-output-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.code-output code {
  display: block;
  font-family: 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  color: var(--success);
  line-height: 1.6;
  background: var(--bg-tertiary);
  padding: 12px;
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
}

.copy-btn {
  width: 100%;
  padding: 10px 16px;
  background: var(--accent);
  border: none;
  border-radius: var(--radius-sm);
  color: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.copy-btn:hover {
  background: var(--accent-hover);
}

/* Stats Panel */
.stats {
  position: fixed;
  top: 20px;
  right: 20px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px 18px;
  font-size: 12px;
  box-shadow: var(--shadow-md);
}

.stat-row {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 6px;
}

.stat-row:last-child {
  margin-bottom: 0;
}

.stat-label {
  color: var(--text-secondary);
}

.stat-value {
  font-family: 'SF Mono', ui-monospace, monospace;
  color: var(--success);
  font-weight: 500;
}

/* Floating Toggle */
.floating-toggle {
  position: fixed;
  bottom: 20px;
  left: 360px;
  width: 40px;
  height: 40px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  box-shadow: var(--shadow-md);
  transition: all 0.2s;
}

.floating-toggle:hover {
  background: var(--accent-light);
  border-color: var(--accent);
  color: var(--accent);
}

/* Profiler Toggle */
.profiler-toggle {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.profiler-toggle:hover {
  background: var(--accent-light);
  color: var(--accent);
}

.profiler-toggle.active {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

/* Profiler Graph */
.profiler-graph {
  position: fixed;
  top: 100px;
  right: 20px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px;
  width: 300px;
  font-size: 11px;
  z-index: 100;
  box-shadow: var(--shadow-lg);
}

.profiler-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.profiler-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.profiler-stats {
  display: flex;
  gap: 12px;
  align-items: center;
}

.profiler-total {
  font-family: 'SF Mono', ui-monospace, monospace;
  color: var(--success);
  font-size: 11px;
  font-weight: 500;
}

.profiler-drops {
  font-family: 'SF Mono', ui-monospace, monospace;
  color: var(--text-tertiary);
  font-size: 10px;
}

.profiler-drops.has-drops {
  color: #ff3b30;
  font-weight: 500;
}

.profiler-canvas-container {
  width: 100%;
  height: 80px;
  overflow-x: auto;
  overflow-y: hidden;
  border-radius: var(--radius-sm);
  margin-bottom: 10px;
  background: var(--bg-tertiary);
}

.profiler-canvas-container::-webkit-scrollbar {
  height: 4px;
}

.profiler-canvas-container::-webkit-scrollbar-track {
  background: transparent;
}

.profiler-canvas-container::-webkit-scrollbar-thumb {
  background: var(--border-strong);
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
  margin-bottom: 10px;
}

.profiler-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.profiler-legend-color {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.profiler-legend-label {
  color: var(--text-tertiary);
  font-size: 10px;
  flex: 1;
}

.profiler-legend-value {
  font-family: 'SF Mono', ui-monospace, monospace;
  color: var(--text-primary);
  font-size: 10px;
}

.profiler-frame-info {
  font-size: 10px;
  color: var(--text-tertiary);
  text-align: center;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

/* Responsive */
@media (max-width: 900px) {
  body {
    flex-direction: column;
  }

  .control-panel {
    width: 100%;
    min-width: auto;
    max-height: none;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .floating-toggle {
    left: 20px;
  }
}
`;

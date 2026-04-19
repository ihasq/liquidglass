import { render } from 'preact';
import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import { styles } from './styles';
import {
  Recorder,
  parseSession,
  type ElementSnapshot,
  type FrameRecord,
  type SessionInfo,
  type SessionRecord,
} from './recorder';

// Import from schema - HMR will update these automatically
import {
  PARAMETERS,
  PARAMETER_NAMES,
  DEFAULT_PARAMS,
  type LiquidGlassParams,
  type ParameterName,
  type NumericParameterDef,
  type EnumParameterDef,
} from '../../src/schema/parameters';

// Import profiler types and dev API
import {
  __DEV__,
  lgc_dev,
  type RenderStep,
  type FrameTiming,
} from '../../src/env';

// Auto-initializes CSS Custom Properties driver
import '../../src/liquidglass';

// ============================================================
// Types - Derived from schema
// ============================================================
interface ElementData {
  id: string;
  x: string;
  y: string;
  w: number;
  h: number;
  r: number;
  radius: number;
  title: string;
  subtitle: string;
}

// GlassParams is now directly derived from schema
type GlassParams = LiquidGlassParams;

type PresetName = 'default' | 'subtle' | 'bold' | 'frosted' | 'crystal' | 'ios';

// ============================================================
// Utilities for schema-driven UI
// ============================================================

/** Convert camelCase to Title Case with spaces */
function formatParameterName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

/** Get CSS custom property name from parameter name */
function getCSSPropertyName(name: ParameterName): string {
  return `--${PARAMETERS[name].cssProperty}`;
}

/**
 * Format a parameter value as a typed CSS string, suffixing the canonical
 * unit declared in the schema (e.g. `2px`, `45deg`, `50%`). Enum params
 * pass through as-is. Unitless numerics serialize as the bare number.
 */
function formatCSSValue(name: ParameterName, value: number | string): string {
  const def = PARAMETERS[name];
  if (def.type === 'enum') return String(value);
  const unit = (def as NumericParameterDef).unit ?? '';
  return `${value}${unit}`;
}

// ============================================================
// Presets derived from schema defaults
// ============================================================
const createPresets = (): Record<PresetName, GlassParams & { radius: number }> => {
  // Default preset uses all schema defaults
  const defaultPreset: GlassParams & { radius: number } = {
    ...DEFAULT_PARAMS,
    radius: 24,
  };

  return {
    default: defaultPreset,
    subtle: {
      ...DEFAULT_PARAMS,
      refraction: 30,
      thickness: 40,
      gloss: 30,
      softness: 5,
      saturation: 30,
      dispersion: 20,
      displacementResolution: 100,
      displacementMinResolution: 20,
      displacementSmoothing: 0,
      enableOptimization: 1,
      refreshInterval: 1,
      radius: 16,
    },
    bold: {
      ...DEFAULT_PARAMS,
      refraction: 80,
      thickness: 70,
      gloss: 70,
      softness: 15,
      saturation: 60,
      dispersion: 50,
      displacementResolution: 100,
      displacementMinResolution: 20,
      displacementSmoothing: 0,
      enableOptimization: 1,
      refreshInterval: 1,
      radius: 32,
    },
    frosted: {
      ...DEFAULT_PARAMS,
      refraction: 40,
      thickness: 50,
      gloss: 40,
      softness: 50,
      saturation: 20,
      dispersion: 60,
      displacementResolution: 50,
      displacementMinResolution: 15,
      displacementSmoothing: 20,
      enableOptimization: 1,
      refreshInterval: 1,
      radius: 20,
    },
    crystal: {
      ...DEFAULT_PARAMS,
      refraction: 70,
      thickness: 60,
      gloss: 80,
      softness: 0,
      saturation: 70,
      dispersion: 40,
      displacementResolution: 100,
      displacementMinResolution: 25,
      displacementSmoothing: 0,
      enableOptimization: 1,
      refreshInterval: 1,
      radius: 28,
    },
    ios: {
      ...DEFAULT_PARAMS,
      refraction: 45,
      thickness: 55,
      gloss: 55,
      softness: 20,
      saturation: 50,
      dispersion: 35,
      displacementResolution: 75,
      displacementMinResolution: 20,
      displacementSmoothing: 10,
      enableOptimization: 1,
      refreshInterval: 1,
      radius: 22,
    },
  };
};

// ============================================================
// Initial element data
// ============================================================
const initialElements: ElementData[] = [
  { id: 'element-1', x: '50%', y: '40%', w: 320, h: 200, r: 0, radius: 24, title: 'Liquid Glass', subtitle: 'Drag, resize, rotate me!' },
  { id: 'element-2', x: '25%', y: '70%', w: 150, h: 150, r: 0, radius: 20, title: 'Small', subtitle: '150px' },
  { id: 'element-3', x: '75%', y: '65%', w: 200, h: 140, r: 0, radius: 16, title: 'Medium', subtitle: '200x140' },
];

// ============================================================
// Background SVG Generator
// ============================================================
function generateBackgroundSVG(): string {
  const cellSize = 62;
  const cols = 3;
  const rows = 2;
  const patternW = cellSize * cols;
  const patternH = cellSize * rows;
  const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff'];
  const textColors = ['#000', '#000', '#fff', '#000', '#000', '#000'];
  const chars = 'ABCDEF';

  const tilesX = Math.ceil((window.innerWidth + 600) / patternW) + 1;
  const tilesY = Math.ceil((window.innerHeight + 600) / patternH) + 1;

  let svgContent = '';
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const offsetX = tx * patternW;
      const offsetY = ty * patternH;
      for (let i = 0; i < 6; i++) {
        const cx = (i % cols) * cellSize + offsetX;
        const cy = Math.floor(i / cols) * cellSize + offsetY;
        svgContent += `<rect x="${cx}" y="${cy}" width="${cellSize}" height="${cellSize}" fill="${colors[i]}" stroke="#000" stroke-width="1"/>`;
        svgContent += `<text x="${cx + cellSize / 2}" y="${cy + cellSize / 2}" fill="${textColors[i]}" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="central">${chars[i]}</text>`;
      }
    }
  }

  const totalW = tilesX * patternW;
  const totalH = tilesY * patternH;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" style="shape-rendering: crispEdges">${svgContent}</svg>`;
}

// ============================================================
// Profiler Constants
// ============================================================

const RENDER_STEP_COLORS: Record<RenderStep, string> = {
  getBounds: '#60a5fa',    // blue-400
  getStyle: '#a78bfa',     // violet-400
  prediction: '#f472b6',   // pink-400
  displacementMap: '#fb923c', // orange-400
  specularMap: '#facc15',  // yellow-400
  svgUpdate: '#4ade80',    // green-400
  morph: '#22d3d8',        // cyan-400
};

const RENDER_STEP_LABELS: Record<RenderStep, string> = {
  getBounds: 'Bounds',
  getStyle: 'Style',
  prediction: 'Predict',
  displacementMap: 'Disp Map',
  specularMap: 'Spec Map',
  svgUpdate: 'SVG',
  morph: 'Morph',
};

const RENDER_STEPS: RenderStep[] = [
  'getBounds',
  'getStyle',
  'prediction',
  'displacementMap',
  'specularMap',
  'svgUpdate',
  'morph',
];

// ============================================================
// Components
// ============================================================

/** Frame drop detection threshold (slightly above 60fps to account for timing variance) */
const FRAME_DROP_THRESHOLD_MS = 1000 / 59; // ~16.95ms - allows for normal jitter
/** Maximum frames to keep in history */
const MAX_FRAME_HISTORY = 600;
/** Width of each frame bar in pixels */
const FRAME_BAR_WIDTH = 3;
/** Gap between frame bars */
const FRAME_BAR_GAP = 1;
/** Window size for frame drop rate moving average */
const DROP_RATE_MA_WINDOW = 30;

/** Extended frame timing with frame delta */
interface ExtendedFrameTiming {
  frameId: number;
  timestamp: number;
  deltaMs: number; // Time since last frame (frame-to-frame)
  totalMs: number; // Total liquid glass render time (0 if no render)
  steps: Record<RenderStep, number>;
  hasRender: boolean; // Whether liquid glass rendered this frame
}

/**
 * Performance Profiling Graph Component
 * Shows continuously scrolling timeline of every animation frame.
 * Liquid glass render steps are shown when they occur.
 * Frame drops are highlighted with red background.
 */
function PerformanceGraph({ enabled }: { enabled: boolean }) {
  const [frames, setFrames] = useState<ExtendedFrameTiming[]>([]);
  const [averages, setAverages] = useState<Record<RenderStep, number> | null>(null);
  const [frameDropCount, setFrameDropCount] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Ref to accumulate render data within current frame
  const pendingRenderRef = useRef<FrameTiming | null>(null);
  const frameIdRef = useRef(0);
  const lastFrameTimeRef = useRef(0);

  // Use requestAnimationFrame to track every frame continuously
  useEffect(() => {
    if (!__DEV__ || !lgc_dev || !enabled) return;

    // Enable profiler when component mounts
    lgc_dev.profiler.enable();

    // Subscribe to profiler to capture render events
    const unsubscribe = lgc_dev.profiler.subscribe((frame) => {
      // Accumulate render data for current animation frame
      pendingRenderRef.current = frame;
    });

    let animId: number;

    const tick = (timestamp: number) => {
      const lastTime = lastFrameTimeRef.current;
      const deltaMs = lastTime > 0 ? timestamp - lastTime : 16.67;
      lastFrameTimeRef.current = timestamp;

      // Get any pending render data from this frame
      const renderData = pendingRenderRef.current;
      pendingRenderRef.current = null;

      const frameTiming: ExtendedFrameTiming = {
        frameId: frameIdRef.current++,
        timestamp: Date.now(),
        deltaMs,
        totalMs: renderData?.totalMs ?? 0,
        steps: renderData?.steps ?? {
          getBounds: 0,
          getStyle: 0,
          prediction: 0,
          displacementMap: 0,
          specularMap: 0,
          svgUpdate: 0,
          morph: 0,
        },
        hasRender: !!renderData,
      };

      setFrames((prev) => {
        const next = [...prev, frameTiming];
        if (next.length > MAX_FRAME_HISTORY) {
          return next.slice(-MAX_FRAME_HISTORY);
        }
        return next;
      });

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animId);
      unsubscribe();
      lgc_dev.profiler.disable();
    };
  }, [enabled]);

  // Calculate averages and frame drop count whenever frames update
  useEffect(() => {
    if (frames.length === 0) {
      setAverages(null);
      setFrameDropCount(0);
      return;
    }

    const sums: Record<RenderStep, number> = {
      getBounds: 0,
      getStyle: 0,
      prediction: 0,
      displacementMap: 0,
      specularMap: 0,
      svgUpdate: 0,
      morph: 0,
    };

    let drops = 0;
    let renderFrameCount = 0;

    for (const frame of frames) {
      // Frame drop is based on frame-to-frame time (deltaMs), not render time
      if (frame.deltaMs > FRAME_DROP_THRESHOLD_MS) {
        drops++;
      }
      // Only average render times for frames that actually rendered
      if (frame.hasRender) {
        renderFrameCount++;
        for (const step of RENDER_STEPS) {
          sums[step] += frame.steps[step];
        }
      }
    }

    // Calculate averages only from frames that had renders
    if (renderFrameCount > 0) {
      for (const step of RENDER_STEPS) {
        sums[step] /= renderFrameCount;
      }
    }

    setAverages(sums);
    setFrameDropCount(drops);
  }, [frames]);

  // Draw canvas - timeline that grows rightward
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || frames.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const containerWidth = container.clientWidth;
    const height = container.clientHeight;

    // Calculate total width needed for all frames
    const totalWidth = Math.max(containerWidth, frames.length * FRAME_BAR_WIDTH);

    canvas.width = totalWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${totalWidth}px`;
    ctx.scale(dpr, dpr);

    // Clear with dark background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, totalWidth, height);

    // Find max deltaMs for scaling (use at least 33.33ms = 30fps for visibility)
    const maxDelta = Math.max(...frames.map((f) => f.deltaMs), 33.33);
    const chartHeight = height - 15; // Reserve space for labels

    // Draw each frame
    frames.forEach((frame, i) => {
      const x = i * FRAME_BAR_WIDTH;
      const isFrameDrop = frame.deltaMs > FRAME_DROP_THRESHOLD_MS;

      // Draw red background for frame drops (based on frame-to-frame time)
      if (isFrameDrop) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.5)'; // red-500 with alpha
        ctx.fillRect(x, 0, FRAME_BAR_WIDTH, height);
      }

      // Draw frame delta as base bar (gray)
      const deltaHeight = (frame.deltaMs / maxDelta) * chartHeight;
      const baseY = height - 5;

      // If this frame had a liquid glass render, show step breakdown
      if (frame.hasRender && frame.totalMs > 0) {
        // Draw stacked bar for render steps
        let y = baseY;
        for (const step of RENDER_STEPS) {
          const stepMs = frame.steps[step];
          const stepHeight = (stepMs / maxDelta) * chartHeight;

          if (stepHeight > 0.3) {
            ctx.fillStyle = RENDER_STEP_COLORS[step];
            ctx.fillRect(x, y - stepHeight, FRAME_BAR_WIDTH - FRAME_BAR_GAP, stepHeight);
            y -= stepHeight;
          }
        }

        // Show remaining frame time (non-render work) as dim bar
        const renderMs = frame.totalMs;
        const remainingMs = Math.max(0, frame.deltaMs - renderMs);
        if (remainingMs > 0.5) {
          const remainingHeight = (remainingMs / maxDelta) * chartHeight;
          ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
          ctx.fillRect(x, y - remainingHeight, FRAME_BAR_WIDTH - FRAME_BAR_GAP, remainingHeight);
        }
      } else {
        // No render this frame - show frame delta as dim indicator
        ctx.fillStyle = 'rgba(80, 80, 80, 0.6)';
        ctx.fillRect(x, baseY - deltaHeight, FRAME_BAR_WIDTH - FRAME_BAR_GAP, deltaHeight);
      }
    });

    // Draw threshold lines
    const drawThresholdLine = (ms: number, color: string, label: string) => {
      const lineY = height - 5 - (ms / maxDelta) * chartHeight;
      if (lineY > 5 && lineY < height - 10) {
        ctx.strokeStyle = color;
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, lineY);
        ctx.lineTo(totalWidth, lineY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label at fixed position (visible area)
        ctx.fillStyle = color;
        ctx.font = '9px monospace';
        ctx.fillText(label, 3, lineY - 2);
      }
    };

    drawThresholdLine(16.67, 'rgba(74, 222, 128, 0.7)', '60fps');
    drawThresholdLine(33.33, 'rgba(251, 191, 36, 0.7)', '30fps');

    // Draw frame drop rate moving average line
    if (frames.length >= DROP_RATE_MA_WINDOW) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();

      let started = false;
      for (let i = DROP_RATE_MA_WINDOW - 1; i < frames.length; i++) {
        // Calculate drop rate for window ending at frame i
        let dropCount = 0;
        for (let j = i - DROP_RATE_MA_WINDOW + 1; j <= i; j++) {
          if (frames[j].deltaMs > FRAME_DROP_THRESHOLD_MS) {
            dropCount++;
          }
        }
        const dropRate = dropCount / DROP_RATE_MA_WINDOW;

        // Map drop rate (0-1) to Y position (bottom = 0%, top = 100%)
        const x = i * FRAME_BAR_WIDTH + FRAME_BAR_WIDTH / 2;
        const y = height - 5 - dropRate * (chartHeight * 0.8); // Use 80% of chart height for rate

        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Auto-scroll to show latest frames
    container.scrollLeft = totalWidth - containerWidth;
  }, [frames]);

  if (!__DEV__ || !enabled) {
    return null;
  }

  const renderAvg = averages ? RENDER_STEPS.reduce((sum, s) => sum + averages[s], 0) : 0;
  const frameAvg = frames.length > 0 ? frames.reduce((s, f) => s + f.deltaMs, 0) / frames.length : 0;
  const frameDropRate = frames.length > 0 ? (frameDropCount / frames.length * 100).toFixed(1) : '0.0';
  const renderCount = frames.filter(f => f.hasRender).length;

  return (
    <div class="profiler-graph">
      <div class="profiler-header">
        <span class="profiler-title">Frame Timeline</span>
        <span class="profiler-stats">
          <span class="profiler-total">{frameAvg.toFixed(1)}ms/f</span>
          <span class={`profiler-drops ${frameDropCount > 0 ? 'has-drops' : ''}`}>
            {frameDropCount} drops ({frameDropRate}%)
          </span>
        </span>
      </div>
      <div ref={containerRef} class="profiler-canvas-container">
        <canvas ref={canvasRef} class="profiler-canvas" />
      </div>
      <div class="profiler-legend">
        {RENDER_STEPS.map((step) => (
          <div key={step} class="profiler-legend-item">
            <span
              class="profiler-legend-color"
              style={{ backgroundColor: RENDER_STEP_COLORS[step] }}
            />
            <span class="profiler-legend-label">{RENDER_STEP_LABELS[step]}</span>
            {averages && (
              <span class="profiler-legend-value">
                {averages[step].toFixed(2)}ms
              </span>
            )}
          </div>
        ))}
      </div>
      <div class="profiler-frame-info">
        {frames.length} frames | {renderCount} renders ({renderAvg.toFixed(2)}ms avg)
      </div>
    </div>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  description,
  onChange,
  valueDisplay,
}: {
  key?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  description?: string;
  onChange: (v: number) => void;
  valueDisplay?: string;
}) {
  return (
    <div class="control">
      <div class="control-header">
        <span class="control-label">{label}</span>
        <span class="control-value">{valueDisplay ?? value}</span>
      </div>
      {description && <div class="control-desc">{description}</div>}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onInput={(e) => onChange(parseInt((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}

function ToggleButtons<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
}: {
  key?: string;
  label: string;
  description?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div class="control">
      <div class="control-header">
        <span class="control-label">{label}</span>
        <span class="control-value">{value}</span>
      </div>
      {description && <div class="control-desc">{description}</div>}
      <div class="view-mode-toggle" style={{ marginTop: '8px' }}>
        {options.map((opt) => (
          <button
            key={opt.value}
            class={`view-mode-btn ${value === opt.value ? 'active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function InteractiveElement({
  data,
  selected,
  onSelect,
  onDelete,
  onUpdate,
  glassParams,
  tintColor,
  tintOpacity,
  previewAreaRef,
}: {
  data: ElementData;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onUpdate: (updates: Partial<ElementData>) => void;
  glassParams: GlassParams;
  tintColor: string;
  tintOpacity: number;
  previewAreaRef: preact.RefObject<HTMLElement>;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<{
    type: 'drag' | 'resize' | 'rotate' | null;
    startX: number;
    startY: number;
    startData: { x: number; y: number; w: number; h: number; r: number };
    resizeDir?: string;
  }>({ type: null, startX: 0, startY: 0, startData: { x: 0, y: 0, w: 0, h: 0, r: 0 } });

  const computePosition = useCallback(() => {
    if (!previewAreaRef.current) return { left: 0, top: 0 };
    const rect = previewAreaRef.current.getBoundingClientRect();
    let left = data.x.includes('%') ? (parseFloat(data.x) / 100) * rect.width : parseFloat(data.x);
    let top = data.y.includes('%') ? (parseFloat(data.y) / 100) * rect.height : parseFloat(data.y);
    left -= data.w / 2;
    top -= data.h / 2;
    return { left, top };
  }, [data, previewAreaRef]);

  const pos = computePosition();

  // Handle mouse move for drag/resize/rotate
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state.type || !previewAreaRef.current) return;

      const rect = previewAreaRef.current.getBoundingClientRect();
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;

      if (state.type === 'drag') {
        const newX = state.startData.x + dx;
        const newY = state.startData.y + dy;
        onUpdate({ x: `${newX}px`, y: `${newY}px` });
      } else if (state.type === 'resize') {
        const dir = state.resizeDir || '';
        let newW = state.startData.w;
        let newH = state.startData.h;
        let newX = state.startData.x;
        let newY = state.startData.y;

        // Resize and adjust position to keep opposite edge fixed
        if (dir.includes('e')) {
          newW = Math.max(80, state.startData.w + dx);
          newX = state.startData.x + dx / 2;
        }
        if (dir.includes('w')) {
          newW = Math.max(80, state.startData.w - dx);
          newX = state.startData.x + dx / 2;
        }
        if (dir.includes('s')) {
          newH = Math.max(60, state.startData.h + dy);
          newY = state.startData.y + dy / 2;
        }
        if (dir.includes('n')) {
          newH = Math.max(60, state.startData.h - dy);
          newY = state.startData.y + dy / 2;
        }

        onUpdate({ w: newW, h: newH, x: `${newX}px`, y: `${newY}px` });
      } else if (state.type === 'rotate') {
        const centerX = rect.left + parseFloat(data.x.includes('%') ? String((parseFloat(data.x) / 100) * rect.width) : data.x);
        const centerY = rect.top + parseFloat(data.y.includes('%') ? String((parseFloat(data.y) / 100) * rect.height) : data.y);
        const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI) + 90;
        onUpdate({ r: angle });
      }
    };

    const handleMouseUp = () => {
      if (dragStateRef.current.type) {
        dragStateRef.current.type = null;
        setIsDragging(false);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [data, onUpdate, previewAreaRef]);

  const startDrag = (e: MouseEvent, type: 'drag' | 'resize' | 'rotate', resizeDir?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = previewAreaRef.current?.getBoundingClientRect();
    if (!rect) return;

    const currentX = data.x.includes('%') ? (parseFloat(data.x) / 100) * rect.width : parseFloat(data.x);
    const currentY = data.y.includes('%') ? (parseFloat(data.y) / 100) * rect.height : parseFloat(data.y);

    dragStateRef.current = {
      type,
      startX: e.clientX,
      startY: e.clientY,
      startData: { x: currentX, y: currentY, w: data.w, h: data.h, r: data.r },
      resizeDir,
    };
    setIsDragging(true);
    onSelect();
  };

  // Build glass style dynamically from schema
  const glassStyle = useMemo(() => {
    const style: Record<string, string | number> = {
      width: `${data.w}px`,
      height: `${data.h}px`,
      borderRadius: `${data.radius}px`,
      transform: `rotate(${data.r}deg)`,
      // Specific properties (NOT the `background` shorthand) so the CSS
      // Paint API specular layer (background-image) isn't clobbered on rerender.
      backgroundColor: `rgba(${parseInt(tintColor.slice(1, 3), 16)}, ${parseInt(tintColor.slice(3, 5), 16)}, ${parseInt(tintColor.slice(5, 7), 16)}, ${tintOpacity / 100})`,
      backgroundImage: 'paint(liquid-glass-specular)',
    };
    // Apply all parameters from schema dynamically, with proper CSS units
    for (const name of PARAMETER_NAMES) {
      style[getCSSPropertyName(name)] = formatCSSValue(name, glassParams[name]);
    }
    return style;
  }, [data, glassParams, tintColor, tintOpacity]);

  return (
    <div
      ref={elementRef}
      class={`interactive-element ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.dataset.action) return;
        startDrag(e as unknown as MouseEvent, 'drag');
      }}
    >
      <div class="glass-panel" style={glassStyle}>
        <h2>{data.title}</h2>
        <p>{data.subtitle}</p>
      </div>
      <div class="delete-handle" data-action="delete" onClick={onDelete}>x</div>
      <div
        class="rotate-handle"
        data-action="rotate"
        onMouseDown={(e) => {
          e.stopPropagation();
          startDrag(e as unknown as MouseEvent, 'rotate');
        }}
      />
      {['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map((dir) => (
        <div
          key={dir}
          class={`resize-handle ${dir}`}
          data-action="resize"
          data-dir={dir}
          onMouseDown={(e) => {
            e.stopPropagation();
            startDrag(e as unknown as MouseEvent, 'resize', dir);
          }}
        />
      ))}
      <div class="element-label">{`${Math.round(data.w)}x${Math.round(data.h)} @ ${Math.round(data.r)}deg`}</div>
    </div>
  );
}

function ParameterLab() {
  // Presets (derived from schema)
  const presets = createPresets();

  // Glass parameters state (initialized from schema defaults - HMR will update)
  const [params, setParams] = useState<GlassParams>(() => ({ ...DEFAULT_PARAMS }));

  // Visual params
  const [radius, setRadius] = useState(24);
  const [width, setWidth] = useState(320);
  const [height, setHeight] = useState(200);
  const [tintColor, setTintColor] = useState('#ffffff');
  const [tintOpacity, setTintOpacity] = useState(8);

  // Elements
  const [elements, setElements] = useState<ElementData[]>(initialElements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<PresetName>('default');

  // Background animation
  const [bgSpeed, setBgSpeed] = useState(30);
  const [bgDirection, setBgDirection] = useState(135);
  const [bgBrightness, setBgBrightness] = useState(100);
  const [bgPlaying, setBgPlaying] = useState(true);
  const bgRef = useRef<HTMLDivElement>(null);
  const bgAnimRef = useRef({ x: 0, y: 0, lastTime: 0 });

  // UI
  const [viewMode, setViewMode] = useState<'lens' | 'displacement'>('lens');
  const [floatingVisible, setFloatingVisible] = useState(true);
  const [fps, setFps] = useState(0);
  const [profilerEnabled, setProfilerEnabled] = useState(false);
  const previewAreaRef = useRef<HTMLElement>(null);

  // FPS counter
  useEffect(() => {
    let frameCount = 0;
    let lastTime = performance.now();
    let animId: number;

    const tick = () => {
      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setFps(frameCount);
        frameCount = 0;
        lastTime = now;
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, []);

  // ──────────────────────────────────────────────────────────────────
  // Crash-resilient interaction recorder.
  //
  // A dedicated Worker writes every rAF's snapshot to OPFS as NDJSON.
  // This survives even SIGILL on the main process: the worker keeps
  // running, and the file is .flush()'d after every batch, so the
  // recording up to the moment of crash is recoverable on next launch.
  // ──────────────────────────────────────────────────────────────────
  const recorderRef = useRef<Recorder | null>(null);
  const [recorderStats, setRecorderStats] = useState<{ bytes: number; records: number }>(
    { bytes: 0, records: 0 }
  );
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [replayActive, setReplayActive] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recordingAnimIdRef = useRef<number>(0);
  const [replayProgress, setReplayProgress] = useState(0);
  const stateRefsForRecord = useRef({
    elements,
    params,
    radius,
    width,
    height,
    tintColor,
    tintOpacity,
    bg: { speed: bgSpeed, direction: bgDirection, brightness: bgBrightness, playing: bgPlaying },
  });
  // Keep the ref in sync with the latest React state for the rAF loop.
  useEffect(() => {
    stateRefsForRecord.current = {
      elements, params, radius, width, height, tintColor, tintOpacity,
      bg: { speed: bgSpeed, direction: bgDirection, brightness: bgBrightness, playing: bgPlaying },
    };
  }, [elements, params, radius, width, height, tintColor, tintOpacity, bgSpeed, bgDirection, bgBrightness, bgPlaying]);

  // Initialize recorder (but don't start recording automatically to save memory)
  useEffect(() => {
    const rec = new Recorder();
    recorderRef.current = rec;

    rec.on('stats', (s) => {
      setRecorderStats({ bytes: s.bytesWritten, records: s.recordCount });
    });
    rec.on('list', (l) => setSessions(l.sessions));
    rec.on('error', (e) => {
      // eslint-disable-next-line no-console
      console.warn('[Recorder]', e.message);
    });

    // Refresh the session list once on startup so the UI knows what's there.
    rec.list();

    // Flush on unload — best effort; OPFS sync handle is already durable.
    const onBeforeUnload = () => rec.flush();
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      cancelAnimationFrame(recordingAnimIdRef.current);
      window.removeEventListener('beforeunload', onBeforeUnload);
      rec.flush();
    };
  }, []);

  // Start/stop recording functions
  const startRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || isRecording) return;

    await rec.start({
      schema: PARAMETER_NAMES.reduce<Record<string, unknown>>((acc, name) => {
        acc[name] = PARAMETERS[name];
        return acc;
      }, {}),
    });

    setIsRecording(true);

    const previewArea = previewAreaRef.current;
    const tick = () => {
      const s = stateRefsForRecord.current;
      const previewRect = previewArea?.getBoundingClientRect();
      const snapshots: ElementSnapshot[] = s.elements.map((el) => {
        let x: number;
        let y: number;
        if (previewRect) {
          x = el.x.includes('%')
            ? (parseFloat(el.x) / 100) * previewRect.width
            : parseFloat(el.x);
          y = el.y.includes('%')
            ? (parseFloat(el.y) / 100) * previewRect.height
            : parseFloat(el.y);
        } else {
          x = parseFloat(el.x);
          y = parseFloat(el.y);
        }
        return {
          id: el.id,
          x, y,
          w: el.w,
          h: el.h,
          r: el.r,
          radius: el.radius,
        };
      });

      rec.recordFrame({
        elements: snapshots,
        params: { ...s.params } as Record<string, number | string>,
        bg: s.bg,
      });
      recordingAnimIdRef.current = requestAnimationFrame(tick);
    };
    recordingAnimIdRef.current = requestAnimationFrame(tick);
  }, [isRecording]);

  const stopRecording = useCallback(() => {
    cancelAnimationFrame(recordingAnimIdRef.current);
    recorderRef.current?.flush();
    setIsRecording(false);
    // Refresh session list to show new recording
    recorderRef.current?.list();
  }, []);

  // ──────────────────────────────────────────────────────────────────
  // Replay engine: read a stored NDJSON session and re-apply each frame
  // at its recorded timestamp.
  // ──────────────────────────────────────────────────────────────────
  const replayRafRef = useRef<number | null>(null);
  const stopReplay = useCallback(() => {
    if (replayRafRef.current !== null) cancelAnimationFrame(replayRafRef.current);
    replayRafRef.current = null;
    setReplayActive(null);
    setReplayProgress(0);
  }, []);

  const startReplay = useCallback(async (sessionId: string) => {
    if (!recorderRef.current) return;
    setReplayActive(sessionId);

    // Receive the full session content from the worker
    const content: string = await new Promise((resolve) => {
      const off = recorderRef.current!.on('data', (msg) => {
        if (msg.sessionId === sessionId) { off(); resolve(msg.content); }
      });
      recorderRef.current!.read(sessionId);
    });

    const records = parseSession(content);
    const frames = records.filter((r): r is FrameRecord => r.type === 'frame');
    if (frames.length === 0) { stopReplay(); return; }

    const startWall = performance.now();
    const firstT = frames[0].t;
    let idx = 0;
    const previewArea = previewAreaRef.current;

    const tick = () => {
      const elapsed = performance.now() - startWall;
      // Advance to the latest frame whose timestamp has passed.
      while (idx + 1 < frames.length && frames[idx + 1].t - firstT <= elapsed) {
        idx++;
      }
      const f = frames[idx];
      // Map snapshot back into React state. Element coords were stored as
      // viewport-pixels relative to previewArea, so re-apply directly.
      const previewRect = previewArea?.getBoundingClientRect();
      setElements((prev) => prev.map((p) => {
        const snap = f.elements.find((s) => s.id === p.id);
        if (!snap) return p;
        const xStr = previewRect ? `${snap.x}px` : p.x;
        const yStr = previewRect ? `${snap.y}px` : p.y;
        return {
          ...p,
          x: xStr, y: yStr,
          w: snap.w, h: snap.h, r: snap.r,
          radius: snap.radius,
        };
      }));
      setParams((prev) => ({ ...prev, ...f.params } as GlassParams));
      if (f.bg) {
        setBgSpeed(f.bg.speed);
        setBgDirection(f.bg.direction);
        setBgBrightness(f.bg.brightness);
        setBgPlaying(f.bg.playing);
      }

      const lastT = frames[frames.length - 1].t - firstT;
      setReplayProgress(lastT > 0 ? Math.min(1, elapsed / lastT) : 1);

      if (idx + 1 < frames.length) {
        replayRafRef.current = requestAnimationFrame(tick);
      } else {
        stopReplay();
      }
    };
    replayRafRef.current = requestAnimationFrame(tick);
  }, [stopReplay]);

  // Background animation
  useEffect(() => {
    let animId: number;
    const animate = (timestamp: number) => {
      const anim = bgAnimRef.current;
      if (!anim.lastTime) anim.lastTime = timestamp;
      const delta = timestamp - anim.lastTime;
      anim.lastTime = timestamp;

      if (bgPlaying && bgSpeed > 0 && bgRef.current) {
        const pxPerSec = bgSpeed * 2;
        const rad = (bgDirection * Math.PI) / 180;
        anim.x += Math.cos(rad) * pxPerSec * (delta / 1000);
        anim.y += Math.sin(rad) * pxPerSec * (delta / 1000);
        bgRef.current.style.transform = `translate(${anim.x % 186}px, ${anim.y % 124}px)`;
      }
      animId = requestAnimationFrame(animate);
    };
    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [bgSpeed, bgDirection, bgPlaying]);

  // Apply preset - dynamically copies all schema parameters
  const applyPreset = (name: PresetName) => {
    const preset = presets[name];
    // Extract only schema parameters (exclude radius which is not in schema)
    const schemaParams = {} as GlassParams;
    for (const paramName of PARAMETER_NAMES) {
      schemaParams[paramName] = preset[paramName] as never;
    }
    setParams(schemaParams);
    setRadius(preset.radius);
    setActivePreset(name);
  };

  // Code output - dynamically generated from schema
  const codeOutput = useMemo(() => {
    const lines = ['.glass-panel {'];
    for (const name of PARAMETER_NAMES) {
      lines.push(`  ${getCSSPropertyName(name)}: ${formatCSSValue(name, params[name])};`);
    }
    lines.push(`  border-radius: ${radius}px;`);
    lines.push('}');
    return lines.join('\n');
  }, [params, radius]);

  const copyCode = () => {
    navigator.clipboard.writeText(codeOutput);
  };

  const directionArrows = ['->', '↘', '↓', '↙', '<-', '↖', '↑', '↗'];
  const directionArrow = directionArrows[Math.round(bgDirection / 45) % 8];

  return (
    <>
      <style>{styles}</style>

      {/* Background */}
      <div
        ref={bgRef}
        class="background-content"
        style={{ filter: `brightness(${bgBrightness / 100})` }}
        dangerouslySetInnerHTML={{ __html: generateBackgroundSVG() }}
      />

      {/* Control Panel */}
      <aside class="control-panel">
        <header class="panel-header">
          <h1>Liquid Glass Lab</h1>
          <p>Explore Apple-style glass effect parameters</p>
          <p style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '4px' }}>
            Schema defaults: refraction={PARAMETERS.refraction.default}, renderer={PARAMETERS.displacementRenderer.default}
          </p>
        </header>

        {/* Presets */}
        <section class="section">
          <div class="section-title">Presets</div>
          <div class="preset-buttons">
            {(['default', 'subtle', 'bold', 'frosted', 'crystal', 'ios'] as PresetName[]).map((name) => (
              <button
                key={name}
                class={`preset-btn ${activePreset === name ? 'active' : ''}`}
                onClick={() => applyPreset(name)}
              >
                {name.charAt(0).toUpperCase() + name.slice(1)}
              </button>
            ))}
          </div>
        </section>

        {/* Schema-driven Parameters - automatically generated from PARAMETERS */}
        <section class="section">
          <div class="section-title">Parameters ({PARAMETER_NAMES.length})</div>
          {PARAMETER_NAMES.map((name) => {
            const def = PARAMETERS[name];
            if (def.type === 'number') {
              const numDef = def as NumericParameterDef;
              // Boolean transform: show as toggle buttons
              if (numDef.transform === 'boolean') {
                return (
                  <ToggleButtons
                    key={name}
                    label={formatParameterName(name)}
                    description={numDef.description}
                    value={(params[name] as number) === 1 ? 'ON' : 'OFF'}
                    options={[
                      { value: 'OFF', label: `OFF (${numDef.min})` },
                      { value: 'ON', label: `ON (${numDef.max})` },
                    ]}
                    onChange={(v) => setParams((p) => ({ ...p, [name]: v === 'ON' ? numDef.max : numDef.min }))}
                  />
                );
              }
              // Numeric: show as range slider with typed value display
              return (
                <RangeControl
                  key={name}
                  label={formatParameterName(name)}
                  value={params[name] as number}
                  min={numDef.min}
                  max={numDef.max}
                  description={numDef.description}
                  valueDisplay={formatCSSValue(name, params[name] as number)}
                  onChange={(v) => setParams((p) => ({ ...p, [name]: v }))}
                />
              );
            } else {
              // Enum: show as toggle buttons
              const enumDef = def as EnumParameterDef;
              return (
                <ToggleButtons
                  key={name}
                  label={formatParameterName(name)}
                  description={enumDef.description}
                  value={params[name] as string}
                  options={enumDef.values.map((v) => ({
                    value: v,
                    label: v.toUpperCase(),
                  }))}
                  onChange={(v) => setParams((p) => ({ ...p, [name]: v }))}
                />
              );
            }
          })}
        </section>

        {/* Geometry (not from schema) */}
        <section class="section">
          <div class="section-title">Geometry</div>
          <RangeControl
            label="Corner Radius"
            value={radius}
            min={0}
            max={100}
            description="Border radius - affects displacement map shape"
            onChange={setRadius}
          />
          <RangeControl label="Width" value={width} min={100} max={4096} onChange={setWidth} />
          <RangeControl label="Height" value={height} min={80} max={4096} onChange={setHeight} />
        </section>

        {/* Visual (not from schema) */}
        <section class="section">
          <div class="section-title">Visual</div>
          <div class="control">
            <div class="control-header">
              <span class="control-label">Background Tint</span>
            </div>
            <input
              type="color"
              value={tintColor}
              onInput={(e) => setTintColor((e.target as HTMLInputElement).value)}
            />
          </div>
          <RangeControl
            label="Tint Opacity"
            value={tintOpacity}
            min={0}
            max={50}
            onChange={setTintOpacity}
          />
        </section>

        {/* Actions */}
        <section class="section">
          <div class="section-title">Actions</div>
          <div class="preset-buttons">
            <button
              class="preset-btn"
              style={{ background: 'rgba(67, 233, 123, 0.2)', borderColor: '#43e97b' }}
              onClick={() => setElements(initialElements)}
            >
              Reset Positions
            </button>
            <button
              class="preset-btn"
              style={{ background: 'rgba(233, 69, 96, 0.2)', borderColor: '#e94560' }}
              onClick={() => {
                setElements(initialElements);
                applyPreset('default');
                setTintColor('#ffffff');
                setTintOpacity(8);
                setBgSpeed(30);
                setBgDirection(135);
                setBgBrightness(100);
                setViewMode('lens');
              }}
            >
              Reset All
            </button>
          </div>
        </section>
      </aside>

      {/* Preview Area */}
      <main class="preview-area" ref={previewAreaRef}>
        {/* Background Control */}
        <div class="bg-control">
          <div class="bg-control-header">
            <div class="bg-control-title">Background</div>
            <button
              class={`bg-play-btn ${!bgPlaying ? 'paused' : ''}`}
              onClick={() => {
                setBgPlaying((p) => !p);
                bgAnimRef.current.lastTime = 0;
              }}
            >
              {bgPlaying ? '\u23F8' : '\u25B6'}
            </button>
          </div>
          <div class="bg-control-row">
            <label>Speed</label>
            <input
              type="range"
              min={0}
              max={60}
              value={bgSpeed}
              onInput={(e) => setBgSpeed(parseInt((e.target as HTMLInputElement).value))}
            />
            <span class="value">{bgSpeed}</span>
          </div>
          <div class="bg-control-row">
            <label>Direction</label>
            <input
              type="range"
              min={0}
              max={315}
              step={45}
              value={bgDirection}
              onInput={(e) => setBgDirection(parseInt((e.target as HTMLInputElement).value))}
            />
            <span class="value">{directionArrow}</span>
          </div>
          <div class="bg-control-row">
            <label>Brightness</label>
            <input
              type="range"
              min={0}
              max={100}
              value={bgBrightness}
              onInput={(e) => setBgBrightness(parseInt((e.target as HTMLInputElement).value))}
            />
            <span class="value">{bgBrightness}%</span>
          </div>
        </div>

        {/* View Mode Toggle */}
        <div class="bg-control" style={{ top: '170px' }}>
          <div class="bg-control-header">
            <div class="bg-control-title">View Mode</div>
          </div>
          <div class="view-mode-toggle">
            <button
              class={`view-mode-btn ${viewMode === 'lens' ? 'active' : ''}`}
              onClick={() => setViewMode('lens')}
            >
              Lens
            </button>
            <button
              class={`view-mode-btn ${viewMode === 'displacement' ? 'active' : ''}`}
              onClick={() => setViewMode('displacement')}
            >
              Displacement Map
            </button>
          </div>
        </div>

        {/* Elements */}
        {elements.map((el) => (
          <InteractiveElement
            key={el.id}
            data={{ ...el, radius, w: selectedId === el.id ? width : el.w, h: selectedId === el.id ? height : el.h }}
            selected={selectedId === el.id}
            onSelect={() => setSelectedId(el.id)}
            onDelete={() => {
              setElements((els) => els.filter((e) => e.id !== el.id));
              if (selectedId === el.id) setSelectedId(null);
            }}
            onUpdate={(updates) => {
              setElements((els) => els.map((e) => (e.id === el.id ? { ...e, ...updates } : e)));
              // Sync width/height state when resizing selected element
              if (selectedId === el.id) {
                if (updates.w !== undefined) setWidth(updates.w);
                if (updates.h !== undefined) setHeight(updates.h);
              }
            }}
            glassParams={params}
            tintColor={tintColor}
            tintOpacity={tintOpacity}
            previewAreaRef={previewAreaRef}
          />
        ))}
      </main>

      {/* Stats */}
      {floatingVisible && (
        <div class="stats">
          <div class="stat-row">
            <span class="stat-label">Elements:</span>
            <span class="stat-value">{elements.length}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Visible:</span>
            <span class="stat-value">{elements.length}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">FPS:</span>
            <span class="stat-value">{fps}</span>
          </div>
          {/* Renderer: bidirectionally bound with `Displacement Renderer`
              control in the side panel. Click to cycle through values. */}
          <div class="stat-row" style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px' }}>
            <span class="stat-label">Renderer:</span>
            <div class="view-mode-toggle" style={{ display: 'flex', gap: '2px' }}>
              {(PARAMETERS.displacementRenderer as EnumParameterDef).values.map((v) => (
                <button
                  key={v}
                  class={`view-mode-btn ${params.displacementRenderer === v ? 'active' : ''}`}
                  style={{ fontSize: '10px', padding: '2px 6px' }}
                  onClick={() => setParams((p) => ({ ...p, displacementRenderer: v as typeof p.displacementRenderer }))}
                  title={`Switch displacement renderer to ${v.toUpperCase()}`}
                >
                  {v.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {__DEV__ && (
            <div class="stat-row" style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px' }}>
              <span class="stat-label">Profiler:</span>
              <button
                class={`profiler-toggle ${profilerEnabled ? 'active' : ''}`}
                onClick={() => setProfilerEnabled((v) => !v)}
              >
                {profilerEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
          )}
          {/* Recorder status: rec count + bytes written by the OPFS worker. */}
          <div class="stat-row" style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px', display: 'block' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span class="stat-label">Recording:</span>
              <button
                class={`profiler-toggle ${isRecording ? 'active' : ''}`}
                style={{ fontSize: '10px', padding: '2px 8px' }}
                onClick={isRecording ? stopRecording : startRecording}
              >
                {isRecording ? '⏹ STOP' : '⏺ REC'}
              </button>
            </div>
            {isRecording && (
              <div style={{ fontSize: '10px', color: '#ef4444', marginTop: '4px' }}>
                ● {recorderStats.records.toLocaleString()} rec / {(recorderStats.bytes / 1024).toFixed(1)} KB
              </div>
            )}
            {replayActive && (
              <div style={{ marginTop: '6px' }}>
                <div style={{ fontSize: '10px', color: '#facc15', marginBottom: '3px' }}>
                  ▶ REPLAY  {Math.round(replayProgress * 100)}%
                </div>
                <div style={{ height: '3px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${replayProgress * 100}%`, height: '100%', background: '#facc15', transition: 'width 0.1s' }} />
                </div>
                <button
                  class="profiler-toggle"
                  style={{ marginTop: '4px', width: '100%' }}
                  onClick={stopReplay}
                >
                  Stop Replay
                </button>
              </div>
            )}
            {!replayActive && (
              <div style={{ marginTop: '6px' }}>
                <button
                  class="profiler-toggle"
                  style={{ width: '100%', fontSize: '10px' }}
                  onClick={() => recorderRef.current?.list()}
                >
                  Refresh Sessions ({sessions.length})
                </button>
                {sessions.length > 0 && (
                  <div style={{ marginTop: '4px', maxHeight: '120px', overflowY: 'auto', fontSize: '10px' }}>
                    {sessions.slice(0, 8).map((s) => {
                      // Strip "session-" prefix and ".ndjson" suffix for the id we pass back to read()
                      const sessionId = s.name.replace(/^session-/, '').replace(/\.ndjson$/, '');
                      const label = sessionId.length > 24 ? sessionId.slice(0, 24) + '…' : sessionId;
                      return (
                        <div key={s.name} style={{ display: 'flex', gap: '4px', alignItems: 'center', padding: '2px 0' }}>
                          <button
                            class="profiler-toggle"
                            style={{ flex: 1, fontSize: '9px', padding: '2px 4px', textAlign: 'left' }}
                            onClick={() => startReplay(sessionId)}
                            title={`${(s.size / 1024).toFixed(1)} KB`}
                          >
                            ▶ {label}
                          </button>
                          <button
                            class="profiler-toggle"
                            style={{ fontSize: '9px', padding: '2px 4px', minWidth: '20px' }}
                            onClick={() => recorderRef.current?.delete(sessionId)}
                            title="Delete session"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Performance Profiling Graph */}
      {floatingVisible && __DEV__ && <PerformanceGraph enabled={profilerEnabled} />}

      {/* Floating Toggle */}
      <button
        class="floating-toggle"
        onClick={() => setFloatingVisible((v) => !v)}
        title={floatingVisible ? 'Hide floating controls (H)' : 'Show floating controls (H)'}
      >
        {floatingVisible ? '\uD83D\uDC41' : '\uD83D\uDC41\u200D\uD83D\uDDE8'}
      </button>

      {/* Code Output */}
      {floatingVisible && (
        <div class="code-output">
          <div class="code-output-title">Generated CSS</div>
          <code>{codeOutput}</code>
          <button class="copy-btn" onClick={copyCode}>
            Copy to Clipboard
          </button>
        </div>
      )}
    </>
  );
}

// Mount
render(<ParameterLab />, document.getElementById('app')!);

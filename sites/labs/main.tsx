import { render } from 'preact';
import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import { styles } from './styles';

// Import from schema
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
// Types
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

type GlassParams = LiquidGlassParams;
type PresetName = 'default' | 'subtle' | 'bold' | 'frosted' | 'crystal' | 'ios';

// ============================================================
// Utilities
// ============================================================
function formatParameterName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

function getCSSPropertyName(name: ParameterName): string {
  return `--${PARAMETERS[name].cssProperty}`;
}

function formatCSSValue(name: ParameterName, value: number | string): string {
  const def = PARAMETERS[name];
  if (def.type === 'enum') return String(value);
  const unit = (def as NumericParameterDef).unit ?? '';
  return `${value}${unit}`;
}

// ============================================================
// Presets
// ============================================================
const createPresets = (): Record<PresetName, GlassParams & { radius: number }> => {
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
// Initial Elements
// ============================================================
const initialElements: ElementData[] = [
  { id: 'element-1', x: '50%', y: '40%', w: 320, h: 200, r: 0, radius: 24, title: 'Liquid Glass', subtitle: 'Drag, resize, rotate' },
  { id: 'element-2', x: '25%', y: '70%', w: 150, h: 150, r: 0, radius: 20, title: 'Small', subtitle: '150px' },
  { id: 'element-3', x: '75%', y: '65%', w: 200, h: 140, r: 0, radius: 16, title: 'Medium', subtitle: '200x140' },
];

// ============================================================
// Background SVG
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
// Profiler
// ============================================================
const RENDER_STEP_COLORS: Record<RenderStep, string> = {
  getBounds: '#60a5fa',
  getStyle: '#a78bfa',
  prediction: '#f472b6',
  displacementMap: '#fb923c',
  specularMap: '#facc15',
  svgUpdate: '#4ade80',
  morph: '#22d3d8',
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
  'getBounds', 'getStyle', 'prediction', 'displacementMap', 'specularMap', 'svgUpdate', 'morph',
];

const FRAME_DROP_THRESHOLD_MS = 1000 / 59;
const MAX_FRAME_HISTORY = 600;
const FRAME_BAR_WIDTH = 3;
const FRAME_BAR_GAP = 1;
const DROP_RATE_MA_WINDOW = 30;

interface ExtendedFrameTiming {
  frameId: number;
  timestamp: number;
  deltaMs: number;
  totalMs: number;
  steps: Record<RenderStep, number>;
  hasRender: boolean;
}

function PerformanceGraph({ enabled }: { enabled: boolean }) {
  const [frames, setFrames] = useState<ExtendedFrameTiming[]>([]);
  const [averages, setAverages] = useState<Record<RenderStep, number> | null>(null);
  const [frameDropCount, setFrameDropCount] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingRenderRef = useRef<FrameTiming | null>(null);
  const frameIdRef = useRef(0);
  const lastFrameTimeRef = useRef(0);

  useEffect(() => {
    if (!__DEV__ || !lgc_dev || !enabled) return;

    lgc_dev.profiler.enable();
    const unsubscribe = lgc_dev.profiler.subscribe((frame) => {
      pendingRenderRef.current = frame;
    });

    let animId: number;
    const tick = (timestamp: number) => {
      const lastTime = lastFrameTimeRef.current;
      const deltaMs = lastTime > 0 ? timestamp - lastTime : 16.67;
      lastFrameTimeRef.current = timestamp;

      const renderData = pendingRenderRef.current;
      pendingRenderRef.current = null;

      const frameTiming: ExtendedFrameTiming = {
        frameId: frameIdRef.current++,
        timestamp: Date.now(),
        deltaMs,
        totalMs: renderData?.totalMs ?? 0,
        steps: renderData?.steps ?? {
          getBounds: 0, getStyle: 0, prediction: 0, displacementMap: 0,
          specularMap: 0, svgUpdate: 0, morph: 0,
        },
        hasRender: !!renderData,
      };

      setFrames((prev) => {
        const next = [...prev, frameTiming];
        return next.length > MAX_FRAME_HISTORY ? next.slice(-MAX_FRAME_HISTORY) : next;
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

  useEffect(() => {
    if (frames.length === 0) {
      setAverages(null);
      setFrameDropCount(0);
      return;
    }

    const sums: Record<RenderStep, number> = {
      getBounds: 0, getStyle: 0, prediction: 0, displacementMap: 0,
      specularMap: 0, svgUpdate: 0, morph: 0,
    };

    let drops = 0;
    let renderFrameCount = 0;

    for (const frame of frames) {
      if (frame.deltaMs > FRAME_DROP_THRESHOLD_MS) drops++;
      if (frame.hasRender) {
        renderFrameCount++;
        for (const step of RENDER_STEPS) sums[step] += frame.steps[step];
      }
    }

    if (renderFrameCount > 0) {
      for (const step of RENDER_STEPS) sums[step] /= renderFrameCount;
    }

    setAverages(sums);
    setFrameDropCount(drops);
  }, [frames]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || frames.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const containerWidth = container.clientWidth;
    const height = container.clientHeight;
    const totalWidth = Math.max(containerWidth, frames.length * FRAME_BAR_WIDTH);

    canvas.width = totalWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${totalWidth}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, totalWidth, height);

    const maxDelta = Math.max(...frames.map((f) => f.deltaMs), 33.33);
    const chartHeight = height - 15;

    frames.forEach((frame, i) => {
      const x = i * FRAME_BAR_WIDTH;
      const isFrameDrop = frame.deltaMs > FRAME_DROP_THRESHOLD_MS;

      if (isFrameDrop) {
        ctx.fillStyle = 'rgba(255, 59, 48, 0.4)';
        ctx.fillRect(x, 0, FRAME_BAR_WIDTH, height);
      }

      const deltaHeight = (frame.deltaMs / maxDelta) * chartHeight;
      const baseY = height - 5;

      if (frame.hasRender && frame.totalMs > 0) {
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
      } else {
        ctx.fillStyle = 'rgba(80, 80, 80, 0.5)';
        ctx.fillRect(x, baseY - deltaHeight, FRAME_BAR_WIDTH - FRAME_BAR_GAP, deltaHeight);
      }
    });

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
        ctx.fillStyle = color;
        ctx.font = '9px -apple-system, sans-serif';
        ctx.fillText(label, 3, lineY - 2);
      }
    };

    drawThresholdLine(16.67, 'rgba(52, 199, 89, 0.7)', '60fps');
    drawThresholdLine(33.33, 'rgba(255, 204, 0, 0.7)', '30fps');

    container.scrollLeft = totalWidth - containerWidth;
  }, [frames]);

  if (!__DEV__ || !enabled) return null;

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
            <span class="profiler-legend-color" style={{ backgroundColor: RENDER_STEP_COLORS[step] }} />
            <span class="profiler-legend-label">{RENDER_STEP_LABELS[step]}</span>
            {averages && <span class="profiler-legend-value">{averages[step].toFixed(2)}ms</span>}
          </div>
        ))}
      </div>
      <div class="profiler-frame-info">
        {frames.length} frames | {renderCount} renders ({renderAvg.toFixed(2)}ms avg)
      </div>
    </div>
  );
}

// ============================================================
// Components
// ============================================================
function RangeControl({
  label, value, min, max, description, onChange, valueDisplay,
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
  label, description, value, options, onChange,
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
  data, selected, onSelect, onDelete, onUpdate, glassParams, tintColor, tintOpacity, previewAreaRef,
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

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state.type || !previewAreaRef.current) return;

      const rect = previewAreaRef.current.getBoundingClientRect();
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;

      if (state.type === 'drag') {
        onUpdate({ x: `${state.startData.x + dx}px`, y: `${state.startData.y + dy}px` });
      } else if (state.type === 'resize') {
        const dir = state.resizeDir || '';
        let newW = state.startData.w;
        let newH = state.startData.h;
        let newX = state.startData.x;
        let newY = state.startData.y;

        if (dir.includes('e')) { newW = Math.max(80, state.startData.w + dx); newX = state.startData.x + dx / 2; }
        if (dir.includes('w')) { newW = Math.max(80, state.startData.w - dx); newX = state.startData.x + dx / 2; }
        if (dir.includes('s')) { newH = Math.max(60, state.startData.h + dy); newY = state.startData.y + dy / 2; }
        if (dir.includes('n')) { newH = Math.max(60, state.startData.h - dy); newY = state.startData.y + dy / 2; }

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

  const glassStyle = useMemo(() => {
    const style: Record<string, string | number> = {
      width: `${data.w}px`,
      height: `${data.h}px`,
      borderRadius: `${data.radius}px`,
      transform: `rotate(${data.r}deg)`,
      backgroundColor: `rgba(${parseInt(tintColor.slice(1, 3), 16)}, ${parseInt(tintColor.slice(3, 5), 16)}, ${parseInt(tintColor.slice(5, 7), 16)}, ${tintOpacity / 100})`,
      backgroundImage: 'paint(liquid-glass-specular)',
    };
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

// ============================================================
// Main App
// ============================================================
function ParameterLab() {
  const presets = createPresets();

  const [params, setParams] = useState<GlassParams>(() => ({ ...DEFAULT_PARAMS }));
  const [radius, setRadius] = useState(24);
  const [width, setWidth] = useState(320);
  const [height, setHeight] = useState(200);
  const [tintColor, setTintColor] = useState('#ffffff');
  const [tintOpacity, setTintOpacity] = useState(8);

  const [elements, setElements] = useState<ElementData[]>(initialElements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<PresetName>('default');

  const [bgSpeed, setBgSpeed] = useState(30);
  const [bgDirection, setBgDirection] = useState(135);
  const [bgBrightness, setBgBrightness] = useState(100);
  const [bgPlaying, setBgPlaying] = useState(true);
  const bgRef = useRef<HTMLDivElement>(null);
  const bgAnimRef = useRef({ x: 0, y: 0, lastTime: 0 });

  const [viewMode, setViewMode] = useState<'lens' | 'displacement'>('lens');
  const [debugVisible, setDebugVisible] = useState(false);
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

  const applyPreset = (name: PresetName) => {
    const preset = presets[name];
    const schemaParams = {} as GlassParams;
    for (const paramName of PARAMETER_NAMES) {
      schemaParams[paramName] = preset[paramName] as never;
    }
    setParams(schemaParams);
    setRadius(preset.radius);
    setActivePreset(name);
  };

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

      <div
        ref={bgRef}
        class="background-content"
        style={{ filter: `brightness(${bgBrightness / 100})` }}
        dangerouslySetInnerHTML={{ __html: generateBackgroundSVG() }}
      />

      <aside class="control-panel">
        <header class="panel-header">
          <h1>Liquid Glass Labs</h1>
          <p>Explore glass effect parameters</p>
        </header>

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

        <section class="section">
          <div class="section-title">Parameters</div>
          {PARAMETER_NAMES.map((name) => {
            const def = PARAMETERS[name];
            if (def.type === 'number') {
              const numDef = def as NumericParameterDef;
              if (numDef.transform === 'boolean') {
                return (
                  <ToggleButtons
                    key={name}
                    label={formatParameterName(name)}
                    description={numDef.description}
                    value={(params[name] as number) === 1 ? 'ON' : 'OFF'}
                    options={[
                      { value: 'OFF', label: 'Off' },
                      { value: 'ON', label: 'On' },
                    ]}
                    onChange={(v) => setParams((p) => ({ ...p, [name]: v === 'ON' ? numDef.max : numDef.min }))}
                  />
                );
              }
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
              const enumDef = def as EnumParameterDef;
              return (
                <ToggleButtons
                  key={name}
                  label={formatParameterName(name)}
                  description={enumDef.description}
                  value={params[name] as string}
                  options={enumDef.values.map((v) => ({ value: v, label: v.toUpperCase() }))}
                  onChange={(v) => setParams((p) => ({ ...p, [name]: v }))}
                />
              );
            }
          })}
        </section>

        <section class="section">
          <div class="section-title">Geometry</div>
          <RangeControl label="Corner Radius" value={radius} min={0} max={100} onChange={setRadius} />
          <RangeControl label="Width" value={width} min={100} max={4096} onChange={setWidth} />
          <RangeControl label="Height" value={height} min={80} max={4096} onChange={setHeight} />
        </section>

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
          <RangeControl label="Tint Opacity" value={tintOpacity} min={0} max={50} onChange={setTintOpacity} />
        </section>

        <section class="section">
          <div class="section-title">Actions</div>
          <div class="preset-buttons">
            <button class="preset-btn" onClick={() => setElements(initialElements)}>
              Reset Positions
            </button>
            <button
              class="preset-btn"
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

      <main class="preview-area" ref={previewAreaRef}>
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
              Displacement
            </button>
          </div>
        </div>

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

      {/* Debug info - only visible when debugVisible is true */}
      {debugVisible && (
        <div class="stats">
          <div class="stat-row">
            <span class="stat-label">Elements:</span>
            <span class="stat-value">{elements.length}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">FPS:</span>
            <span class="stat-value">{fps}</span>
          </div>
          <div class="stat-row" style={{ marginTop: '8px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
            <span class="stat-label">Renderer:</span>
            <div class="view-mode-toggle" style={{ display: 'flex', gap: '2px' }}>
              {(PARAMETERS.displacementRenderer as EnumParameterDef).values.map((v) => (
                <button
                  key={v}
                  class={`view-mode-btn ${params.displacementRenderer === v ? 'active' : ''}`}
                  style={{ fontSize: '10px', padding: '4px 8px' }}
                  onClick={() => setParams((p) => ({ ...p, displacementRenderer: v as typeof p.displacementRenderer }))}
                >
                  {v.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {__DEV__ && (
            <div class="stat-row" style={{ marginTop: '8px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
              <span class="stat-label">Profiler:</span>
              <button
                class={`profiler-toggle ${profilerEnabled ? 'active' : ''}`}
                onClick={() => setProfilerEnabled((v) => !v)}
              >
                {profilerEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
          )}
        </div>
      )}

      {debugVisible && __DEV__ && <PerformanceGraph enabled={profilerEnabled} />}

      {/* Debug toggle button - bottom left */}
      <button
        class="floating-toggle"
        onClick={() => setDebugVisible((v) => !v)}
        title={debugVisible ? 'Hide debug info' : 'Show debug info'}
      >
        {debugVisible ? '\uD83D\uDC41' : '\uD83D\uDC41\u200D\uD83D\uDDE8'}
      </button>

      {/* Code Output - always visible */}
      <div class="code-output">
        <div class="code-output-title">Generated CSS</div>
        <code>{codeOutput}</code>
        <button class="copy-btn" onClick={copyCode}>
          Copy to Clipboard
        </button>
      </div>
    </>
  );
}

render(<ParameterLab />, document.getElementById('app')!);

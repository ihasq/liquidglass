/**
 * Main-thread interface to the recorder worker.
 *
 * Owns the rAF loop that snapshots state every frame, batches frames,
 * and ships them to the worker. Survives main-thread crashes because the
 * worker is independent — durability is the worker's responsibility.
 */

export interface ElementSnapshot {
  id: string;
  /** Top-left X in viewport-pixels */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation degrees */
  r: number;
  /** Border radius (px, computed) */
  radius: number;
}

export interface FrameRecord {
  /** Milliseconds since session start (performance.now()-relative) */
  t: number;
  type: 'frame';
  elements: ElementSnapshot[];
  /** All --liquidglass-* numeric/enum params on the focused/representative panel */
  params: Record<string, number | string>;
  /** Background animation state (lab-specific UI) */
  bg?: { speed: number; direction: number; brightness: number; playing: boolean };
}

export interface InitRecord {
  t: 0;
  type: 'init';
  sessionId: string;
  startedAt: number;
  userAgent?: string;
  viewport?: { w: number; h: number };
  schema?: unknown;
}

export type SessionRecord = InitRecord | FrameRecord;

export interface SessionInfo {
  name: string;
  size: number;
  lastModified: number;
}

export interface RecorderStats {
  bytesWritten: number;
  recordCount: number;
  fps: number;
  uptimeMs: number;
}

type ListenerMap = {
  ready: { sessionId: string; fileName: string };
  list: { sessions: SessionInfo[] };
  data: { sessionId: string; content: string };
  stats: { bytesWritten: number; recordCount: number };
  error: { message: string };
};

type Listener<K extends keyof ListenerMap> = (msg: ListenerMap[K]) => void;

export class Recorder {
  private _worker: Worker;
  private _sessionId = '';
  private _startTime = 0;
  private _frameId = 0;
  private _listeners = new Map<keyof ListenerMap, Set<Listener<keyof ListenerMap>>>();
  private _stats: RecorderStats = { bytesWritten: 0, recordCount: 0, fps: 0, uptimeMs: 0 };
  // Coalesce per-rAF records into one postMessage to avoid worker queue churn.
  private _pendingBatch: SessionRecord[] = [];
  private _batchTimer: ReturnType<typeof setTimeout> | null = null;
  // Frame counter for FPS computation
  private _frameTimes: number[] = [];

  constructor() {
    this._worker = new Worker(
      new URL('./recorder-worker.js', import.meta.url),
      { type: 'module' }
    );
    this._worker.onmessage = (e) => this._dispatch(e.data);
    this._worker.onerror = (e) => {
      // eslint-disable-next-line no-console
      console.warn('[Recorder] worker error:', e.message || e);
    };
  }

  /** Open a fresh session. Returns once the worker has confirmed file creation. */
  start(meta?: { schema?: unknown }): Promise<void> {
    this._sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    this._startTime = performance.now();
    this._frameId = 0;
    this._pendingBatch = [];

    return new Promise((resolve) => {
      const off = this.on('ready', () => { off(); resolve(); });
      this._worker.postMessage({
        type: 'init',
        sessionId: this._sessionId,
        meta: {
          startedAt: Date.now(),
          userAgent: navigator.userAgent,
          viewport: { w: window.innerWidth, h: window.innerHeight },
          ...meta,
        },
      });
    });
  }

  /** Capture one frame snapshot. Coalesced + sent to worker on the next macrotask tick. */
  recordFrame(snapshot: Omit<FrameRecord, 't' | 'type'>): void {
    const now = performance.now();
    this._frameTimes.push(now);
    while (this._frameTimes.length > 60) this._frameTimes.shift();
    if (this._frameTimes.length >= 2) {
      const span = this._frameTimes[this._frameTimes.length - 1] - this._frameTimes[0];
      this._stats.fps = span > 0 ? Math.round((this._frameTimes.length - 1) / span * 1000) : 0;
    }
    this._stats.uptimeMs = now - this._startTime;

    this._pendingBatch.push({
      t: now - this._startTime,
      type: 'frame',
      ...snapshot,
    });

    if (this._batchTimer === null) {
      this._batchTimer = setTimeout(() => this._flushBatch(), 0);
    }
  }

  private _flushBatch(): void {
    this._batchTimer = null;
    if (!this._pendingBatch.length) return;
    const records = this._pendingBatch;
    this._pendingBatch = [];
    this._worker.postMessage({ type: 'append', records });
  }

  /** Force a synchronous flush of the worker's OPFS file. */
  flush(): void {
    this._flushBatch();
    this._worker.postMessage({ type: 'flush' });
  }

  list(): void {
    this._worker.postMessage({ type: 'list' });
  }

  read(sessionId: string): void {
    this._worker.postMessage({ type: 'read', sessionId });
  }

  delete(sessionId: string): void {
    this._worker.postMessage({ type: 'delete', sessionId });
  }

  getStats(): RecorderStats {
    return { ...this._stats };
  }

  on<K extends keyof ListenerMap>(type: K, fn: Listener<K>): () => void {
    let set = this._listeners.get(type);
    if (!set) { set = new Set(); this._listeners.set(type, set); }
    set.add(fn as Listener<keyof ListenerMap>);
    return () => set!.delete(fn as Listener<keyof ListenerMap>);
  }

  private _dispatch(msg: { type: keyof ListenerMap } & ListenerMap[keyof ListenerMap]): void {
    if (msg.type === 'stats') {
      const s = msg as ListenerMap['stats'];
      this._stats.bytesWritten = s.bytesWritten;
      this._stats.recordCount = s.recordCount;
    }
    const set = this._listeners.get(msg.type);
    if (set) set.forEach((fn) => fn(msg as never));
  }
}

/** Parse an NDJSON session file into typed records. */
export function parseSession(content: string): SessionRecord[] {
  const out: SessionRecord[] = [];
  for (const line of content.split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip torn last line */ }
  }
  return out;
}

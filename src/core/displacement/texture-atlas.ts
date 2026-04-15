/**
 * Texture Atlas Manager for displacement maps
 *
 * Consolidates all displacement maps into a single texture to minimize
 * PNG encoding overhead. Instead of encoding N PNGs for N elements,
 * we encode 1 PNG atlas and use SVG viewBox clipping for each element.
 */

interface AtlasSlot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  borderRadius: number;
  edgeWidthRatio: number;
}

interface AtlasState {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  slots: Map<string, AtlasSlot>;
  dataUrl: string | null;
  dirty: boolean;
  width: number;
  height: number;
  nextY: number;  // Simple strip packing: stack vertically
}

// Singleton atlas instance
let _atlas: AtlasState | null = null;
let _updateScheduled = false;
let _updateCallbacks: Array<() => void> = [];
let _atlasVersion = 0;  // Increments on every rebuild to invalidate cached filters
let _rebuildListeners: Set<() => void> = new Set();

// Throttling for expensive toDataURL() calls
const ENCODE_THROTTLE_MS = 150;  // Minimum interval between encodes (ms)
let _lastEncodeTime = 0;
let _encodeThrottled = false;
let _encodeTimeout: ReturnType<typeof setTimeout> | null = null;
let _slotsRepositioned = false;  // True when slot positions changed, must encode before use
let _dataUrlStale = false;  // True when canvas changed but dataUrl not yet re-encoded

// Image encoding format configuration
export type ImageFormat = 'png' | 'webp' | 'jpeg';
let _imageFormat: ImageFormat = 'png';
let _imageQuality = 0.8;  // Quality for lossy formats (webp, jpeg)

/**
 * Set the image encoding format for the atlas
 * @param format - 'png' (lossless), 'webp' (fast, good compression), 'jpeg' (fastest, lossy)
 * @param quality - Quality for lossy formats (0-1, default 0.8)
 */
export function setAtlasImageFormat(format: ImageFormat, quality = 0.8): void {
  _imageFormat = format;
  _imageQuality = Math.max(0, Math.min(1, quality));
  // Force re-encode with new format
  const atlas = _atlas;
  if (atlas) {
    atlas.dirty = true;
    scheduleUpdate();
  }
}

/**
 * Get current image encoding format
 */
export function getAtlasImageFormat(): { format: ImageFormat; quality: number } {
  return { format: _imageFormat, quality: _imageQuality };
}

/**
 * Encode canvas to data URL with current format settings
 */
function encodeCanvas(canvas: HTMLCanvasElement): string {
  switch (_imageFormat) {
    case 'webp':
      return canvas.toDataURL('image/webp', _imageQuality);
    case 'jpeg':
      return canvas.toDataURL('image/jpeg', _imageQuality);
    case 'png':
    default:
      return canvas.toDataURL('image/png');
  }
}

// WASM module for SIMD acceleration
let _wasmModule: {
  memory: WebAssembly.Memory;
  generateDisplacementMapSIMD: (w: number, h: number, r: number, e: number) => void;
} | null = null;
let _wasmLoading: Promise<void> | null = null;

/**
 * Load WASM module for SIMD-accelerated pixel generation
 */
async function loadWasm(): Promise<void> {
  if (_wasmModule) return;
  if (_wasmLoading) {
    await _wasmLoading;
    return;
  }

  _wasmLoading = (async () => {
    try {
      const wasmUrl = new URL('../../../build/release.wasm', import.meta.url);
      const response = await fetch(wasmUrl);
      const wasmBytes = await response.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(wasmBytes, {});
      const exports = instance.exports as any;

      if (exports.memory.buffer.byteLength === 0) {
        exports.memory.grow(64); // 4MB
      }

      _wasmModule = {
        memory: exports.memory,
        generateDisplacementMapSIMD: exports.generateDisplacementMapSIMD
      };
    } catch (e) {
      console.warn('WASM atlas acceleration unavailable:', e);
    }
  })();

  await _wasmLoading;
}

/**
 * Initialize or get the texture atlas
 */
function getAtlas(): AtlasState {
  if (_atlas) return _atlas;

  const canvas = document.createElement('canvas');
  canvas.width = 2048;  // Max texture width
  canvas.height = 256;  // Initial height, grows as needed
  const ctx = canvas.getContext('2d')!;

  _atlas = {
    canvas,
    ctx,
    slots: new Map(),
    dataUrl: null,
    dirty: false,
    width: canvas.width,
    height: canvas.height,
    nextY: 0
  };

  return _atlas;
}

/**
 * Ensure atlas has enough vertical space
 */
function ensureAtlasHeight(atlas: AtlasState, requiredHeight: number): void {
  if (atlas.height >= requiredHeight) return;

  const newHeight = Math.min(4096, Math.pow(2, Math.ceil(Math.log2(requiredHeight))));
  if (newHeight === atlas.height) return;

  // Create new canvas with larger height
  const oldImageData = atlas.ctx.getImageData(0, 0, atlas.width, atlas.height);
  atlas.canvas.height = newHeight;
  atlas.height = newHeight;
  atlas.ctx.putImageData(oldImageData, 0, 0);
}

/**
 * Generate displacement map pixels using WASM SIMD
 */
function generatePixels(
  width: number,
  height: number,
  borderRadius: number,
  edgeWidthRatio: number
): ImageData | null {
  if (!_wasmModule) return null;

  const requiredBytes = width * height * 4;
  const currentSize = _wasmModule.memory.buffer.byteLength;
  if (currentSize < requiredBytes) {
    const pagesToGrow = Math.ceil((requiredBytes - currentSize) / 65536);
    _wasmModule.memory.grow(pagesToGrow);
  }

  _wasmModule.generateDisplacementMapSIMD(width, height, borderRadius, edgeWidthRatio);

  const pixels = new Uint8ClampedArray(_wasmModule.memory.buffer, 0, requiredBytes);
  const imageData = new ImageData(width, height);
  imageData.data.set(pixels);
  return imageData;
}

/**
 * Register or update a displacement map slot in the atlas
 *
 * IMPORTANT: Slot Y positions are STABLE once allocated. When dimensions change,
 * the slot is updated IN PLACE without affecting other slots' positions.
 * This prevents visual glitches during animation where multiple elements resize.
 */
export function registerSlot(
  id: string,
  width: number,
  height: number,
  borderRadius: number,
  edgeWidthRatio: number
): void {
  const atlas = getAtlas();
  const existing = atlas.slots.get(id);

  if (existing) {
    // Check if parameters changed
    if (
      existing.width === width &&
      existing.height === height &&
      existing.borderRadius === borderRadius &&
      existing.edgeWidthRatio === edgeWidthRatio
    ) {
      return; // No change needed
    }

    // Track if we need more vertical space
    const heightIncrease = height - existing.height;

    // Update slot parameters - keep Y position stable!
    existing.width = width;
    existing.height = height;
    existing.borderRadius = borderRadius;
    existing.edgeWidthRatio = edgeWidthRatio;

    // If height increased, we may need to expand the atlas
    // But we do NOT shift other slots' positions
    if (heightIncrease > 0) {
      // Check if this slot is at the end (can safely extend)
      // or if it overlaps with next slot (need compaction later)
      const slotEnd = existing.y + height;
      if (slotEnd > atlas.nextY) {
        atlas.nextY = slotEnd;
        ensureAtlasHeight(atlas, atlas.nextY);
      }
    }

    // Just mark dirty and schedule update - no position changes needed
    atlas.dirty = true;
    scheduleUpdate();
    return;
  }

  // Allocate new slot (simple strip packing)
  const slot: AtlasSlot = {
    id,
    x: 0,
    y: atlas.nextY,
    width,
    height,
    borderRadius,
    edgeWidthRatio
  };

  atlas.nextY += height;
  ensureAtlasHeight(atlas, atlas.nextY);
  atlas.slots.set(id, slot);
  atlas.dirty = true;
  scheduleUpdate();
}

/**
 * Unregister a slot from the atlas
 */
export function unregisterSlot(id: string): void {
  const atlas = getAtlas();
  if (atlas.slots.delete(id)) {
    // Rebuild atlas without this slot
    rebuildAtlas();
  }
}

/**
 * Rebuild the entire atlas (after slot removal or major changes)
 */
function rebuildAtlas(): void {
  const atlas = getAtlas();
  // Sort slots by ID for deterministic ordering
  // This ensures consistent Y positions regardless of registration order
  const slots = Array.from(atlas.slots.values()).sort((a, b) => a.id.localeCompare(b.id));

  // Reset positions
  atlas.nextY = 0;
  for (const slot of slots) {
    slot.x = 0;
    slot.y = atlas.nextY;
    atlas.nextY += slot.height;
  }

  ensureAtlasHeight(atlas, atlas.nextY);
  atlas.dirty = true;

  // Mark that slots have been repositioned - must encode before dataUrl can be used
  _slotsRepositioned = true;

  // Increment version to invalidate all cached filters
  _atlasVersion++;

  scheduleUpdate();

  // Notify all listeners that atlas was rebuilt (positions may have changed)
  // Use microtask to batch notifications
  queueMicrotask(() => {
    for (const listener of _rebuildListeners) {
      listener();
    }
  });
}

/**
 * Schedule atlas update (batched for performance)
 */
function scheduleUpdate(): void {
  if (_updateScheduled) return;
  _updateScheduled = true;

  // Use microtask for batching
  queueMicrotask(async () => {
    await updateAtlas();
    _updateScheduled = false;

    // Call all pending callbacks
    const callbacks = _updateCallbacks;
    _updateCallbacks = [];
    for (const cb of callbacks) cb();
  });
}

/**
 * Update the atlas texture
 */
async function updateAtlas(): Promise<void> {
  const atlas = getAtlas();
  if (!atlas.dirty) return;

  // Ensure WASM is loaded
  await loadWasm();

  // Clear canvas
  atlas.ctx.clearRect(0, 0, atlas.width, atlas.height);

  // Render each slot (sorted by Y position ascending)
  const sortedSlots = Array.from(atlas.slots.values()).sort((a, b) => a.y - b.y);
  for (const slot of sortedSlots) {
    const imageData = generatePixels(
      slot.width,
      slot.height,
      slot.borderRadius,
      slot.edgeWidthRatio
    );

    if (imageData) {
      atlas.ctx.putImageData(imageData, slot.x, slot.y);
    }
  }

  // Throttle expensive PNG encoding
  // BUT: always encode immediately if slots were repositioned (positions changed)
  const now = performance.now();
  const timeSinceLastEncode = now - _lastEncodeTime;
  const mustEncodeNow = _slotsRepositioned;  // Can't use old dataUrl if positions changed

  if (timeSinceLastEncode >= ENCODE_THROTTLE_MS || mustEncodeNow) {
    // Enough time has passed OR slots repositioned - encode immediately
    atlas.dataUrl = encodeCanvas(atlas.canvas);
    _lastEncodeTime = now;
    atlas.dirty = false;
    _dataUrlStale = false;
    _slotsRepositioned = false;  // Reset flag after encoding
  } else if (!_encodeThrottled) {
    // Schedule delayed encode
    _encodeThrottled = true;
    _dataUrlStale = true;  // Mark dataUrl as stale until encoding completes
    const delay = ENCODE_THROTTLE_MS - timeSinceLastEncode;

    if (_encodeTimeout) clearTimeout(_encodeTimeout);
    _encodeTimeout = setTimeout(() => {
      _encodeThrottled = false;
      _encodeTimeout = null;
      // Re-encode with latest canvas state
      const atlas = getAtlas();
      atlas.dataUrl = encodeCanvas(atlas.canvas);
      _lastEncodeTime = performance.now();
      atlas.dirty = false;
      _dataUrlStale = false;
      _slotsRepositioned = false;  // Reset flag after encoding

      // Notify any pending callbacks
      const callbacks = _updateCallbacks;
      _updateCallbacks = [];
      for (const cb of callbacks) cb();
    }, delay);

    // Mark pixels as not dirty, but dataUrl needs encoding
    atlas.dirty = false;
  } else {
    // Already throttled and encode is scheduled
    // Just mark pixels as not dirty, encode will happen later
    atlas.dirty = false;
  }
}

/**
 * Get the atlas data URL (waits for pending updates)
 */
export async function getAtlasDataUrl(): Promise<string> {
  const atlas = getAtlas();

  // Wait if pixels need rendering, dataUrl encoding is pending, or slots were repositioned
  // _slotsRepositioned means the current dataUrl has wrong slot positions
  if (atlas.dirty || !atlas.dataUrl || _dataUrlStale || _slotsRepositioned) {
    await new Promise<void>(resolve => {
      if (!_updateScheduled && (atlas.dirty || _slotsRepositioned)) {
        scheduleUpdate();
      }
      // If only dataUrl is stale (throttled), the timeout will call callbacks
      _updateCallbacks.push(resolve);
    });
  }

  return atlas.dataUrl!;
}

/**
 * Get slot info for building SVG reference
 */
export function getSlotInfo(id: string): AtlasSlot | null {
  const atlas = getAtlas();
  return atlas.slots.get(id) || null;
}

/**
 * Get atlas dimensions (actual canvas size, not logical used size)
 */
export function getAtlasDimensions(): { width: number; height: number } {
  const atlas = getAtlas();
  // Return actual canvas dimensions, not nextY (logical used height)
  // This is critical for SVG viewBox calculations since the PNG
  // will be the actual canvas size, and browsers scale images
  return { width: atlas.width, height: atlas.height };
}

/**
 * Generate SVG data URL that references a specific slot in the atlas
 * Uses viewBox clipping to extract the relevant portion
 */
export function createSlotSvgUrl(
  slotId: string,
  atlasDataUrl: string
): string | null {
  const slot = getSlotInfo(slotId);
  if (!slot) return null;

  const { width: atlasWidth, height: atlasHeight } = getAtlasDimensions();

  // Create inline SVG that clips to this slot's region
  // The SVG uses viewBox to show only the relevant portion of the atlas
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${slot.width}" height="${slot.height}" viewBox="${slot.x} ${slot.y} ${slot.width} ${slot.height}"><image href="${atlasDataUrl}" width="${atlasWidth}" height="${atlasHeight}"/></svg>`;

  // Encode as data URL
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/**
 * Preload WASM module
 */
export function preloadAtlas(): Promise<void> {
  return loadWasm();
}

/**
 * Get current atlas version (increments on every rebuild)
 */
export function getAtlasVersion(): number {
  return _atlasVersion;
}

/**
 * Subscribe to atlas rebuild notifications
 * Called when slot positions change and filters need to be refreshed
 */
export function onAtlasRebuild(callback: () => void): void {
  _rebuildListeners.add(callback);
}

/**
 * Unsubscribe from atlas rebuild notifications
 */
export function offAtlasRebuild(callback: () => void): void {
  _rebuildListeners.delete(callback);
}

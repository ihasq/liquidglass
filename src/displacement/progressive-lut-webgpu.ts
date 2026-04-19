/**
 * Progressive LUT Loader for WebGPU
 *
 * Loads SDLT (Segment Delta LUT) format with streaming decompression
 * and progressive texture updates.
 *
 * Flow:
 * 1. Fetch SDLT.gz with streaming response
 * 2. Decompress via DecompressionStream
 * 3. Decode Level 0 (16 samples) → interpolate → upload to texture
 * 4. Decode Level 1 (256 samples) → upload final quality
 *
 * GPU texture is usable immediately after Level 0 with bilinear filtering
 * providing smooth interpolation until Level 1 arrives.
 */

const PROFILE_COUNT = 6;
const LUT_SAMPLES = 256;
const SEGMENT_SIZE = 16;
const SEGMENTS = LUT_SAMPLES / SEGMENT_SIZE;

export interface ProgressiveLutUpdate {
  level: 0 | 1;
  progress: number;
  bytesLoaded: number;
}

export interface ProgressiveLutResources {
  texture: GPUTexture;
  textureView: GPUTextureView;
  sampler: GPUSampler;
}

/**
 * Convert R16F (half-float) to Float32
 */
function float16ToFloat32(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;

  if (e === 0) {
    return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  } else if (e === 0x1f) {
    return f ? NaN : (s ? -1 : 1) * Infinity;
  }

  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

/**
 * Interpolate full LUT from sparse Level 0 samples
 */
function interpolateFromLevel0(
  sparseValues: Float32Array,
  segmentSize: number,
  totalSamples: number
): Float32Array {
  const lut = new Float32Array(totalSamples);
  const segments = sparseValues.length;

  for (let seg = 0; seg < segments; seg++) {
    const startIdx = seg * segmentSize;
    const endIdx = Math.min((seg + 1) * segmentSize, totalSamples);

    const startVal = sparseValues[seg];
    const endVal = seg < segments - 1 ? sparseValues[seg + 1] : sparseValues[seg];

    for (let i = startIdx; i < endIdx; i++) {
      const t = (i - startIdx) / segmentSize;
      lut[i] = startVal * (1 - t) + endVal * t;
    }
  }

  return lut;
}

/**
 * Progressive LUT Loader for WebGPU
 */
export class ProgressiveLutLoaderWebGPU {
  private device: GPUDevice;
  private url: string;
  private texture: GPUTexture | null = null;
  private textureView: GPUTextureView | null = null;
  private sampler: GPUSampler | null = null;
  private currentLevel: -1 | 0 | 1 = -1;

  constructor(device: GPUDevice, url: string) {
    this.device = device;
    this.url = url;
  }

  /**
   * Create GPU texture for LUT atlas
   */
  private createTexture(): void {
    this.texture = this.device.createTexture({
      label: 'progressive-lut-atlas',
      size: [LUT_SAMPLES, PROFILE_COUNT, 1],
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.textureView = this.texture.createView({
      label: 'progressive-lut-view',
    });

    this.sampler = this.device.createSampler({
      label: 'progressive-lut-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  /**
   * Upload a single profile row to the texture
   */
  private uploadProfileRow(profileIndex: number, data: Float32Array): void {
    if (!this.texture) return;

    this.device.queue.writeTexture(
      {
        texture: this.texture,
        origin: [0, profileIndex, 0],
      },
      data.buffer,
      {
        bytesPerRow: LUT_SAMPLES * 4,
        rowsPerImage: 1,
      },
      {
        width: LUT_SAMPLES,
        height: 1,
        depthOrArrayLayers: 1,
      }
    );
  }

  /**
   * Load LUT progressively with streaming
   */
  async *load(): AsyncGenerator<ProgressiveLutUpdate> {
    // Create texture immediately
    this.createTexture();

    const response = await fetch(this.url);

    if (!response.ok) {
      throw new Error(`Failed to load LUT: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    // Set up decompression stream
    const decompressor = new DecompressionStream('gzip');
    const reader = response.body.pipeThrough(decompressor).getReader();

    // State
    let buffer = new Uint8Array(0);
    let bytesLoaded = 0;

    // Header info
    let headerParsed = false;
    let profileCount = 0;
    let samples = 0;
    let segmentSize = 0;
    let segments = 0;
    const headerSize = 8;

    // Level sizes
    let level0Size = 0;
    let level1Size = 0;
    let level0End = 0;

    // Decoded data
    const level0Values: Float32Array[] = [];
    let level0Decoded = false;
    let level1Decoded = false;

    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        const newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;
        bytesLoaded += value.length;
      }

      // Parse header
      if (!headerParsed && buffer.length >= headerSize) {
        const magic = String.fromCharCode(...buffer.slice(0, 4));
        if (magic !== 'SDLT') {
          throw new Error(`Invalid SDLT magic: ${magic}`);
        }

        const view = new DataView(buffer.buffer, buffer.byteOffset);
        profileCount = buffer[4];
        samples = view.getUint16(5, true);
        segmentSize = buffer[7];
        segments = samples / segmentSize;

        level0Size = segments * profileCount * 2;
        level1Size = (segmentSize - 1) * segments * profileCount * 2;
        level0End = headerSize + level0Size;

        // Initialize level0 arrays
        for (let p = 0; p < profileCount; p++) {
          level0Values.push(new Float32Array(segments));
        }

        headerParsed = true;
      }

      // Decode Level 0 and upload interpolated preview
      if (headerParsed && !level0Decoded && buffer.length >= level0End) {
        const view = new DataView(buffer.buffer, buffer.byteOffset);
        let offset = headerSize;

        for (let p = 0; p < profileCount; p++) {
          let prev = 0;
          for (let seg = 0; seg < segments; seg++) {
            const delta = float16ToFloat32(view.getUint16(offset, true));
            offset += 2;
            const val = prev + delta;
            level0Values[p][seg] = val;
            prev = val;
          }

          // Interpolate to full resolution and upload
          const interpolated = interpolateFromLevel0(level0Values[p], segmentSize, samples);
          this.uploadProfileRow(p, interpolated);
        }

        level0Decoded = true;
        this.currentLevel = 0;

        yield {
          level: 0,
          progress: segments / samples,
          bytesLoaded,
        };
      }

      // Decode Level 1 and upload final quality
      if (headerParsed && level0Decoded && !level1Decoded &&
          buffer.length >= headerSize + level0Size + level1Size) {
        const view = new DataView(buffer.buffer, buffer.byteOffset);
        let offset = level0End;

        for (let p = 0; p < profileCount; p++) {
          const lut = new Float32Array(samples);

          // Copy Level 0 anchor values
          for (let seg = 0; seg < segments; seg++) {
            lut[seg * segmentSize] = level0Values[p][seg];
          }

          // Decode segment deltas
          for (let seg = 0; seg < segments; seg++) {
            const segStart = seg * segmentSize;
            let prev = lut[segStart];

            for (let i = 1; i < segmentSize; i++) {
              const idx = segStart + i;
              if (idx >= samples) break;

              const delta = float16ToFloat32(view.getUint16(offset, true));
              offset += 2;
              const val = prev + delta;
              lut[idx] = val;
              prev = val;
            }
          }

          // Upload final quality
          this.uploadProfileRow(p, lut);
        }

        level1Decoded = true;
        this.currentLevel = 1;

        yield {
          level: 1,
          progress: 1,
          bytesLoaded,
        };
      }

      if (done) break;
    }
  }

  /**
   * Get current texture resources (may be partially loaded)
   */
  getResources(): ProgressiveLutResources | null {
    if (!this.texture || !this.textureView || !this.sampler) {
      return null;
    }

    return {
      texture: this.texture,
      textureView: this.textureView,
      sampler: this.sampler,
    };
  }

  /**
   * Get current quality level (-1 = not loaded, 0 = preview, 1 = full)
   */
  getCurrentLevel(): -1 | 0 | 1 {
    return this.currentLevel;
  }

  /**
   * Check if texture is ready for use (at least Level 0 loaded)
   */
  isReady(): boolean {
    return this.currentLevel >= 0;
  }

  /**
   * Check if full quality is loaded
   */
  isFullQuality(): boolean {
    return this.currentLevel === 1;
  }

  /**
   * Destroy resources
   */
  destroy(): void {
    this.texture?.destroy();
    this.texture = null;
    this.textureView = null;
    this.sampler = null;
    this.currentLevel = -1;
  }
}

// ============================================================================
// Singleton Progressive Loader
// ============================================================================

let _progressiveLoader: ProgressiveLutLoaderWebGPU | null = null;
let _loadingPromise: Promise<ProgressiveLutResources> | null = null;
let _onProgressCallbacks: ((update: ProgressiveLutUpdate) => void)[] = [];

/**
 * Initialize progressive LUT loading for WebGPU
 *
 * @param device - WebGPU device
 * @param url - URL to SDLT.gz file
 * @param onProgress - Optional callback for progress updates
 * @returns Promise that resolves when at least Level 0 is loaded
 */
export async function initProgressiveLutWebGPU(
  device: GPUDevice,
  url: string,
  onProgress?: (update: ProgressiveLutUpdate) => void
): Promise<ProgressiveLutResources> {
  // Register callback
  if (onProgress) {
    _onProgressCallbacks.push(onProgress);
  }

  // Return existing loading promise if in progress
  if (_loadingPromise) {
    return _loadingPromise;
  }

  // Create new loader
  _progressiveLoader = new ProgressiveLutLoaderWebGPU(device, url);

  _loadingPromise = (async () => {
    let resources: ProgressiveLutResources | null = null;

    for await (const update of _progressiveLoader!.load()) {
      // Notify all callbacks
      for (const cb of _onProgressCallbacks) {
        cb(update);
      }

      // Capture resources on first level
      if (update.level === 0) {
        resources = _progressiveLoader!.getResources();
      }
    }

    if (!resources) {
      throw new Error('Failed to load LUT');
    }

    return resources;
  })();

  return _loadingPromise;
}

/**
 * Get current progressive LUT resources (if available)
 */
export function getProgressiveLutResourcesWebGPU(): ProgressiveLutResources | null {
  return _progressiveLoader?.getResources() ?? null;
}

/**
 * Check if progressive LUT is ready for use
 */
export function isProgressiveLutReadyWebGPU(): boolean {
  return _progressiveLoader?.isReady() ?? false;
}

/**
 * Check if full quality LUT is loaded
 */
export function isProgressiveLutFullQualityWebGPU(): boolean {
  return _progressiveLoader?.isFullQuality() ?? false;
}

/**
 * Destroy progressive LUT resources
 */
export function destroyProgressiveLutWebGPU(): void {
  _progressiveLoader?.destroy();
  _progressiveLoader = null;
  _loadingPromise = null;
  _onProgressCallbacks = [];
}

export default ProgressiveLutLoaderWebGPU;

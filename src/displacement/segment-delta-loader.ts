/**
 * Segment Delta Progressive LUT Loader
 *
 * Loads SDLT (Segment Delta LUT) format with streaming decompression.
 * Provides progressive rendering: Level 0 (16 samples) → Level 1 (256 samples)
 *
 * Format:
 * - Header: "SDLT" (4) + profiles (1) + samples (2) + segmentSize (1) = 8 bytes
 * - Level 0: Delta-encoded sparse samples (segmentSize anchors per profile)
 * - Level 1: Segment-delta encoded remaining samples
 *
 * @example
 * ```ts
 * const loader = new SegmentDeltaLoader('/luts/segment-delta.sdlt.gz');
 *
 * for await (const update of loader.load()) {
 *   if (update.level === 0) {
 *     // 16 samples available, interpolated to 256
 *     renderPreview(update.luts);
 *   } else {
 *     // Full 256 samples
 *     renderFinal(update.luts);
 *   }
 * }
 * ```
 */

export interface SegmentDeltaUpdate {
  level: 0 | 1;
  progress: number;
  bytesLoaded: number;
  luts: Record<string, Float32Array>;
}

export interface SegmentDeltaLoaderOptions {
  profileNames?: string[];
}

const DEFAULT_PROFILES = ['exponential', 'squircle', 'circle', 'parabolic', 'cosine', 'linear'];

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
 * Segment Delta Progressive LUT Loader
 */
export class SegmentDeltaLoader {
  private url: string;
  private profileNames: string[];

  constructor(url: string, options: SegmentDeltaLoaderOptions = {}) {
    this.url = url;
    this.profileNames = options.profileNames || DEFAULT_PROFILES;
  }

  /**
   * Interpolate full LUT from sparse Level 0 samples
   */
  private interpolateFromLevel0(
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
   * Load LUT data progressively
   */
  async *load(): AsyncGenerator<SegmentDeltaUpdate> {
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
    let headerSize = 8;

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

      // Decode Level 0
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
        }

        // Interpolate and yield Level 0
        const luts: Record<string, Float32Array> = {};
        for (let p = 0; p < profileCount; p++) {
          const name = this.profileNames[p] || `profile_${p}`;
          luts[name] = this.interpolateFromLevel0(level0Values[p], segmentSize, samples);
        }

        level0Decoded = true;

        yield {
          level: 0,
          progress: segments / samples,
          bytesLoaded,
          luts,
        };
      }

      // Decode Level 1
      if (headerParsed && level0Decoded && !level1Decoded && buffer.length >= headerSize + level0Size + level1Size) {
        const view = new DataView(buffer.buffer, buffer.byteOffset);
        let offset = level0End;

        const luts: Record<string, Float32Array> = {};

        for (let p = 0; p < profileCount; p++) {
          const name = this.profileNames[p] || `profile_${p}`;
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

          luts[name] = lut;
        }

        level1Decoded = true;

        yield {
          level: 1,
          progress: 1,
          bytesLoaded,
          luts,
        };
      }

      if (done) break;
    }
  }

  /**
   * Load entire LUT at once (non-progressive)
   */
  async loadFull(): Promise<Record<string, Float32Array>> {
    let result: Record<string, Float32Array> = {};

    for await (const update of this.load()) {
      result = update.luts;
    }

    return result;
  }
}

/**
 * Create LUT texture with progressive loading
 */
export async function createProgressiveSDLTTexture(
  gl: WebGL2RenderingContext,
  url: string,
  onProgress?: (level: 0 | 1, progress: number) => void
): Promise<WebGLTexture> {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create texture');

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Initialize empty texture
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 256, 6, 0, gl.RED, gl.FLOAT, null);

  const loader = new SegmentDeltaLoader(url);

  for await (const update of loader.load()) {
    const profiles = Object.keys(update.luts);

    for (let row = 0; row < profiles.length; row++) {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        row,
        256,
        1,
        gl.RED,
        gl.FLOAT,
        update.luts[profiles[row]]
      );
    }

    onProgress?.(update.level, update.progress);
  }

  return texture;
}

export default SegmentDeltaLoader;

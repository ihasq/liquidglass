/**
 * Progressive LUT Loader
 *
 * Loads LUT data progressively using DecompressionStream,
 * enabling progressive rendering while data is still loading.
 *
 * Format: PLUT (Progressive LUT)
 * - Header: "PLUT" (4 bytes) + profileCount (1) + sampleCount (2) + levelBoundaries (2 × numLevels)
 * - Data: Interleaved samples by level, then by profile
 *
 * @example
 * ```ts
 * const loader = new ProgressiveLUTLoader('/luts/progressive.plut.gz');
 *
 * for await (const update of loader.load()) {
 *   console.log(`Level ${update.level}: ${update.progress * 100}% loaded`);
 *   // update.luts contains interpolated LUT data for each profile
 *   renderWithLUT(update.luts.exponential);
 * }
 * ```
 */

export interface ProgressiveLUTUpdate {
  level: number;
  samplesDecoded: number;
  totalSamples: number;
  progress: number;
  bytesLoaded: number;
  luts: Record<string, Float32Array>;
  maxInterpolationError: number;
}

export interface ProgressiveLUTLoaderOptions {
  /** Profile names in order (default: standard 6 profiles) */
  profileNames?: string[];
  /** Expected sample count (default: 256) */
  sampleCount?: number;
}

const DEFAULT_PROFILES = ['exponential', 'squircle', 'circle', 'parabolic', 'cosine', 'linear'];

/**
 * Progressive LUT Loader with streaming decompression
 */
export class ProgressiveLUTLoader {
  private url: string;
  private profileNames: string[];
  private sampleCount: number;

  constructor(url: string, options: ProgressiveLUTLoaderOptions = {}) {
    this.url = url;
    this.profileNames = options.profileNames || DEFAULT_PROFILES;
    this.sampleCount = options.sampleCount || 256;
  }

  /**
   * Generate interleaved sample indices (2 levels: 16 -> 256)
   */
  private generateInterleavedIndices(): number[][] {
    const levels: number[][] = [];

    // Level 0: 16 evenly spaced samples (indices 0, 16, 32, ..., 240)
    const level0: number[] = [];
    const step0 = this.sampleCount / 16;
    for (let i = 0; i < this.sampleCount; i += step0) {
      level0.push(i);
    }
    levels.push(level0);

    // Level 1: remaining 240 samples
    const level0Set = new Set(level0);
    const level1: number[] = [];
    for (let i = 0; i < this.sampleCount; i++) {
      if (!level0Set.has(i)) {
        level1.push(i);
      }
    }
    levels.push(level1);

    return levels;
  }

  /**
   * Interpolate full LUT from sparse samples
   */
  private interpolateLUT(
    samples: Map<number, number>,
    indices: number[]
  ): Float32Array {
    const lut = new Float32Array(this.sampleCount);
    const sortedIndices = [...indices].sort((a, b) => a - b);

    for (let i = 0; i < this.sampleCount; i++) {
      let lower = sortedIndices[0];
      let upper = sortedIndices[sortedIndices.length - 1];

      for (const idx of sortedIndices) {
        if (idx <= i) lower = idx;
        if (idx >= i) {
          upper = idx;
          break;
        }
      }

      if (lower === upper || !samples.has(lower) || !samples.has(upper)) {
        lut[i] = samples.get(lower) ?? samples.get(upper) ?? 0;
      } else {
        const t = (i - lower) / (upper - lower);
        lut[i] = samples.get(lower)! * (1 - t) + samples.get(upper)! * t;
      }
    }

    return lut;
  }

  /**
   * Convert R16F (half-float) to Float32
   */
  private float16ToFloat32(h: number): number {
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
   * Load LUT data progressively
   */
  async *load(): AsyncGenerator<ProgressiveLUTUpdate> {
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

    const levels = this.generateInterleavedIndices();
    const profileCount = this.profileNames.length;

    // State
    let buffer = new Uint8Array(0);
    let headerParsed = false;
    let levelBoundaries: number[] = [];
    let currentLevel = 0;
    let bytesLoaded = 0;

    // Sample storage per profile
    const profileSamples: Map<number, number>[] = this.profileNames.map(() => new Map());
    let decodedIndices: number[] = [];

    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        // Append to buffer
        const newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;
        bytesLoaded += value.length;
      }

      // Parse header
      if (!headerParsed && buffer.length >= 7) {
        const magic = String.fromCharCode(...buffer.slice(0, 4));
        if (magic !== 'PLUT') {
          throw new Error(`Invalid PLUT magic: ${magic}`);
        }

        const view = new DataView(buffer.buffer, buffer.byteOffset);
        const fileProfileCount = buffer[4];
        const fileSampleCount = view.getUint16(5, true);

        if (fileProfileCount !== profileCount) {
          console.warn(`Profile count mismatch: expected ${profileCount}, got ${fileProfileCount}`);
        }

        // Read level boundaries
        const numLevels = Math.ceil(Math.log2(fileSampleCount));
        for (let i = 0; i < numLevels; i++) {
          levelBoundaries.push(view.getUint16(7 + i * 2, true));
        }

        headerParsed = true;
      }

      // Process available data
      if (headerParsed) {
        const headerSize = 7 + levelBoundaries.length * 2;
        const view = new DataView(buffer.buffer, buffer.byteOffset);

        // Calculate how many complete samples we have
        const dataBytes = buffer.length - headerSize;
        const bytesPerSampleSet = profileCount * 2; // R16F per profile
        const completeSampleSets = Math.floor(dataBytes / bytesPerSampleSet);

        // Decode new samples
        while (currentLevel < levels.length) {
          const levelEndSamples = levelBoundaries[currentLevel];

          if (completeSampleSets >= levelEndSamples) {
            // Decode samples for this level
            const levelStartSamples = currentLevel > 0 ? levelBoundaries[currentLevel - 1] : 0;

            for (let s = levelStartSamples; s < levelEndSamples; s++) {
              const sampleIdx = levels.flat()[s];
              decodedIndices.push(sampleIdx);

              const dataOffset = headerSize + s * bytesPerSampleSet;

              for (let p = 0; p < profileCount; p++) {
                const r16f = view.getUint16(dataOffset + p * 2, true);
                const value = this.float16ToFloat32(r16f);
                profileSamples[p].set(sampleIdx, value);
              }
            }

            // Interpolate LUTs for all profiles
            const luts: Record<string, Float32Array> = {};
            for (let p = 0; p < profileCount; p++) {
              luts[this.profileNames[p]] = this.interpolateLUT(
                profileSamples[p],
                decodedIndices
              );
            }

            // Estimate interpolation error (decreases with each level)
            const maxError = currentLevel < levels.length - 1
              ? Math.pow(0.5, currentLevel + 1)
              : 0;

            yield {
              level: currentLevel,
              samplesDecoded: decodedIndices.length,
              totalSamples: this.sampleCount,
              progress: decodedIndices.length / this.sampleCount,
              bytesLoaded,
              luts,
              maxInterpolationError: maxError,
            };

            currentLevel++;
          } else {
            break;
          }
        }
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
 * Create a progressive LUT texture that updates as data loads
 */
export async function createProgressiveLUTTexture(
  gl: WebGL2RenderingContext,
  url: string,
  onProgress?: (progress: number) => void
): Promise<WebGLTexture> {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create texture');

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Initialize with empty texture
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R32F,
    256,
    6,
    0,
    gl.RED,
    gl.FLOAT,
    null
  );

  const loader = new ProgressiveLUTLoader(url);

  for await (const update of loader.load()) {
    // Update texture with new data
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

    onProgress?.(update.progress);
  }

  return texture;
}

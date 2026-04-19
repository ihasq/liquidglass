/**
 * Streaming LUT Loader for WebGL2
 *
 * Uses texSubImage2D for progressive texture updates.
 * Delta decoding must happen on CPU (no compute shaders in WebGL2).
 *
 * Data flow:
 * Network → Decompress → CPU decode → texSubImage2D → Texture
 *
 * Optimization: Row-by-row streaming upload
 * - Each profile row uploaded immediately after decoding
 * - Texture usable as soon as any row is uploaded
 */

const PROFILE_COUNT = 6;
const LUT_SAMPLES = 256;
const SEGMENT_SIZE = 16;
const SEGMENTS = LUT_SAMPLES / SEGMENT_SIZE;
const HEADER_SIZE = 8;

export interface StreamingLutUpdateGL2 {
  level: 0 | 1;
  progress: number;
  bytesLoaded: number;
  decodeTime: number;
  uploadTime: number;
  profilesUploaded: number;
}

export interface StreamingLutResourcesGL2 {
  texture: WebGLTexture;
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
 * Interpolate full LUT from sparse samples
 */
function interpolateFromSparse(sparse: Float32Array): Float32Array {
  const lut = new Float32Array(LUT_SAMPLES);
  const segments = sparse.length;

  for (let seg = 0; seg < segments; seg++) {
    const startIdx = seg * SEGMENT_SIZE;
    const endIdx = Math.min((seg + 1) * SEGMENT_SIZE, LUT_SAMPLES);
    const startVal = sparse[seg];
    const endVal = seg < segments - 1 ? sparse[seg + 1] : sparse[seg];

    for (let i = startIdx; i < endIdx; i++) {
      const t = (i - startIdx) / SEGMENT_SIZE;
      lut[i] = startVal * (1 - t) + endVal * t;
    }
  }

  return lut;
}

/**
 * Streaming LUT Loader for WebGL2
 */
export class StreamingLutLoaderGL2 {
  private gl: WebGL2RenderingContext;
  private url: string;

  private texture: WebGLTexture | null = null;
  private currentLevel: -1 | 0 | 1 = -1;
  private useFloat: boolean = false;

  // Reusable upload buffer to avoid allocations
  private uploadBuffer: Float32Array;

  constructor(gl: WebGL2RenderingContext, url: string) {
    this.gl = gl;
    this.url = url;
    this.uploadBuffer = new Float32Array(LUT_SAMPLES);
  }

  private initialize(): void {
    const gl = this.gl;

    // Check for float texture support
    const ext = gl.getExtension('OES_texture_float_linear');
    this.useFloat = !!ext;

    // Create texture
    this.texture = gl.createTexture();
    if (!this.texture) throw new Error('Failed to create texture');

    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    // Initialize empty texture
    if (this.useFloat) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R32F,
        LUT_SAMPLES,
        PROFILE_COUNT,
        0,
        gl.RED,
        gl.FLOAT,
        null
      );
    } else {
      // Fallback to R8
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8,
        LUT_SAMPLES,
        PROFILE_COUNT,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        null
      );
    }

    // Set filtering
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Upload a single row to texture using texSubImage2D
   */
  private uploadRow(profileIndex: number, data: Float32Array): void {
    const gl = this.gl;
    if (!this.texture) return;

    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    if (this.useFloat) {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,               // xoffset
        profileIndex,    // yoffset (row)
        LUT_SAMPLES,     // width
        1,               // height (single row)
        gl.RED,
        gl.FLOAT,
        data
      );
    } else {
      // Convert to R8
      const r8Data = new Uint8Array(LUT_SAMPLES);
      for (let i = 0; i < LUT_SAMPLES; i++) {
        r8Data[i] = Math.round(Math.max(0, Math.min(1, data[i])) * 255);
      }
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        profileIndex,
        LUT_SAMPLES,
        1,
        gl.RED,
        gl.UNSIGNED_BYTE,
        r8Data
      );
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Load with streaming row-by-row upload
   */
  async *load(): AsyncGenerator<StreamingLutUpdateGL2> {
    this.initialize();

    const response = await fetch(this.url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to load: ${response.status}`);
    }

    const decompressor = new DecompressionStream('gzip');
    const reader = response.body.pipeThrough(decompressor).getReader();

    let buffer = new Uint8Array(0);
    let bytesLoaded = 0;
    let headerParsed = false;
    let profileCount = 0;
    let samples = 0;
    let segmentSize = 0;
    let segments = 0;
    let level0Size = 0;
    let level1Size = 0;
    let level0Decoded = false;
    let level1Decoded = false;

    // Store sparse values for Level 1 decode
    const sparseValues: Float32Array[] = [];

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
      if (!headerParsed && buffer.length >= HEADER_SIZE) {
        const view = new DataView(buffer.buffer, buffer.byteOffset);
        profileCount = buffer[4];
        samples = view.getUint16(5, true);
        segmentSize = buffer[7];
        segments = samples / segmentSize;

        level0Size = segments * profileCount * 2;
        level1Size = (segmentSize - 1) * segments * profileCount * 2;

        for (let p = 0; p < profileCount; p++) {
          sparseValues.push(new Float32Array(segments));
        }

        headerParsed = true;
      }

      // Decode and upload Level 0 (row by row)
      if (headerParsed && !level0Decoded && buffer.length >= HEADER_SIZE + level0Size) {
        const decodeStart = performance.now();
        const view = new DataView(buffer.buffer, buffer.byteOffset);
        let offset = HEADER_SIZE;

        for (let p = 0; p < profileCount; p++) {
          // Decode sparse anchors
          let prev = 0;
          for (let seg = 0; seg < segments; seg++) {
            const delta = float16ToFloat32(view.getUint16(offset, true));
            offset += 2;
            sparseValues[p][seg] = prev + delta;
            prev = sparseValues[p][seg];
          }
        }

        const decodeTime = performance.now() - decodeStart;

        // Upload each profile row
        const uploadStart = performance.now();
        for (let p = 0; p < profileCount; p++) {
          const interpolated = interpolateFromSparse(sparseValues[p]);
          this.uploadRow(p, interpolated);
        }
        const uploadTime = performance.now() - uploadStart;

        level0Decoded = true;
        this.currentLevel = 0;

        yield {
          level: 0,
          progress: segments / samples,
          bytesLoaded,
          decodeTime,
          uploadTime,
          profilesUploaded: profileCount,
        };
      }

      // Decode and upload Level 1
      if (headerParsed && level0Decoded && !level1Decoded &&
          buffer.length >= HEADER_SIZE + level0Size + level1Size) {
        const decodeStart = performance.now();
        const view = new DataView(buffer.buffer, buffer.byteOffset);
        let offset = HEADER_SIZE + level0Size;

        const fullLuts: Float32Array[] = [];

        for (let p = 0; p < profileCount; p++) {
          const lut = new Float32Array(samples);

          // Copy anchor values
          for (let seg = 0; seg < segments; seg++) {
            lut[seg * segmentSize] = sparseValues[p][seg];
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
              lut[idx] = prev + delta;
              prev = lut[idx];
            }
          }

          fullLuts.push(lut);
        }

        const decodeTime = performance.now() - decodeStart;

        // Upload each row
        const uploadStart = performance.now();
        for (let p = 0; p < profileCount; p++) {
          this.uploadRow(p, fullLuts[p]);
        }
        const uploadTime = performance.now() - uploadStart;

        level1Decoded = true;
        this.currentLevel = 1;

        yield {
          level: 1,
          progress: 1,
          bytesLoaded,
          decodeTime,
          uploadTime,
          profilesUploaded: profileCount,
        };
      }

      if (done) break;
    }
  }

  getResources(): StreamingLutResourcesGL2 | null {
    if (!this.texture) return null;
    return { texture: this.texture };
  }

  getCurrentLevel(): -1 | 0 | 1 { return this.currentLevel; }
  isReady(): boolean { return this.currentLevel >= 0; }
  isFullQuality(): boolean { return this.currentLevel === 1; }

  destroy(): void {
    if (this.texture) {
      this.gl.deleteTexture(this.texture);
    }
    this.texture = null;
    this.currentLevel = -1;
  }
}

// ============================================================================
// Singleton API
// ============================================================================

let _loaderGL2: StreamingLutLoaderGL2 | null = null;
let _loadPromiseGL2: Promise<StreamingLutResourcesGL2> | null = null;

export async function initStreamingLutWebGL2(
  gl: WebGL2RenderingContext,
  url: string,
  onProgress?: (update: StreamingLutUpdateGL2) => void
): Promise<StreamingLutResourcesGL2> {
  if (_loadPromiseGL2) return _loadPromiseGL2;

  _loaderGL2 = new StreamingLutLoaderGL2(gl, url);

  _loadPromiseGL2 = (async () => {
    let resources: StreamingLutResourcesGL2 | null = null;
    for await (const update of _loaderGL2!.load()) {
      onProgress?.(update);
      if (update.level === 0) {
        resources = _loaderGL2!.getResources();
      }
    }
    if (!resources) throw new Error('Failed to load LUT');
    return resources;
  })();

  return _loadPromiseGL2;
}

export function getStreamingLutResourcesGL2(): StreamingLutResourcesGL2 | null {
  return _loaderGL2?.getResources() ?? null;
}

export function destroyStreamingLutGL2(): void {
  _loaderGL2?.destroy();
  _loaderGL2 = null;
  _loadPromiseGL2 = null;
}

export default StreamingLutLoaderGL2;

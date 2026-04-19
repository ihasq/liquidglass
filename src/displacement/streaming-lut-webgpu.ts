/**
 * Streaming LUT Loader for WebGPU - Direct Texture Write
 *
 * Optimized streaming approach:
 * 1. Use mappedAtCreation buffer for zero-copy upload
 * 2. Compute shader decodes AND writes directly to texture
 * 3. Single dispatch per level (no intermediate copies)
 *
 * Data flow:
 * Network → Decompress → Mapped Buffer (zero-copy) → Compute → Texture
 *
 * Key optimizations:
 * - mappedAtCreation: CPU can write directly to GPU-visible memory
 * - Storage texture: Compute shader writes directly (no copyBufferToTexture)
 * - Batch dispatch: All profiles processed in single dispatch
 */

const PROFILE_COUNT = 6;
const LUT_SAMPLES = 256;
const SEGMENT_SIZE = 16;
const SEGMENTS = LUT_SAMPLES / SEGMENT_SIZE;
const HEADER_SIZE = 8;

// Compute shader for streaming decode
const STREAMING_DECODE_SHADER = /* wgsl */`
// Constants
const SAMPLES: u32 = 256u;
const SEGMENT_SIZE: u32 = 16u;
const SEGMENTS: u32 = 16u;

struct DecodeParams {
  level: u32,
  profileCount: u32,
  dataOffset: u32,  // Byte offset in input buffer
  _pad: u32,
}

@group(0) @binding(0) var<uniform> params: DecodeParams;
@group(0) @binding(1) var<storage, read> inputData: array<u32>;
@group(0) @binding(2) var outputTexture: texture_storage_2d<r32float, write>;

var<workgroup> anchors: array<f32, 16>;
var<workgroup> deltas: array<f32, 256>;

fn float16ToFloat32(h: u32) -> f32 {
  let s = (h >> 15u) & 1u;
  let e = (h >> 10u) & 0x1Fu;
  let f = h & 0x3FFu;

  if (e == 0u) {
    return select(1.0, -1.0, s == 1u) * pow(2.0, -14.0) * (f32(f) / 1024.0);
  }
  if (e == 31u) {
    return select(0.0, 0.0, true); // Simplified: treat as 0
  }
  return select(1.0, -1.0, s == 1u) * pow(2.0, f32(e) - 15.0) * (1.0 + f32(f) / 1024.0);
}

fn readU16(byteOffset: u32) -> u32 {
  let wordIdx = byteOffset / 4u;
  let byteInWord = byteOffset % 4u;
  let word = inputData[wordIdx];

  if (byteInWord == 0u) {
    return word & 0xFFFFu;
  } else if (byteInWord == 2u) {
    return (word >> 16u) & 0xFFFFu;
  } else if (byteInWord == 1u) {
    let nextWord = inputData[wordIdx + 1u];
    return ((word >> 8u) & 0xFFu) | ((nextWord & 0xFFu) << 8u);
  } else { // byteInWord == 3
    let nextWord = inputData[wordIdx + 1u];
    return ((word >> 24u) & 0xFFu) | ((nextWord & 0xFFu) << 8u);
  }
}

// Level 0: Decode sparse anchors + interpolate
// Workgroup: 1 per profile, 256 threads (one per output sample)
@compute @workgroup_size(256, 1, 1)
fn decodeLevel0(
  @builtin(workgroup_id) wgId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>
) {
  let profile = wgId.x;
  let sampleIdx = localId.x;

  if (profile >= params.profileCount) { return; }

  // Phase 1: First 16 threads decode anchors
  if (sampleIdx < SEGMENTS) {
    let byteOffset = params.dataOffset + (profile * SEGMENTS + sampleIdx) * 2u;
    let delta = float16ToFloat32(readU16(byteOffset));
    deltas[sampleIdx] = delta;
  }
  workgroupBarrier();

  // Phase 2: Prefix sum for anchors (thread 0 only for simplicity)
  if (sampleIdx == 0u) {
    var acc = 0.0;
    for (var i = 0u; i < SEGMENTS; i++) {
      acc += deltas[i];
      anchors[i] = acc;
    }
  }
  workgroupBarrier();

  // Phase 3: All threads interpolate and write
  let segIdx = sampleIdx / SEGMENT_SIZE;
  let segOffset = sampleIdx % SEGMENT_SIZE;

  let startVal = anchors[segIdx];
  let endVal = select(anchors[segIdx + 1u], startVal, segIdx >= SEGMENTS - 1u);
  let t = f32(segOffset) / f32(SEGMENT_SIZE);
  let interpolated = startVal * (1.0 - t) + endVal * t;

  textureStore(outputTexture, vec2<i32>(i32(sampleIdx), i32(profile)), vec4<f32>(interpolated, 0.0, 0.0, 1.0));
}

// Level 1: Decode full quality
// Workgroup: 1 per profile, 256 threads
@compute @workgroup_size(256, 1, 1)
fn decodeLevel1(
  @builtin(workgroup_id) wgId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>
) {
  let profile = wgId.x;
  let sampleIdx = localId.x;

  if (profile >= params.profileCount) { return; }

  // Calculate offsets
  let l0Size = SEGMENTS * params.profileCount * 2u;
  let l0Offset = params.dataOffset;
  let l1Offset = params.dataOffset + l0Size;

  // Phase 1: Decode Level 0 anchors
  if (sampleIdx < SEGMENTS) {
    let byteOffset = l0Offset + (profile * SEGMENTS + sampleIdx) * 2u;
    let delta = float16ToFloat32(readU16(byteOffset));
    deltas[sampleIdx] = delta;
  }
  workgroupBarrier();

  // Phase 2: Prefix sum for anchors
  if (sampleIdx == 0u) {
    var acc = 0.0;
    for (var i = 0u; i < SEGMENTS; i++) {
      acc += deltas[i];
      anchors[i] = acc;
    }
  }
  workgroupBarrier();

  // Phase 3: Decode Level 1 segment deltas
  let segIdx = sampleIdx / SEGMENT_SIZE;
  let segOffset = sampleIdx % SEGMENT_SIZE;

  var value: f32;

  if (segOffset == 0u) {
    // Anchor sample
    value = anchors[segIdx];
  } else {
    // Decode segment delta with local prefix sum
    let samplesPerSeg = SEGMENT_SIZE - 1u;
    let l1ProfileOffset = l1Offset + profile * SEGMENTS * samplesPerSeg * 2u;
    let l1SegOffset = l1ProfileOffset + segIdx * samplesPerSeg * 2u;

    // Read deltas for this segment into shared memory
    let sharedBase = SEGMENTS + segIdx * SEGMENT_SIZE;
    let deltaIdx = segOffset - 1u;
    let byteOffset = l1SegOffset + deltaIdx * 2u;
    deltas[sharedBase + segOffset] = float16ToFloat32(readU16(byteOffset));
    workgroupBarrier();

    // Local prefix sum within segment
    var acc = anchors[segIdx];
    for (var i = 1u; i <= segOffset; i++) {
      acc += deltas[sharedBase + i];
    }
    value = acc;
  }

  textureStore(outputTexture, vec2<i32>(i32(sampleIdx), i32(profile)), vec4<f32>(value, 0.0, 0.0, 1.0));
}
`;

export interface StreamingLutUpdate {
  level: 0 | 1;
  progress: number;
  bytesLoaded: number;
  uploadTime: number;
  decodeTime: number;
}

export interface StreamingLutResources {
  texture: GPUTexture;
  textureView: GPUTextureView;
  sampler: GPUSampler;
}

/**
 * Streaming LUT Loader with zero-copy upload
 */
export class StreamingLutLoader {
  private device: GPUDevice;
  private url: string;

  // Resources
  private texture: GPUTexture | null = null;
  private textureView: GPUTextureView | null = null;
  private sampler: GPUSampler | null = null;

  // Compute resources
  private shaderModule: GPUShaderModule | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private level0Pipeline: GPUComputePipeline | null = null;
  private level1Pipeline: GPUComputePipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;

  private currentLevel: -1 | 0 | 1 = -1;

  constructor(device: GPUDevice, url: string) {
    this.device = device;
    this.url = url;
  }

  private initialize(): void {
    const device = this.device;

    // Create texture
    this.texture = device.createTexture({
      label: 'streaming-lut',
      size: [LUT_SAMPLES, PROFILE_COUNT, 1],
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    this.textureView = this.texture.createView();

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Shader and pipelines
    this.shaderModule = device.createShaderModule({
      code: STREAMING_DECODE_SHADER,
    });

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });

    this.level0Pipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: this.shaderModule, entryPoint: 'decodeLevel0' },
    });

    this.level1Pipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: this.shaderModule, entryPoint: 'decodeLevel1' },
    });

    this.uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Create mapped buffer and upload data with zero-copy
   */
  private createMappedBuffer(data: Uint8Array): GPUBuffer {
    // Align size to 4 bytes
    const alignedSize = Math.ceil(data.length / 4) * 4;

    // Create buffer with mappedAtCreation for zero-copy upload
    const buffer = this.device.createBuffer({
      size: alignedSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });

    // Write directly to mapped memory (no intermediate copy)
    new Uint8Array(buffer.getMappedRange()).set(data);
    buffer.unmap();

    return buffer;
  }

  /**
   * Dispatch decode compute shader
   */
  private dispatchDecode(
    pipeline: GPUComputePipeline,
    dataBuffer: GPUBuffer,
    level: number,
    dataOffset: number
  ): void {
    const device = this.device;

    // Update uniforms
    const uniforms = new Uint32Array([level, PROFILE_COUNT, dataOffset, 0]);
    device.queue.writeBuffer(this.uniformBuffer!, 0, uniforms);

    // Create bind group
    const bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer! } },
        { binding: 1, resource: { buffer: dataBuffer } },
        { binding: 2, resource: this.textureView! },
      ],
    });

    // Dispatch
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(PROFILE_COUNT); // 6 workgroups
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  /**
   * Load with streaming and zero-copy upload
   */
  async *load(): AsyncGenerator<StreamingLutUpdate> {
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
    let level0Size = 0;
    let level1Size = 0;
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
      if (!headerParsed && buffer.length >= HEADER_SIZE) {
        const view = new DataView(buffer.buffer, buffer.byteOffset);
        const profileCount = buffer[4];
        const samples = view.getUint16(5, true);
        const segmentSize = buffer[7];
        const segments = samples / segmentSize;

        level0Size = segments * profileCount * 2;
        level1Size = (segmentSize - 1) * segments * profileCount * 2;
        headerParsed = true;
      }

      // Decode Level 0
      if (headerParsed && !level0Decoded && buffer.length >= HEADER_SIZE + level0Size) {
        const uploadStart = performance.now();

        // Zero-copy upload to mapped buffer
        const dataBuffer = this.createMappedBuffer(buffer.slice(0, HEADER_SIZE + level0Size));
        const uploadTime = performance.now() - uploadStart;

        const decodeStart = performance.now();
        this.dispatchDecode(this.level0Pipeline!, dataBuffer, 0, HEADER_SIZE);

        // Wait for GPU (for timing)
        await this.device.queue.onSubmittedWorkDone();
        const decodeTime = performance.now() - decodeStart;

        dataBuffer.destroy();
        level0Decoded = true;
        this.currentLevel = 0;

        yield {
          level: 0,
          progress: SEGMENTS / LUT_SAMPLES,
          bytesLoaded,
          uploadTime,
          decodeTime,
        };
      }

      // Decode Level 1
      if (headerParsed && level0Decoded && !level1Decoded &&
          buffer.length >= HEADER_SIZE + level0Size + level1Size) {
        const uploadStart = performance.now();
        const dataBuffer = this.createMappedBuffer(buffer);
        const uploadTime = performance.now() - uploadStart;

        const decodeStart = performance.now();
        this.dispatchDecode(this.level1Pipeline!, dataBuffer, 1, HEADER_SIZE);
        await this.device.queue.onSubmittedWorkDone();
        const decodeTime = performance.now() - decodeStart;

        dataBuffer.destroy();
        level1Decoded = true;
        this.currentLevel = 1;

        yield {
          level: 1,
          progress: 1,
          bytesLoaded,
          uploadTime,
          decodeTime,
        };
      }

      if (done) break;
    }
  }

  getResources(): StreamingLutResources | null {
    if (!this.texture || !this.textureView || !this.sampler) return null;
    return { texture: this.texture, textureView: this.textureView, sampler: this.sampler };
  }

  getCurrentLevel(): -1 | 0 | 1 { return this.currentLevel; }
  isReady(): boolean { return this.currentLevel >= 0; }
  isFullQuality(): boolean { return this.currentLevel === 1; }

  destroy(): void {
    this.texture?.destroy();
    this.uniformBuffer?.destroy();
    this.texture = null;
    this.textureView = null;
    this.sampler = null;
    this.currentLevel = -1;
  }
}

// ============================================================================
// Singleton API
// ============================================================================

let _loader: StreamingLutLoader | null = null;
let _loadPromise: Promise<StreamingLutResources> | null = null;

export async function initStreamingLutWebGPU(
  device: GPUDevice,
  url: string,
  onProgress?: (update: StreamingLutUpdate) => void
): Promise<StreamingLutResources> {
  if (_loadPromise) return _loadPromise;

  _loader = new StreamingLutLoader(device, url);

  _loadPromise = (async () => {
    let resources: StreamingLutResources | null = null;
    for await (const update of _loader!.load()) {
      onProgress?.(update);
      if (update.level === 0) {
        resources = _loader!.getResources();
      }
    }
    if (!resources) throw new Error('Failed to load LUT');
    return resources;
  })();

  return _loadPromise;
}

export function getStreamingLutResources(): StreamingLutResources | null {
  return _loader?.getResources() ?? null;
}

export function destroyStreamingLut(): void {
  _loader?.destroy();
  _loader = null;
  _loadPromise = null;
}

export default StreamingLutLoader;

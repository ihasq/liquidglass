/**
 * Progressive LUT Loader for WebGPU - Compute Shader Optimized
 *
 * Optimizations over CPU-based decoder:
 * 1. Delta decoding on GPU via Compute Shader
 * 2. Direct GPUBuffer upload (no intermediate Float32Array)
 * 3. Parallel prefix sum for delta reconstruction
 * 4. Batch processing of all profiles simultaneously
 *
 * Data flow:
 * Network → GPUBuffer (staging) → Compute Shader → Storage Texture
 *
 * Memory efficiency:
 * - No CPU-side delta decoding
 * - No Float32Array intermediate allocations
 * - Direct GPU memory writes
 */

import DELTA_DECODE_SHADER from '../shaders/gpu/delta-decode.comp.wgsl';

const PROFILE_COUNT = 6;
const LUT_SAMPLES = 256;
const SEGMENT_SIZE = 16;
const SEGMENTS = LUT_SAMPLES / SEGMENT_SIZE;
const HEADER_SIZE = 8;

export interface ComputeLutUpdate {
  level: 0 | 1;
  progress: number;
  bytesLoaded: number;
  gpuDecodeTime: number;
}

export interface ComputeLutResources {
  texture: GPUTexture;
  textureView: GPUTextureView;
  sampler: GPUSampler;
}

/**
 * Progressive LUT Loader with GPU Compute Decoding
 */
export class ProgressiveLutComputeLoader {
  private device: GPUDevice;
  private url: string;

  // GPU Resources
  private lutTexture: GPUTexture | null = null;
  private lutTextureView: GPUTextureView | null = null;
  private lutSampler: GPUSampler | null = null;
  private stagingBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;

  // Compute pipelines
  private level0Pipeline: GPUComputePipeline | null = null;
  private level1Pipeline: GPUComputePipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;

  private currentLevel: -1 | 0 | 1 = -1;
  private initialized = false;

  constructor(device: GPUDevice, url: string) {
    this.device = device;
    this.url = url;
  }

  /**
   * Initialize GPU resources and compute pipelines
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    const device = this.device;

    // Create LUT texture (storage texture for compute shader output)
    this.lutTexture = device.createTexture({
      label: 'compute-lut-atlas',
      size: [LUT_SAMPLES, PROFILE_COUNT, 1],
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING |
             GPUTextureUsage.STORAGE_BINDING |
             GPUTextureUsage.COPY_DST,
    });

    this.lutTextureView = this.lutTexture.createView({
      label: 'compute-lut-view',
    });

    this.lutSampler = device.createSampler({
      label: 'compute-lut-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Uniform buffer for decode params
    this.uniformBuffer = device.createBuffer({
      label: 'decode-params',
      size: 16, // 4 x u32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Calculate max staging buffer size
    // Header (8) + Level0 (SEGMENTS × PROFILES × 2) + Level1 ((SEGMENT_SIZE-1) × SEGMENTS × PROFILES × 2)
    const level0Size = SEGMENTS * PROFILE_COUNT * 2;
    const level1Size = (SEGMENT_SIZE - 1) * SEGMENTS * PROFILE_COUNT * 2;
    const totalSize = HEADER_SIZE + level0Size + level1Size;

    // Align to 4 bytes for GPUBuffer
    const alignedSize = Math.ceil(totalSize / 4) * 4;

    this.stagingBuffer = device.createBuffer({
      label: 'delta-staging',
      size: alignedSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Create compute shader module
    const shaderModule = device.createShaderModule({
      label: 'delta-decode-shader',
      code: DELTA_DECODE_SHADER,
    });

    // Bind group layout
    this.bindGroupLayout = device.createBindGroupLayout({
      label: 'delta-decode-layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: 'write-only',
            format: 'r32float',
            viewDimension: '2d',
          },
        },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      label: 'delta-decode-pipeline-layout',
      bindGroupLayouts: [this.bindGroupLayout],
    });

    // Level 0 pipeline (workgroup size 16x1x1)
    this.level0Pipeline = device.createComputePipeline({
      label: 'level0-decode-pipeline',
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'decodeLevel0',
      },
    });

    // Level 1 pipeline (workgroup size 16x16x1)
    this.level1Pipeline = device.createComputePipeline({
      label: 'level1-decode-pipeline',
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'decodeLevel1',
      },
    });

    this.initialized = true;
  }

  /**
   * Run compute shader to decode Level 0
   */
  private decodeLevel0OnGPU(): number {
    if (!this.level0Pipeline || !this.bindGroupLayout ||
        !this.uniformBuffer || !this.stagingBuffer || !this.lutTextureView) {
      return 0;
    }

    const device = this.device;
    const startTime = performance.now();

    // Update uniforms
    const uniformData = new Uint32Array([0, PROFILE_COUNT, LUT_SAMPLES, SEGMENT_SIZE]);
    device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    // Create bind group
    const bindGroup = device.createBindGroup({
      label: 'level0-bind-group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.stagingBuffer } },
        { binding: 2, resource: this.lutTextureView },
      ],
    });

    // Dispatch compute
    const commandEncoder = device.createCommandEncoder({
      label: 'level0-decode-encoder',
    });

    const passEncoder = commandEncoder.beginComputePass({
      label: 'level0-decode-pass',
    });

    passEncoder.setPipeline(this.level0Pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(PROFILE_COUNT); // 6 workgroups, one per profile
    passEncoder.end();

    device.queue.submit([commandEncoder.finish()]);

    return performance.now() - startTime;
  }

  /**
   * Run compute shader to decode Level 1
   */
  private decodeLevel1OnGPU(): number {
    if (!this.level1Pipeline || !this.bindGroupLayout ||
        !this.uniformBuffer || !this.stagingBuffer || !this.lutTextureView) {
      return 0;
    }

    const device = this.device;
    const startTime = performance.now();

    // Update uniforms
    const uniformData = new Uint32Array([1, PROFILE_COUNT, LUT_SAMPLES, SEGMENT_SIZE]);
    device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    // Create bind group
    const bindGroup = device.createBindGroup({
      label: 'level1-bind-group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.stagingBuffer } },
        { binding: 2, resource: this.lutTextureView },
      ],
    });

    // Dispatch compute
    const commandEncoder = device.createCommandEncoder({
      label: 'level1-decode-encoder',
    });

    const passEncoder = commandEncoder.beginComputePass({
      label: 'level1-decode-pass',
    });

    passEncoder.setPipeline(this.level1Pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(PROFILE_COUNT); // 6 workgroups
    passEncoder.end();

    device.queue.submit([commandEncoder.finish()]);

    return performance.now() - startTime;
  }

  /**
   * Load LUT progressively with GPU compute decoding
   */
  async *load(): AsyncGenerator<ComputeLutUpdate> {
    await this.initialize();

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

    // Level sizes
    let level0Size = 0;
    let level1Size = 0;
    let level0End = 0;

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
        level0End = HEADER_SIZE + level0Size;

        headerParsed = true;
      }

      // Decode Level 0 on GPU
      if (headerParsed && !level0Decoded && buffer.length >= level0End) {
        // Upload data to staging buffer (including header for offset calculation)
        this.device.queue.writeBuffer(
          this.stagingBuffer!,
          0,
          buffer.buffer,
          buffer.byteOffset,
          level0End
        );

        // Run compute shader
        const gpuTime = this.decodeLevel0OnGPU();

        level0Decoded = true;
        this.currentLevel = 0;

        yield {
          level: 0,
          progress: segments / samples,
          bytesLoaded,
          gpuDecodeTime: gpuTime,
        };
      }

      // Decode Level 1 on GPU
      if (headerParsed && level0Decoded && !level1Decoded &&
          buffer.length >= HEADER_SIZE + level0Size + level1Size) {
        // Upload full data to staging buffer
        this.device.queue.writeBuffer(
          this.stagingBuffer!,
          0,
          buffer.buffer,
          buffer.byteOffset,
          buffer.length
        );

        // Run compute shader
        const gpuTime = this.decodeLevel1OnGPU();

        level1Decoded = true;
        this.currentLevel = 1;

        yield {
          level: 1,
          progress: 1,
          bytesLoaded,
          gpuDecodeTime: gpuTime,
        };
      }

      if (done) break;
    }
  }

  /**
   * Get current texture resources
   */
  getResources(): ComputeLutResources | null {
    if (!this.lutTexture || !this.lutTextureView || !this.lutSampler) {
      return null;
    }

    return {
      texture: this.lutTexture,
      textureView: this.lutTextureView,
      sampler: this.lutSampler,
    };
  }

  /**
   * Get current quality level
   */
  getCurrentLevel(): -1 | 0 | 1 {
    return this.currentLevel;
  }

  isReady(): boolean {
    return this.currentLevel >= 0;
  }

  isFullQuality(): boolean {
    return this.currentLevel === 1;
  }

  /**
   * Destroy all GPU resources
   */
  destroy(): void {
    this.lutTexture?.destroy();
    this.stagingBuffer?.destroy();
    this.uniformBuffer?.destroy();

    this.lutTexture = null;
    this.lutTextureView = null;
    this.lutSampler = null;
    this.stagingBuffer = null;
    this.uniformBuffer = null;
    this.level0Pipeline = null;
    this.level1Pipeline = null;
    this.bindGroupLayout = null;
    this.currentLevel = -1;
    this.initialized = false;
  }
}

// ============================================================================
// Singleton API
// ============================================================================

let _computeLoader: ProgressiveLutComputeLoader | null = null;
let _loadingPromise: Promise<ComputeLutResources> | null = null;
let _onProgressCallbacks: ((update: ComputeLutUpdate) => void)[] = [];

/**
 * Initialize progressive LUT loading with GPU compute decoding
 */
export async function initComputeLutWebGPU(
  device: GPUDevice,
  url: string,
  onProgress?: (update: ComputeLutUpdate) => void
): Promise<ComputeLutResources> {
  if (onProgress) {
    _onProgressCallbacks.push(onProgress);
  }

  if (_loadingPromise) {
    return _loadingPromise;
  }

  _computeLoader = new ProgressiveLutComputeLoader(device, url);

  _loadingPromise = (async () => {
    let resources: ComputeLutResources | null = null;

    for await (const update of _computeLoader!.load()) {
      for (const cb of _onProgressCallbacks) {
        cb(update);
      }

      if (update.level === 0) {
        resources = _computeLoader!.getResources();
      }
    }

    if (!resources) {
      throw new Error('Failed to load LUT');
    }

    return resources;
  })();

  return _loadingPromise;
}

export function getComputeLutResourcesWebGPU(): ComputeLutResources | null {
  return _computeLoader?.getResources() ?? null;
}

export function isComputeLutReadyWebGPU(): boolean {
  return _computeLoader?.isReady() ?? false;
}

export function isComputeLutFullQualityWebGPU(): boolean {
  return _computeLoader?.isFullQuality() ?? false;
}

export function destroyComputeLutWebGPU(): void {
  _computeLoader?.destroy();
  _computeLoader = null;
  _loadingPromise = null;
  _onProgressCallbacks = [];
}

export default ProgressiveLutComputeLoader;

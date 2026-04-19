/**
 * LUT Texture Manager
 *
 * Creates and manages GPU textures for displacement profile LUTs.
 * Uses a single 256x6 texture atlas containing all 6 profiles.
 *
 * Texture format:
 * - Width: 256 (samples per profile)
 * - Height: 6 (number of profiles)
 * - Format: R16F or R32F depending on platform support
 *
 * Profile layout (rows):
 * - 0: exponential
 * - 1: squircle
 * - 2: circle
 * - 3: parabolic
 * - 4: cosine
 * - 5: linear
 */

import { DISPLACEMENT_LUTS, LUT_SAMPLES, PROFILE_NAMES, type ProfileType } from './luts/generated';

const PROFILE_COUNT = 6;

// ============================================================================
// WebGPU Texture
// ============================================================================

let _gpuTexture: GPUTexture | null = null;
let _gpuTextureView: GPUTextureView | null = null;
let _gpuSampler: GPUSampler | null = null;

/**
 * Create or get cached WebGPU LUT texture
 */
export function getWebGPULutTexture(device: GPUDevice): {
  texture: GPUTexture;
  textureView: GPUTextureView;
  sampler: GPUSampler;
} {
  if (_gpuTexture && _gpuTextureView && _gpuSampler) {
    return { texture: _gpuTexture, textureView: _gpuTextureView, sampler: _gpuSampler };
  }

  // Create texture atlas (256 x 6, R32F format)
  _gpuTexture = device.createTexture({
    label: 'lut-texture-atlas',
    size: [LUT_SAMPLES, PROFILE_COUNT, 1],
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  // Upload LUT data
  const atlasData = createLutAtlasData();
  device.queue.writeTexture(
    { texture: _gpuTexture },
    atlasData.buffer,
    { bytesPerRow: LUT_SAMPLES * 4, rowsPerImage: PROFILE_COUNT },
    { width: LUT_SAMPLES, height: PROFILE_COUNT }
  );

  _gpuTextureView = _gpuTexture.createView({
    label: 'lut-texture-view',
  });

  _gpuSampler = device.createSampler({
    label: 'lut-sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });

  return { texture: _gpuTexture, textureView: _gpuTextureView, sampler: _gpuSampler };
}

/**
 * Destroy cached WebGPU resources
 */
export function destroyWebGPULutTexture(): void {
  _gpuTexture?.destroy();
  _gpuTexture = null;
  _gpuTextureView = null;
  _gpuSampler = null;
}

// ============================================================================
// WebGL2 Texture
// ============================================================================

let _gl2Texture: WebGLTexture | null = null;
let _gl2Context: WebGL2RenderingContext | null = null;

/**
 * Create or get cached WebGL2 LUT texture
 */
export function getWebGL2LutTexture(gl: WebGL2RenderingContext): WebGLTexture {
  // Check if we need to recreate (context changed)
  if (_gl2Texture && _gl2Context === gl) {
    return _gl2Texture;
  }

  // Cleanup old texture if context changed
  if (_gl2Texture && _gl2Context && _gl2Context !== gl) {
    _gl2Context.deleteTexture(_gl2Texture);
  }

  _gl2Context = gl;

  // Create texture
  _gl2Texture = gl.createTexture();
  if (!_gl2Texture) {
    throw new Error('Failed to create LUT texture');
  }

  gl.bindTexture(gl.TEXTURE_2D, _gl2Texture);

  // Check for float texture support
  const ext = gl.getExtension('OES_texture_float_linear');
  const useFloat = !!ext;

  // Upload LUT data
  const atlasData = createLutAtlasData();

  if (useFloat) {
    // R32F texture (best quality)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      LUT_SAMPLES,
      PROFILE_COUNT,
      0,
      gl.RED,
      gl.FLOAT,
      atlasData
    );
  } else {
    // Fallback: Convert to R8 (8-bit normalized)
    const r8Data = new Uint8Array(LUT_SAMPLES * PROFILE_COUNT);
    for (let i = 0; i < atlasData.length; i++) {
      r8Data[i] = Math.round(atlasData[i] * 255);
    }
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      LUT_SAMPLES,
      PROFILE_COUNT,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      r8Data
    );
  }

  // Set filtering (linear for smooth interpolation)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindTexture(gl.TEXTURE_2D, null);

  return _gl2Texture;
}

/**
 * Destroy cached WebGL2 texture
 */
export function destroyWebGL2LutTexture(): void {
  if (_gl2Texture && _gl2Context) {
    _gl2Context.deleteTexture(_gl2Texture);
  }
  _gl2Texture = null;
  _gl2Context = null;
}

// ============================================================================
// Shared Utilities
// ============================================================================

/**
 * Create a Float32Array containing all LUT profiles in atlas format
 * Layout: 256 samples × 6 rows (profiles)
 */
function createLutAtlasData(): Float32Array {
  const atlas = new Float32Array(LUT_SAMPLES * PROFILE_COUNT);

  const profileOrder: ProfileType[] = [
    'exponential',
    'squircle',
    'circle',
    'parabolic',
    'cosine',
    'linear',
  ];

  for (let row = 0; row < PROFILE_COUNT; row++) {
    const profile = profileOrder[row];
    const lut = DISPLACEMENT_LUTS[profile];
    const rowOffset = row * LUT_SAMPLES;

    for (let col = 0; col < LUT_SAMPLES; col++) {
      atlas[rowOffset + col] = lut[col];
    }
  }

  return atlas;
}

/**
 * Get profile index for shader uniform
 */
export function getProfileIndex(profile: ProfileType): number {
  const index = PROFILE_NAMES.indexOf(profile);
  return index >= 0 ? index : 0;
}

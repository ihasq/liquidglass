#!/usr/bin/env node
/**
 * Progressive LUT Encoder
 *
 * Interleaves LUT data for progressive decoding:
 * - Level 0: samples 0, 128 (2 samples → linear interpolation)
 * - Level 1: samples 64, 192 (4 samples total)
 * - Level 2: samples 32, 96, 160, 224 (8 samples total)
 * - Level 3: samples 16, 48, 80, 112, 144, 176, 208, 240 (16 samples)
 * - Level 4: remaining 16 samples (32 total)
 * - Level 5: remaining 32 samples (64 total)
 * - Level 6: remaining 64 samples (128 total)
 * - Level 7: remaining 128 samples (256 total)
 *
 * This allows DecompressionStream to provide usable data early.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LUT_DIR = join(__dirname, '../build/luts');
const OUTPUT_DIR = join(__dirname, '../build/luts');

const profiles = ['exponential', 'squircle', 'circle', 'parabolic', 'cosine', 'linear'];

// Float16 conversion
function float16ToFloat32(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7C00) >> 10;
  const f = h & 0x03FF;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1F) return f ? NaN : ((s ? -1 : 1) * Infinity);
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

function float32ToFloat16(val) {
  const fv = new Float32Array(1);
  const iv = new Int32Array(fv.buffer);
  fv[0] = val;
  const x = iv[0];
  let bits = (x >> 16) & 0x8000;
  let m = (x >> 12) & 0x07ff;
  const e = (x >> 23) & 0xff;
  if (e < 103) return bits;
  if (e > 142) { bits |= 0x7c00; return bits; }
  if (e < 113) { m |= 0x0800; bits |= (m >> (114 - e)); return bits; }
  bits |= ((e - 112) << 10) | (m >> 1);
  return bits;
}

// Generate interleaved sample indices (2 levels: 16 -> 256)
function generateInterleavedIndices(totalSamples) {
  const levels = [];

  // Level 0: 16 evenly spaced samples (indices 0, 16, 32, ..., 240)
  const level0 = [];
  const step0 = totalSamples / 16;
  for (let i = 0; i < totalSamples; i += step0) {
    level0.push(i);
  }
  levels.push(level0);

  // Level 1: remaining 240 samples
  const level0Set = new Set(level0);
  const level1 = [];
  for (let i = 0; i < totalSamples; i++) {
    if (!level0Set.has(i)) {
      level1.push(i);
    }
  }
  levels.push(level1);

  return levels;
}

// Read LUT file
function readLUT(name) {
  const buffer = readFileSync(join(LUT_DIR, `${name}.r16f`));
  const values = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    values[i] = float16ToFloat32(buffer.readUInt16LE(i * 2));
  }
  return values;
}

// Create progressive encoded buffer
function createProgressiveBuffer(allLUTs) {
  const SAMPLES = 256;
  const PROFILES = profiles.length;
  const levels = generateInterleavedIndices(SAMPLES);

  console.log('Interleave levels:');
  let cumulative = 0;
  levels.forEach((indices, i) => {
    cumulative += indices.length;
    console.log(`  Level ${i}: ${indices.length} samples (cumulative: ${cumulative})`);
  });

  // Header: magic + profile count + sample count + level info
  const headerSize = 4 + 1 + 2 + levels.length * 2;
  const dataSize = SAMPLES * PROFILES * 2; // R16F
  const buffer = Buffer.alloc(headerSize + dataSize);

  let offset = 0;

  // Magic: "PLUT" (Progressive LUT)
  buffer.write('PLUT', offset); offset += 4;

  // Profile count
  buffer.writeUInt8(PROFILES, offset); offset += 1;

  // Sample count
  buffer.writeUInt16LE(SAMPLES, offset); offset += 2;

  // Level boundaries (cumulative sample count at each level)
  let cumulativeSamples = 0;
  for (const level of levels) {
    cumulativeSamples += level.length;
    buffer.writeUInt16LE(cumulativeSamples, offset); offset += 2;
  }

  // Data: interleaved by level, then by profile
  for (const levelIndices of levels) {
    for (const sampleIdx of levelIndices) {
      for (let p = 0; p < PROFILES; p++) {
        const value = allLUTs[profiles[p]][sampleIdx];
        buffer.writeUInt16LE(float32ToFloat16(value), offset);
        offset += 2;
      }
    }
  }

  return { buffer, levels, headerSize };
}

// Simulate progressive decoding quality
function simulateProgressiveQuality(allLUTs, levels) {
  console.log('\nProgressive Quality Simulation:');
  console.log('-'.repeat(60));

  let decodedIndices = [];
  const SAMPLES = 256;

  for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
    decodedIndices = decodedIndices.concat(levels[levelIdx]);
    decodedIndices.sort((a, b) => a - b);

    // Calculate interpolation error
    let maxError = 0;
    let avgError = 0;
    let count = 0;

    for (const name of profiles) {
      const original = allLUTs[name];

      for (let i = 0; i < SAMPLES; i++) {
        // Find surrounding decoded indices
        let lower = 0, upper = SAMPLES - 1;
        for (const idx of decodedIndices) {
          if (idx <= i) lower = idx;
          if (idx >= i && upper === SAMPLES - 1) upper = idx;
        }

        // Interpolate
        let interpolated;
        if (lower === upper) {
          interpolated = original[lower];
        } else {
          const t = (i - lower) / (upper - lower);
          interpolated = original[lower] * (1 - t) + original[upper] * t;
        }

        const error = Math.abs(original[i] - interpolated);
        maxError = Math.max(maxError, error);
        avgError += error;
        count++;
      }
    }

    avgError /= count;
    const bytesNeeded = (4 + 1 + 2 + (levelIdx + 1) * 2) + decodedIndices.length * profiles.length * 2;

    console.log(
      `  Level ${levelIdx}: ${decodedIndices.length.toString().padStart(3)} samples, ` +
      `${bytesNeeded.toString().padStart(4)} bytes, ` +
      `max_err=${maxError.toExponential(2)}, ` +
      `avg_err=${avgError.toExponential(2)}`
    );
  }
}

// Main
async function main() {
  console.log('='.repeat(60));
  console.log('Progressive LUT Encoder');
  console.log('='.repeat(60));
  console.log('');

  // Read all LUTs
  const allLUTs = {};
  for (const name of profiles) {
    allLUTs[name] = readLUT(name);
  }

  // Create progressive buffer
  const { buffer, levels, headerSize } = createProgressiveBuffer(allLUTs);

  // Simulate quality at each level
  simulateProgressiveQuality(allLUTs, levels);

  // Compress
  const compressed = gzipSync(buffer, { level: 9 });

  console.log('\nCompression Results:');
  console.log('-'.repeat(60));
  console.log(`  Original (6 × R16F):     ${6 * 512} bytes`);
  console.log(`  Progressive uncompressed: ${buffer.length} bytes`);
  console.log(`  Progressive + gzip:       ${compressed.length} bytes`);
  console.log(`  Compression ratio:        ${(compressed.length / (6 * 512) * 100).toFixed(1)}%`);

  // Save files
  writeFileSync(join(OUTPUT_DIR, 'progressive.plut'), buffer);
  writeFileSync(join(OUTPUT_DIR, 'progressive.plut.gz'), compressed);

  console.log('\nOutput files:');
  console.log(`  ${join(OUTPUT_DIR, 'progressive.plut')}`);
  console.log(`  ${join(OUTPUT_DIR, 'progressive.plut.gz')}`);

  // Generate decoder code
  console.log('\n' + '='.repeat(60));
  console.log('Runtime Decoder (for browser):');
  console.log('='.repeat(60));
  console.log(`
// Progressive LUT Decoder with DecompressionStream
async function* progressiveLUTDecode(url) {
  const response = await fetch(url);
  const decompressor = new DecompressionStream('gzip');
  const reader = response.body.pipeThrough(decompressor).getReader();

  let buffer = new Uint8Array(0);
  let headerParsed = false;
  let profiles = 0, samples = 0, levelBoundaries = [];
  let currentLevel = 0;
  let samplesDecoded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // Append to buffer
    const newBuffer = new Uint8Array(buffer.length + value.length);
    newBuffer.set(buffer);
    newBuffer.set(value, buffer.length);
    buffer = newBuffer;

    // Parse header
    if (!headerParsed && buffer.length >= 7) {
      const view = new DataView(buffer.buffer);
      // Skip magic (4 bytes)
      profiles = buffer[4];
      samples = view.getUint16(5, true);
      // Read level boundaries (assume 8 levels max)
      const numLevels = Math.ceil(Math.log2(samples));
      for (let i = 0; i < numLevels; i++) {
        levelBoundaries.push(view.getUint16(7 + i * 2, true));
      }
      headerParsed = true;
    }

    // Yield decoded levels as they become available
    if (headerParsed) {
      const headerSize = 7 + levelBoundaries.length * 2;
      const dataBytes = buffer.length - headerSize;
      const samplesAvailable = Math.floor(dataBytes / (profiles * 2));

      while (currentLevel < levelBoundaries.length &&
             samplesAvailable >= levelBoundaries[currentLevel]) {
        yield {
          level: currentLevel,
          samplesDecoded: levelBoundaries[currentLevel],
          totalSamples: samples,
          progress: levelBoundaries[currentLevel] / samples
        };
        currentLevel++;
      }
    }
  }
}
`);
}

main().catch(console.error);

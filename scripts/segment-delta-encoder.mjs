#!/usr/bin/env node
/**
 * Segment Delta Progressive LUT Encoder
 *
 * Format: SDLUT (Segment Delta LUT)
 * - Header: "SDLT" (4) + profiles (1) + samples (2) + segmentSize (1)
 * - Level 0: Delta-encoded sparse samples (16 per profile)
 * - Level 1: Segment-delta encoded remaining samples (15 per segment × 16 segments per profile)
 *
 * Compression: ~43.8% of original with gzip -9
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LUT_DIR = join(__dirname, '../build/luts');
const OUTPUT_DIR = join(__dirname, '../build/luts');

const PROFILES = ['exponential', 'squircle', 'circle', 'parabolic', 'cosine', 'linear'];
const SAMPLES = 256;
const SEGMENT_SIZE = 16;
const SEGMENTS = SAMPLES / SEGMENT_SIZE;

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

// Read LUT
function readLUT(name) {
  const buffer = readFileSync(join(LUT_DIR, `${name}.r16f`));
  const values = new Float32Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    values[i] = float16ToFloat32(buffer.readUInt16LE(i * 2));
  }
  return values;
}

// Encode with Segment Delta
function encodeSegmentDelta(allLUTs) {
  const profileCount = PROFILES.length;

  // Header: "SDLT" + profiles(1) + samples(2) + segmentSize(1) = 8 bytes
  const headerSize = 8;

  // Level 0: 16 samples per profile, delta-encoded = 16 × 6 × 2 = 192 bytes
  const level0Size = SEGMENTS * profileCount * 2;

  // Level 1: 15 samples per segment × 16 segments × 6 profiles = 1440 × 2 = 2880 bytes
  const level1Size = (SEGMENT_SIZE - 1) * SEGMENTS * profileCount * 2;

  const buffer = Buffer.alloc(headerSize + level0Size + level1Size);
  let offset = 0;

  // Write header
  buffer.write('SDLT', offset); offset += 4;
  buffer.writeUInt8(profileCount, offset); offset += 1;
  buffer.writeUInt16LE(SAMPLES, offset); offset += 2;
  buffer.writeUInt8(SEGMENT_SIZE, offset); offset += 1;

  // Write Level 0: delta-encoded sparse samples
  for (const name of PROFILES) {
    const lut = allLUTs[name];
    let prev = 0;

    for (let seg = 0; seg < SEGMENTS; seg++) {
      const idx = seg * SEGMENT_SIZE;
      const val = lut[idx];
      const delta = val - prev;
      buffer.writeUInt16LE(float32ToFloat16(delta), offset);
      offset += 2;
      prev = val;
    }
  }

  const level0End = offset;

  // Write Level 1: segment-delta encoded samples
  for (const name of PROFILES) {
    const lut = allLUTs[name];

    for (let seg = 0; seg < SEGMENTS; seg++) {
      const segStart = seg * SEGMENT_SIZE;
      let prev = lut[segStart]; // Anchor is Level 0 sample

      for (let i = 1; i < SEGMENT_SIZE; i++) {
        const idx = segStart + i;
        if (idx >= SAMPLES) break;

        const val = lut[idx];
        const delta = val - prev;
        buffer.writeUInt16LE(float32ToFloat16(delta), offset);
        offset += 2;
        prev = val;
      }
    }
  }

  return { buffer, headerSize, level0End, level0Size, level1Size };
}

// Verify encoding/decoding roundtrip
function verifyRoundtrip(allLUTs, buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset);
  let offset = 0;

  // Read header
  const magic = String.fromCharCode(...buffer.slice(0, 4));
  if (magic !== 'SDLT') throw new Error(`Invalid magic: ${magic}`);
  offset += 4;

  const profileCount = buffer[offset++];
  const samples = view.getUint16(offset, true); offset += 2;
  const segmentSize = buffer[offset++];
  const segments = samples / segmentSize;

  // Decode Level 0
  const decoded = {};
  for (const name of PROFILES) {
    decoded[name] = new Float32Array(samples);
  }

  for (let p = 0; p < profileCount; p++) {
    const name = PROFILES[p];
    let prev = 0;

    for (let seg = 0; seg < segments; seg++) {
      const delta = float16ToFloat32(view.getUint16(offset, true));
      offset += 2;
      const val = prev + delta;
      decoded[name][seg * segmentSize] = val;
      prev = val;
    }
  }

  // Decode Level 1
  for (let p = 0; p < profileCount; p++) {
    const name = PROFILES[p];

    for (let seg = 0; seg < segments; seg++) {
      const segStart = seg * segmentSize;
      let prev = decoded[name][segStart];

      for (let i = 1; i < segmentSize; i++) {
        const idx = segStart + i;
        if (idx >= samples) break;

        const delta = float16ToFloat32(view.getUint16(offset, true));
        offset += 2;
        const val = prev + delta;
        decoded[name][idx] = val;
        prev = val;
      }
    }
  }

  // Verify
  let maxError = 0;
  for (const name of PROFILES) {
    for (let i = 0; i < samples; i++) {
      const error = Math.abs(allLUTs[name][i] - decoded[name][i]);
      maxError = Math.max(maxError, error);
    }
  }

  return maxError;
}

// Main
async function main() {
  console.log('='.repeat(60));
  console.log('Segment Delta Progressive LUT Encoder');
  console.log('='.repeat(60));
  console.log('');

  // Read all LUTs
  const allLUTs = {};
  for (const name of PROFILES) {
    allLUTs[name] = readLUT(name);
    console.log(`  Loaded: ${name}`);
  }
  console.log('');

  // Encode
  const { buffer, headerSize, level0End, level0Size, level1Size } = encodeSegmentDelta(allLUTs);

  console.log('Encoding structure:');
  console.log(`  Header:  ${headerSize} bytes (offset 0-${headerSize - 1})`);
  console.log(`  Level 0: ${level0Size} bytes (offset ${headerSize}-${level0End - 1})`);
  console.log(`  Level 1: ${level1Size} bytes (offset ${level0End}-${buffer.length - 1})`);
  console.log(`  Total:   ${buffer.length} bytes`);
  console.log('');

  // Verify roundtrip
  const maxError = verifyRoundtrip(allLUTs, buffer);
  console.log(`Roundtrip verification: max error = ${maxError.toExponential(2)}`);

  if (maxError > 1e-3) {
    console.error('ERROR: Roundtrip verification failed!');
    process.exit(1);
  }
  console.log('  ✓ Encoding verified');
  console.log('');

  // Compress
  const compressed = gzipSync(buffer, { level: 9 });

  // Also compress Level 0 separately for progressive loading analysis
  const level0Buffer = buffer.slice(0, level0End);
  const level0Compressed = gzipSync(level0Buffer, { level: 9 });

  console.log('Compression results:');
  console.log(`  Original (6 × R16F):     ${6 * 512} bytes`);
  console.log(`  Segment Delta raw:       ${buffer.length} bytes`);
  console.log(`  Segment Delta + gzip:    ${compressed.length} bytes (${(compressed.length / (6 * 512) * 100).toFixed(1)}%)`);
  console.log('');
  console.log('Progressive loading:');
  console.log(`  Level 0 + header gzip:   ${level0Compressed.length} bytes (instant preview)`);
  console.log(`  Level 1 (remaining):     ${compressed.length - level0Compressed.length} bytes (estimated)`);
  console.log('');

  // Save files
  writeFileSync(join(OUTPUT_DIR, 'segment-delta.sdlt'), buffer);
  writeFileSync(join(OUTPUT_DIR, 'segment-delta.sdlt.gz'), compressed);

  console.log('Output files:');
  console.log(`  ${join(OUTPUT_DIR, 'segment-delta.sdlt')}`);
  console.log(`  ${join(OUTPUT_DIR, 'segment-delta.sdlt.gz')}`);
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`
  Format: SDLT (Segment Delta LUT)
  Profiles: ${PROFILES.length}
  Samples: ${SAMPLES}
  Segment size: ${SEGMENT_SIZE}

  Compression: ${(compressed.length / (6 * 512) * 100).toFixed(1)}% of original
  Savings: ${6 * 512 - compressed.length} bytes

  Progressive rendering:
    Level 0: ${SEGMENTS} samples/profile → linear interpolation preview
    Level 1: Full ${SAMPLES} samples/profile → final quality
  `);
}

main().catch(console.error);

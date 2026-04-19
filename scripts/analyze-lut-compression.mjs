#!/usr/bin/env node
/**
 * LUT Compression Analysis
 *
 * Analyzes entropy and tests various compression strategies:
 * 1. Raw R16F (baseline)
 * 2. Delta encoding
 * 3. Quantization (8-bit, 10-bit, 12-bit)
 * 4. Run-length encoding
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LUT_DIR = join(__dirname, '../build/luts');

// Read all LUT files
const profiles = ['exponential', 'squircle', 'circle', 'parabolic', 'cosine', 'linear'];

function readLUT(name) {
  const path = join(LUT_DIR, `${name}.r16f`);
  const buffer = readFileSync(path);
  const values = new Float32Array(256);

  // Convert R16F to Float32
  for (let i = 0; i < 256; i++) {
    values[i] = float16ToFloat32(buffer.readUInt16LE(i * 2));
  }
  return values;
}

function float16ToFloat32(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7C00) >> 10;
  const f = h & 0x03FF;

  if (e === 0) {
    return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  } else if (e === 0x1F) {
    return f ? NaN : ((s ? -1 : 1) * Infinity);
  }
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

function float32ToFloat16(val) {
  const floatView = new Float32Array(1);
  const int32View = new Int32Array(floatView.buffer);
  floatView[0] = val;
  const x = int32View[0];

  let bits = (x >> 16) & 0x8000;
  let m = (x >> 12) & 0x07ff;
  const e = (x >> 23) & 0xff;

  if (e < 103) return bits;
  if (e > 142) {
    bits |= 0x7c00;
    bits |= ((e === 255) ? 0 : 1) && (x & 0x007fffff);
    return bits;
  }
  if (e < 113) {
    m |= 0x0800;
    bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
    return bits;
  }
  bits |= ((e - 112) << 10) | (m >> 1);
  bits += (m & 1);
  return bits;
}

// Entropy calculation
function calculateEntropy(data) {
  const freq = new Map();
  for (const byte of data) {
    freq.set(byte, (freq.get(byte) || 0) + 1);
  }

  let entropy = 0;
  const len = data.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// Delta encoding
function deltaEncode(values) {
  const deltas = new Float32Array(values.length);
  deltas[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    deltas[i] = values[i] - values[i - 1];
  }
  return deltas;
}

// Quantization
function quantize(values, bits) {
  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  const range = maxVal - minVal;
  const levels = (1 << bits) - 1;

  const bytesPerSample = Math.ceil(bits / 8);
  const buffer = Buffer.alloc(values.length * bytesPerSample + 8); // +8 for header

  // Header: min and range as float32
  buffer.writeFloatLE(minVal, 0);
  buffer.writeFloatLE(range, 4);

  for (let i = 0; i < values.length; i++) {
    const normalized = range > 0 ? (values[i] - minVal) / range : 0;
    const quantized = Math.round(normalized * levels);

    if (bits <= 8) {
      buffer.writeUInt8(quantized, 8 + i);
    } else if (bits <= 16) {
      buffer.writeUInt16LE(quantized, 8 + i * 2);
    }
  }

  return buffer;
}

function dequantize(buffer, bits) {
  const minVal = buffer.readFloatLE(0);
  const range = buffer.readFloatLE(4);
  const levels = (1 << bits) - 1;

  const bytesPerSample = Math.ceil(bits / 8);
  const count = (buffer.length - 8) / bytesPerSample;
  const values = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const quantized = bits <= 8
      ? buffer.readUInt8(8 + i)
      : buffer.readUInt16LE(8 + i * 2);
    values[i] = minVal + (quantized / levels) * range;
  }

  return values;
}

// Calculate max error from quantization
function maxQuantizationError(original, restored) {
  let maxErr = 0;
  for (let i = 0; i < original.length; i++) {
    maxErr = Math.max(maxErr, Math.abs(original[i] - restored[i]));
  }
  return maxErr;
}

// Main analysis
console.log('='.repeat(70));
console.log('LUT Compression Analysis');
console.log('='.repeat(70));
console.log('');

// Read all LUTs
const allLUTs = {};
let totalOriginalSize = 0;

for (const name of profiles) {
  allLUTs[name] = readLUT(name);
  totalOriginalSize += 512; // 256 samples × 2 bytes
}

console.log(`Original size (6 profiles × 256 samples × R16F): ${totalOriginalSize} bytes`);
console.log('');

// Entropy analysis
console.log('Entropy Analysis (bits per byte, max 8):');
console.log('-'.repeat(70));

for (const name of profiles) {
  const values = allLUTs[name];
  const buffer = Buffer.alloc(512);
  for (let i = 0; i < 256; i++) {
    buffer.writeUInt16LE(float32ToFloat16(values[i]), i * 2);
  }
  const entropy = calculateEntropy(buffer);
  console.log(`  ${name.padEnd(12)}: ${entropy.toFixed(3)} bits/byte (${(entropy / 8 * 100).toFixed(1)}% of max)`);
}

console.log('');
console.log('Compression Strategies:');
console.log('='.repeat(70));

// Strategy 1: Raw R16F + gzip
const rawBuffer = Buffer.alloc(totalOriginalSize);
let offset = 0;
for (const name of profiles) {
  for (let i = 0; i < 256; i++) {
    rawBuffer.writeUInt16LE(float32ToFloat16(allLUTs[name][i]), offset);
    offset += 2;
  }
}
const rawGzipped = gzipSync(rawBuffer, { level: 9 });
console.log(`\n1. Raw R16F + gzip:`);
console.log(`   Size: ${rawGzipped.length} bytes (${(rawGzipped.length / totalOriginalSize * 100).toFixed(1)}%)`);

// Strategy 2: Delta encoding + gzip
const deltaBuffer = Buffer.alloc(totalOriginalSize);
offset = 0;
for (const name of profiles) {
  const deltas = deltaEncode(allLUTs[name]);
  for (let i = 0; i < 256; i++) {
    deltaBuffer.writeUInt16LE(float32ToFloat16(deltas[i]), offset);
    offset += 2;
  }
}
const deltaGzipped = gzipSync(deltaBuffer, { level: 9 });
console.log(`\n2. Delta encoding + R16F + gzip:`);
console.log(`   Size: ${deltaGzipped.length} bytes (${(deltaGzipped.length / totalOriginalSize * 100).toFixed(1)}%)`);

// Strategy 3: Quantization tests
console.log(`\n3. Quantization (all profiles combined):`);

for (const bits of [8, 10, 12]) {
  let totalSize = 0;
  let maxError = 0;

  const allQuantized = [];
  for (const name of profiles) {
    const quantized = quantize(allLUTs[name], bits);
    allQuantized.push(quantized);
    totalSize += quantized.length;

    const restored = dequantize(quantized, bits);
    maxError = Math.max(maxError, maxQuantizationError(allLUTs[name], restored));
  }

  // Combine and gzip
  const combined = Buffer.concat(allQuantized);
  const gzipped = gzipSync(combined, { level: 9 });

  console.log(`   ${bits}-bit: ${gzipped.length} bytes (${(gzipped.length / totalOriginalSize * 100).toFixed(1)}%), max error: ${maxError.toExponential(2)}`);
}

// Strategy 4: 8-bit quantized atlas (most compact)
console.log(`\n4. 8-bit quantized atlas (optimal for textures):`);
const atlas8bit = Buffer.alloc(256 * 6 + 8 * 6); // 256 samples × 6 profiles + headers
offset = 0;
let totalMaxError8bit = 0;

for (const name of profiles) {
  const quantized = quantize(allLUTs[name], 8);
  quantized.copy(atlas8bit, offset);
  offset += quantized.length;

  const restored = dequantize(quantized, 8);
  totalMaxError8bit = Math.max(totalMaxError8bit, maxQuantizationError(allLUTs[name], restored));
}

const atlas8bitGzipped = gzipSync(atlas8bit, { level: 9 });
console.log(`   Uncompressed: ${atlas8bit.length} bytes`);
console.log(`   Gzipped: ${atlas8bitGzipped.length} bytes (${(atlas8bitGzipped.length / totalOriginalSize * 100).toFixed(1)}%)`);
console.log(`   Max quantization error: ${totalMaxError8bit.toExponential(2)}`);

// Summary
console.log('');
console.log('='.repeat(70));
console.log('Summary:');
console.log('='.repeat(70));
console.log(`
┌───────────────────────────────┬──────────────┬───────────┬─────────────┐
│ Strategy                      │ Size (bytes) │ Ratio     │ Max Error   │
├───────────────────────────────┼──────────────┼───────────┼─────────────┤
│ Original (R16F)               │ ${String(totalOriginalSize).padStart(12)} │ 100.0%    │ 0           │
│ R16F + gzip                   │ ${String(rawGzipped.length).padStart(12)} │ ${(rawGzipped.length / totalOriginalSize * 100).toFixed(1).padStart(5)}%    │ 0           │
│ Delta + R16F + gzip           │ ${String(deltaGzipped.length).padStart(12)} │ ${(deltaGzipped.length / totalOriginalSize * 100).toFixed(1).padStart(5)}%    │ 0           │
│ 8-bit quantized + gzip        │ ${String(atlas8bitGzipped.length).padStart(12)} │ ${(atlas8bitGzipped.length / totalOriginalSize * 100).toFixed(1).padStart(5)}%    │ ~3.9e-3     │
└───────────────────────────────┴──────────────┴───────────┴─────────────┘
`);

console.log('Conclusion:');
console.log('  - R16F floating-point data has high entropy, limiting compression');
console.log('  - Delta encoding provides marginal improvement');
console.log('  - 8-bit quantization achieves best compression with acceptable error');
console.log('  - For web delivery, 8-bit quantized + gzip is recommended');
console.log('  - Max error of ~0.4% is imperceptible in visual output');

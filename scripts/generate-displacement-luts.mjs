#!/usr/bin/env node
/**
 * Build-time Displacement LUT Generator
 *
 * Generates pre-computed lookup tables for displacement profiles.
 * These LUTs are embedded into the bundle as static assets.
 *
 * Output formats:
 *   1. TypeScript constants (src/displacement/luts/generated.ts)
 *   2. Binary R16F textures (build/luts/*.bin)
 *   3. PNG visualizations (build/luts/*.png)
 *
 * Usage:
 *   node scripts/generate-displacement-luts.mjs
 *   node scripts/generate-displacement-luts.mjs --samples=512 --format=all
 *
 * Options:
 *   --samples=N     LUT resolution (default: 256)
 *   --format=TYPE   Output format: ts, bin, png, all (default: all)
 *   --outdir=PATH   Output directory (default: src/displacement/luts)
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ============================================================================
// CLI Argument Parsing
// ============================================================================

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  acc[key] = value ?? true;
  return acc;
}, {});

const SAMPLES = parseInt(args.samples ?? '256', 10);
const FORMAT = args.format ?? 'all';
const OUTDIR_TS = join(ROOT, args.outdir ?? 'src/displacement/luts');
const OUTDIR_BIN = join(ROOT, 'build/luts');

// ============================================================================
// Profile Functions (ported from src/displacement/math/profiles.ts)
// ============================================================================

/**
 * Surface height profiles for glass shapes.
 * Each function takes normalized distance from border (0=edge, 1=center)
 * and returns { height, slope }.
 */

function circleProfile(rho) {
  // h(rho) = sqrt(1 - rho^2)
  // dh/drho = -rho / sqrt(1 - rho^2)
  const rhoSq = rho * rho;
  if (rhoSq >= 1) {
    return { height: 0, slope: -Infinity };
  }
  const sqrtTerm = Math.sqrt(1 - rhoSq);
  return {
    height: sqrtTerm,
    slope: -rho / sqrtTerm,
  };
}

function squircleProfile(rho) {
  // h(rho) = (1 - rho^4)^(1/4)
  // dh/drho = -rho^3 * (1 - rho^4)^(-3/4)
  const rho4 = Math.pow(rho, 4);
  if (rho4 >= 1) {
    return { height: 0, slope: -Infinity };
  }
  const base = 1 - rho4;
  const height = Math.pow(base, 0.25);
  const slope = -Math.pow(rho, 3) * Math.pow(base, -0.75);
  return { height, slope };
}

function parabolicProfile(rho) {
  // h(rho) = 1 - rho^2
  // dh/drho = -2 * rho
  return {
    height: 1 - rho * rho,
    slope: -2 * rho,
  };
}

function exponentialProfile(rho) {
  // h(rho) ≈ exp(-3 * (1 - rho))
  // This matches the current implementation's exp(-3d/edgeWidth)
  // where d = distance from edge, normalized so edge=0, center=1
  const d = 1 - rho;  // distance from center (0=center, 1=edge)
  const height = Math.exp(-3 * d);
  const slope = 3 * Math.exp(-3 * d);  // dh/drho = -dh/dd = 3*exp(-3d)
  return { height, slope };
}

function cosineProfile(rho) {
  // h(rho) = (1 + cos(π * (1 - rho))) / 2
  // Smooth cosine falloff from center to edge
  const d = 1 - rho;
  const height = (1 + Math.cos(Math.PI * d)) / 2;
  const slope = (Math.PI / 2) * Math.sin(Math.PI * d);
  return { height, slope };
}

function linearProfile(rho) {
  // h(rho) = rho
  // Simple linear falloff
  return {
    height: rho,
    slope: 1,
  };
}

const PROFILES = {
  exponential: {
    fn: exponentialProfile,
    description: 'Current implementation default: exp(-3d)',
  },
  squircle: {
    fn: squircleProfile,
    description: 'Apple-style soft corners: (1-ρ⁴)^0.25',
  },
  circle: {
    fn: circleProfile,
    description: 'Spherical dome: √(1-ρ²)',
  },
  parabolic: {
    fn: parabolicProfile,
    description: 'Parabolic bowl: 1-ρ²',
  },
  cosine: {
    fn: cosineProfile,
    description: 'Smooth cosine: (1+cos(πd))/2',
  },
  linear: {
    fn: linearProfile,
    description: 'Linear falloff: ρ',
  },
};

// ============================================================================
// Snell's Law Refraction (ported from src/displacement/math/snell.ts)
// ============================================================================

/**
 * Calculate refraction-based displacement using Snell's Law.
 *
 * @param slope - Surface slope (dh/drho) at this point
 * @param refractiveIndex - Glass refractive index (default: 1.5)
 * @param thickness - Effective glass thickness multiplier
 * @returns Displacement magnitude [0, 1] normalized
 */
function calculateDisplacement(slope, refractiveIndex = 1.5, thickness = 1.0) {
  if (!isFinite(slope) || Math.abs(slope) < 0.001) {
    return 0;
  }

  // Normal angle from slope
  const normalAngle = Math.atan(Math.abs(slope));

  // Snell's law: n1 * sin(θ1) = n2 * sin(θ2)
  const sinTheta1 = Math.sin(normalAngle);
  const sinTheta2 = sinTheta1 / refractiveIndex;

  // Total internal reflection check
  if (sinTheta2 >= 1.0) {
    return 0;
  }

  const theta2 = Math.asin(sinTheta2);

  // Displacement = thickness * tan(refracted_angle)
  return thickness * Math.tan(theta2);
}

// ============================================================================
// LUT Generation
// ============================================================================

/**
 * Generate a displacement LUT for a given profile.
 *
 * @param profileFn - Profile function (rho) => { height, slope }
 * @param samples - Number of samples in the LUT
 * @param refractiveIndex - Glass refractive index
 * @param thickness - Glass thickness multiplier
 * @returns Float32Array of displacement magnitudes [0, 1]
 */
function generateLUT(profileFn, samples, refractiveIndex = 1.5, thickness = 1.0) {
  const lut = new Float32Array(samples);
  let maxDisp = 0;

  // First pass: compute raw displacements
  const rawDisp = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    // rho: normalized distance from border (0=edge, 1=center)
    const rho = i / (samples - 1);
    const { height, slope } = profileFn(rho);
    const disp = calculateDisplacement(slope, refractiveIndex, thickness) * height;
    rawDisp[i] = Math.abs(disp);
    maxDisp = Math.max(maxDisp, rawDisp[i]);
  }

  // Second pass: normalize to [0, 1]
  if (maxDisp > 0) {
    for (let i = 0; i < samples; i++) {
      lut[i] = rawDisp[i] / maxDisp;
    }
  }

  return lut;
}

/**
 * Generate LUTs for all profiles.
 */
function generateAllLUTs(samples, refractiveIndex = 1.5, thickness = 1.0) {
  const luts = {};

  for (const [name, { fn }] of Object.entries(PROFILES)) {
    console.log(`  Generating ${name}...`);
    luts[name] = generateLUT(fn, samples, refractiveIndex, thickness);
  }

  return luts;
}

// ============================================================================
// Output Formatters
// ============================================================================

/**
 * Generate TypeScript source file with embedded LUT data.
 */
function generateTypeScriptOutput(luts, samples) {
  const lines = [
    '/**',
    ' * Auto-generated Displacement LUTs',
    ' * DO NOT EDIT - generated by scripts/generate-displacement-luts.mjs',
    ' *',
    ` * Samples: ${samples}`,
    ` * Generated: ${new Date().toISOString()}`,
    ' */',
    '',
    '/** LUT sample count */',
    `export const LUT_SAMPLES = ${samples};`,
    '',
    '/** Available profile types */',
    `export type ProfileType = ${Object.keys(luts).map(n => `'${n}'`).join(' | ')};`,
    '',
    '/** Profile metadata */',
    'export const PROFILE_INFO: Record<ProfileType, { description: string }> = {',
  ];

  for (const [name, { description }] of Object.entries(PROFILES)) {
    lines.push(`  ${name}: { description: '${description}' },`);
  }
  lines.push('};');
  lines.push('');

  // Profile names array (for texture atlas row indexing)
  lines.push('/** Profile names in order (for texture atlas row indexing) */');
  lines.push(`export const PROFILE_NAMES: ProfileType[] = [${Object.keys(luts).map(n => `'${n}'`).join(', ')}];`);
  lines.push('');

  // Generate LUT data as typed arrays
  lines.push('/**');
  lines.push(' * Pre-computed displacement LUTs.');
  lines.push(' * Index 0 = edge (no displacement), Index N-1 = center (max displacement).');
  lines.push(' * Values are normalized [0, 1].');
  lines.push(' */');
  lines.push('export const DISPLACEMENT_LUTS: Record<ProfileType, Float32Array> = {');

  for (const [name, lut] of Object.entries(luts)) {
    // Format as compact array literal
    const values = Array.from(lut).map(v => v.toFixed(6)).join(',');
    lines.push(`  ${name}: new Float32Array([${values}]),`);
  }

  lines.push('};');
  lines.push('');

  // Helper function
  lines.push('/**');
  lines.push(' * Sample a displacement LUT with linear interpolation.');
  lines.push(' * @param profile - Profile type');
  lines.push(' * @param t - Normalized distance from edge [0, 1]');
  lines.push(' * @returns Displacement magnitude [0, 1]');
  lines.push(' */');
  lines.push('export function sampleLUT(profile: ProfileType, t: number): number {');
  lines.push('  const lut = DISPLACEMENT_LUTS[profile];');
  lines.push('  const idx = t * (LUT_SAMPLES - 1);');
  lines.push('  const i0 = Math.floor(idx);');
  lines.push('  const i1 = Math.min(i0 + 1, LUT_SAMPLES - 1);');
  lines.push('  const frac = idx - i0;');
  lines.push('  return lut[i0] * (1 - frac) + lut[i1] * frac;');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate binary R16F format for GPU texture upload.
 */
function generateBinaryOutput(lut) {
  // R16F: 16-bit float per sample
  // Use Float16Array if available, otherwise convert
  const buffer = new ArrayBuffer(lut.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < lut.length; i++) {
    // Convert float32 to float16
    const f16 = float32ToFloat16(lut[i]);
    view.setUint16(i * 2, f16, true);  // little-endian
  }

  return new Uint8Array(buffer);
}

/**
 * Convert float32 to float16 (IEEE 754 half-precision).
 */
function float32ToFloat16(val) {
  const floatView = new Float32Array(1);
  const int32View = new Int32Array(floatView.buffer);

  floatView[0] = val;
  const x = int32View[0];

  let bits = (x >> 16) & 0x8000;  // sign
  let m = (x >> 12) & 0x07ff;     // mantissa
  const e = (x >> 23) & 0xff;     // exponent

  if (e < 103) {
    // Too small, flush to zero
    return bits;
  }

  if (e > 142) {
    // Too large, clamp to max
    bits |= 0x7c00;
    bits |= ((e === 255) ? 0 : 1) && (x & 0x007fffff);
    return bits;
  }

  if (e < 113) {
    // Denormalized
    m |= 0x0800;
    bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
    return bits;
  }

  bits |= ((e - 112) << 10) | (m >> 1);
  bits += (m & 1);
  return bits;
}

/**
 * Generate WGSL shader constants for embedding LUTs.
 */
function generateWGSLOutput(luts, samples) {
  const lines = [
    '// Auto-generated Displacement LUTs',
    '// DO NOT EDIT - generated by scripts/generate-displacement-luts.mjs',
    '',
    `const LUT_SAMPLES: u32 = ${samples}u;`,
    '',
  ];

  for (const [name, lut] of Object.entries(luts)) {
    const values = Array.from(lut).map(v => v.toFixed(6)).join(', ');
    lines.push(`const LUT_${name.toUpperCase()}: array<f32, ${samples}> = array<f32, ${samples}>(`);

    // Split into rows of 8 values for readability
    const lutArr = Array.from(lut);
    for (let i = 0; i < lutArr.length; i += 8) {
      const row = lutArr.slice(i, i + 8).map(v => v.toFixed(6)).join(', ');
      const comma = (i + 8 < lutArr.length) ? ',' : '';
      lines.push(`    ${row}${comma}`);
    }
    lines.push(');');
    lines.push('');
  }

  // Add sampling function
  lines.push('fn sampleDisplacementLUT(lut: ptr<function, array<f32, LUT_SAMPLES>>, t: f32) -> f32 {');
  lines.push('    let idx = t * f32(LUT_SAMPLES - 1u);');
  lines.push('    let i0 = u32(floor(idx));');
  lines.push('    let i1 = min(i0 + 1u, LUT_SAMPLES - 1u);');
  lines.push('    let frac = idx - f32(i0);');
  lines.push('    return (*lut)[i0] * (1.0 - frac) + (*lut)[i1] * frac;');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate GLSL shader constants for embedding LUTs.
 */
function generateGLSLOutput(luts, samples) {
  const lines = [
    '// Auto-generated Displacement LUTs',
    '// DO NOT EDIT - generated by scripts/generate-displacement-luts.mjs',
    '',
    `#define LUT_SAMPLES ${samples}`,
    '',
  ];

  for (const [name, lut] of Object.entries(luts)) {
    lines.push(`const float LUT_${name.toUpperCase()}[LUT_SAMPLES] = float[LUT_SAMPLES](`);

    const lutArr = Array.from(lut);
    for (let i = 0; i < lutArr.length; i += 8) {
      const row = lutArr.slice(i, i + 8).map(v => v.toFixed(6)).join(', ');
      const comma = (i + 8 < lutArr.length) ? ',' : '';
      lines.push(`    ${row}${comma}`);
    }
    lines.push(');');
    lines.push('');
  }

  // Add sampling function
  lines.push('float sampleDisplacementLUT(float lut[LUT_SAMPLES], float t) {');
  lines.push('    float idx = t * float(LUT_SAMPLES - 1);');
  lines.push('    int i0 = int(floor(idx));');
  lines.push('    int i1 = min(i0 + 1, LUT_SAMPLES - 1);');
  lines.push('    float frac = idx - float(i0);');
  lines.push('    return lut[i0] * (1.0 - frac) + lut[i1] * frac;');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('Displacement LUT Generator');
  console.log('='.repeat(60));
  console.log(`  Samples:   ${SAMPLES}`);
  console.log(`  Format:    ${FORMAT}`);
  console.log(`  Output TS: ${OUTDIR_TS}`);
  console.log(`  Output BIN: ${OUTDIR_BIN}`);
  console.log('');

  // Generate all LUTs
  console.log('Generating LUTs...');
  const luts = generateAllLUTs(SAMPLES);
  console.log(`  Generated ${Object.keys(luts).length} profiles`);
  console.log('');

  // Create output directories
  if (!existsSync(OUTDIR_TS)) {
    mkdirSync(OUTDIR_TS, { recursive: true });
  }
  if ((FORMAT === 'all' || FORMAT === 'bin') && !existsSync(OUTDIR_BIN)) {
    mkdirSync(OUTDIR_BIN, { recursive: true });
  }

  // Write outputs
  if (FORMAT === 'all' || FORMAT === 'ts') {
    console.log('Writing TypeScript output...');
    const tsContent = generateTypeScriptOutput(luts, SAMPLES);
    const tsPath = join(OUTDIR_TS, 'generated.ts');
    writeFileSync(tsPath, tsContent);
    console.log(`  Written: ${tsPath}`);
  }

  if (FORMAT === 'all' || FORMAT === 'wgsl') {
    console.log('Writing WGSL output...');
    const wgslContent = generateWGSLOutput(luts, SAMPLES);
    const wgslPath = join(OUTDIR_TS, 'generated-luts.wgsl');
    writeFileSync(wgslPath, wgslContent);
    console.log(`  Written: ${wgslPath}`);
  }

  if (FORMAT === 'all' || FORMAT === 'glsl') {
    console.log('Writing GLSL output...');
    const glslContent = generateGLSLOutput(luts, SAMPLES);
    const glslPath = join(OUTDIR_TS, 'generated-luts.glsl');
    writeFileSync(glslPath, glslContent);
    console.log(`  Written: ${glslPath}`);
  }

  if (FORMAT === 'all' || FORMAT === 'bin') {
    console.log('Writing binary outputs...');
    for (const [name, lut] of Object.entries(luts)) {
      const binContent = generateBinaryOutput(lut);
      const binPath = join(OUTDIR_BIN, `${name}.r16f`);
      writeFileSync(binPath, binContent);
      console.log(`  Written: ${binPath} (${binContent.length} bytes)`);
    }
  }

  console.log('');
  console.log('Done!');

  // Print LUT preview
  console.log('');
  console.log('LUT Preview (first/last 5 samples):');
  console.log('-'.repeat(60));
  for (const [name, lut] of Object.entries(luts)) {
    const first = Array.from(lut.slice(0, 5)).map(v => v.toFixed(3)).join(', ');
    const last = Array.from(lut.slice(-5)).map(v => v.toFixed(3)).join(', ');
    console.log(`  ${name.padEnd(12)}: [${first}, ..., ${last}]`);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

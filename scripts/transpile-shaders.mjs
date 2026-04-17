#!/usr/bin/env node
/**
 * Shader Transpilation Script
 *
 * Converts GLSL ES 3.00 shaders to WGSL using naga-wasi-cli.
 * WGSL output is minified using strip-comments for production builds.
 *
 * Source: src/shaders/gl2/*.vert, *.frag
 * Output: src/shaders/gpu/*.vert.wgsl, *.frag.wgsl
 *
 * GLSL ES 300 → naga compatibility:
 * - naga doesn't parse "#version 300 es" directly
 * - We preprocess GLSL to remove ES-specific constructs
 * - The preprocessed version is a superset compatible with both WebGL2 and naga
 *
 * Shader files are imported directly via vite-plugin-glsl, which handles
 * GLSL minification at build time. WGSL is minified by this script.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import strip from 'strip-comments';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GL2_DIR = join(ROOT, 'src/shaders/gl2');
const GPU_DIR = join(ROOT, 'src/shaders/gpu');

// Check if minification is enabled (default: true for production)
const MINIFY = process.env.WGSL_MINIFY !== '0';

// Ensure output directory exists
if (!existsSync(GPU_DIR)) {
  mkdirSync(GPU_DIR, { recursive: true });
}

/**
 * Minify WGSL source code
 *
 * Uses strip-comments to remove // and /* comments,
 * then compresses whitespace while preserving WGSL syntax.
 */
function minifyWgsl(wgslSource) {
  // Remove C-style comments (// and /* */)
  let minified = strip(wgslSource);

  // Compress multiple whitespace/newlines to single space
  // But preserve newlines after semicolons and braces for readability
  minified = minified
    // Remove leading/trailing whitespace on each line
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n')
    // Compress multiple spaces to single space
    .replace(/[ \t]+/g, ' ')
    // Remove spaces around operators and punctuation
    .replace(/\s*([{}();,=<>+\-*\/&|!:\[\]])\s*/g, '$1')
    // Restore necessary spaces (after keywords, before identifiers)
    .replace(/\b(fn|let|var|const|if|else|for|while|return|struct|uniform|storage|read|write|read_write)\b/g, ' $1 ')
    .replace(/(@\w+)/g, ' $1')
    // Clean up extra spaces
    .replace(/\s+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

  return minified;
}

/**
 * Preprocess GLSL ES 300 to naga-compatible GLSL 450
 *
 * Transforms:
 * - #version 300 es → #version 450
 * - precision highp float; → (removed)
 * - gl_VertexID → gl_VertexIndex (Vulkan-style)
 * - uniform variables → uniform block with layout(binding=X)
 * - sampler2D uniforms → combined with layout(binding=X)
 * - layout qualifier for fragment output
 *
 * This allows the same GLSL logic to work in both WebGL2 (ES 300)
 * and WebGPU (via naga transpilation to WGSL).
 */
function preprocessGlslForNaga(glslSource, shaderType) {
  let processed = glslSource;

  // Replace version directive
  processed = processed.replace(/#version\s+300\s+es\b/g, '#version 450');

  // Remove precision qualifiers (not needed in GLSL 450)
  processed = processed.replace(/precision\s+(highp|mediump|lowp)\s+(float|int|sampler2D|samplerCube);?\s*/g, '');

  // Convert gl_VertexID to gl_VertexIndex (Vulkan/naga style)
  processed = processed.replace(/\bgl_VertexID\b/g, 'gl_VertexIndex');

  // Add layout qualifier for fragment shader output if not present
  if (shaderType === 'frag') {
    // Convert "out vec4 fragColor;" to "layout(location = 0) out vec4 fragColor;"
    processed = processed.replace(
      /(?<!layout\s*\([^)]*\)\s*)out\s+vec4\s+fragColor\s*;/g,
      'layout(location = 0) out vec4 fragColor;'
    );
  }

  // Extract and convert uniforms to uniform block + sampler bindings
  // This is the key transformation for naga compatibility
  const uniformPattern = /uniform\s+(\w+)\s+(\w+)\s*;/g;
  const uniforms = [];
  const samplers = [];
  let bindingIndex = 0;

  let match;
  while ((match = uniformPattern.exec(processed)) !== null) {
    const [fullMatch, type, name] = match;
    if (type === 'sampler2D' || type === 'samplerCube' || type === 'sampler3D') {
      // Map combined sampler type to separate texture type
      const textureType = type === 'sampler2D' ? 'texture2D' :
                          type === 'samplerCube' ? 'textureCube' : 'texture3D';
      samplers.push({ combinedType: type, textureType, name });
    } else {
      uniforms.push({ type, name });
    }
  }

  // If we have uniforms (non-samplers), create a uniform block
  if (uniforms.length > 0) {
    // Remove all non-sampler uniform declarations
    for (const u of uniforms) {
      const regex = new RegExp(`uniform\\s+${u.type}\\s+${u.name}\\s*;[^\\n]*\\n?`, 'g');
      processed = processed.replace(regex, '');
    }

    // Create uniform block after #version directive
    const uniformBlockMembers = uniforms.map(u => `    ${u.type} ${u.name};`).join('\n');
    const uniformBlock = `
layout(set = 0, binding = ${bindingIndex}) uniform Uniforms {
${uniformBlockMembers}
};
`;

    // Insert after #version line
    processed = processed.replace(/(#version\s+450\s*\n)/, `$1${uniformBlock}`);
    bindingIndex++;
  }

  // Convert sampler uniforms to separate texture + sampler (naga/Vulkan style)
  // Combined sampler2D → texture2D + sampler (used as sampler2D(tex, samp))
  for (const s of samplers) {
    const textureBinding = bindingIndex++;
    const samplerBinding = bindingIndex++;
    const samplerName = `${s.name}_sampler`;

    // Replace uniform declaration with separate texture and sampler
    const regex = new RegExp(`uniform\\s+${s.combinedType}\\s+${s.name}\\s*;[^\\n]*\\n?`, 'g');
    processed = processed.replace(
      regex,
      `layout(set = 0, binding = ${textureBinding}) uniform ${s.textureType} ${s.name};\n` +
      `layout(set = 0, binding = ${samplerBinding}) uniform sampler ${samplerName};\n`
    );

    // Replace texture() calls that use this sampler
    // texture(samplerName, coord) → texture(sampler2D(samplerName, samplerName_sampler), coord)
    const textureCallRegex = new RegExp(`\\btexture\\s*\\(\\s*${s.name}\\s*,`, 'g');
    processed = processed.replace(
      textureCallRegex,
      `texture(${s.combinedType}(${s.name}, ${samplerName}),`
    );
  }

  return processed;
}

/**
 * Transpile GLSL to WGSL using naga-wasi-cli
 *
 * IMPORTANT: naga-wasi-cli requires relative paths due to WASI preopens.
 * We write temp files to the project root to ensure they are accessible.
 */
function transpileShader(inputPath, outputPath, shaderType) {
  // Read and preprocess GLSL
  const originalGlsl = readFileSync(inputPath, 'utf-8');
  const preprocessedGlsl = preprocessGlslForNaga(originalGlsl, shaderType);

  // Use relative paths from project root (required for WASI filesystem access)
  // Include shader type in filename for naga auto-detection (e.g., _tmp_quadrant.frag.glsl)
  const tempFilename = `_tmp_${basename(inputPath, extname(inputPath))}.${shaderType}.glsl`;
  const tempPath = join(ROOT, tempFilename);

  // Output path must also be relative to ROOT for WASI
  const relativeOutputPath = outputPath.replace(ROOT + '/', '');

  try {
    writeFileSync(tempPath, preprocessedGlsl);

    execSync(
      `npx naga-wasi-cli "${tempFilename}" "${relativeOutputPath}" --input-kind glsl`,
      {
        cwd: ROOT,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    // Minify WGSL output if enabled
    if (MINIFY) {
      const wgslContent = readFileSync(outputPath, 'utf-8');
      const originalSize = wgslContent.length;
      const minifiedContent = minifyWgsl(wgslContent);
      writeFileSync(outputPath, minifiedContent);
      const minifiedSize = minifiedContent.length;
      const reduction = ((1 - minifiedSize / originalSize) * 100).toFixed(1);
      console.log(`  [OK] ${basename(inputPath)} -> ${basename(outputPath)} (minified: -${reduction}%)`);
    } else {
      console.log(`  [OK] ${basename(inputPath)} -> ${basename(outputPath)}`);
    }
    return true;
  } catch (error) {
    console.error(`  [FAIL] ${basename(inputPath)}: ${error.message}`);
    if (error.stderr) {
      console.error(`         ${error.stderr.toString().trim()}`);
    }
    // Show preprocessed content for debugging
    console.error(`         Preprocessed temp file: ${tempFilename}`);
    return false;
  } finally {
    // Clean up temp file
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {}
  }
}

// Main execution
console.log('Transpiling GLSL -> WGSL...');
console.log(`Source: ${GL2_DIR}`);
console.log(`Output: ${GPU_DIR}`);
console.log(`Minify: ${MINIFY ? 'enabled' : 'disabled'}`);
console.log('');

const glslFiles = readdirSync(GL2_DIR).filter(f => f.endsWith('.vert') || f.endsWith('.frag'));

let success = true;
for (const file of glslFiles) {
  const inputPath = join(GL2_DIR, file);
  const outputPath = join(GPU_DIR, `${file}.wgsl`);
  const shaderType = extname(file).slice(1);

  if (!transpileShader(inputPath, outputPath, shaderType)) {
    success = false;
  }
}

console.log('');
if (success) {
  console.log(`Shader transpilation completed successfully.${MINIFY ? ' (WGSL minified)' : ''}`);
} else {
  console.log('Shader transpilation completed with errors.');
  process.exit(1);
}

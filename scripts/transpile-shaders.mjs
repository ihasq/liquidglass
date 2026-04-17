#!/usr/bin/env node
/**
 * Shader Transpilation Script
 *
 * Converts GLSL ES 3.00 shaders to WGSL using naga-wasi-cli.
 *
 * Source: src/shaders/gl2/*.vert, *.frag
 * Output: src/shaders/wgsl/*.vert.wgsl, *.frag.wgsl
 *
 * GLSL ES 300 → naga compatibility:
 * - naga doesn't parse "#version 300 es" directly
 * - We preprocess GLSL to remove ES-specific constructs
 * - The preprocessed version is a superset compatible with both WebGL2 and naga
 *
 * This script also generates TypeScript modules that export
 * shader source code as string constants for both WebGL2 and WebGPU.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GL2_DIR = join(ROOT, 'src/shaders/gl2');
const WGSL_DIR = join(ROOT, 'src/shaders/wgsl');
const GEN_DIR = join(ROOT, 'src/shaders/generated');

// Ensure output directories exist
[WGSL_DIR, GEN_DIR].forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

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

    console.log(`  [OK] ${basename(inputPath)} -> ${basename(outputPath)}`);
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

/**
 * Escape string for JavaScript template literal
 */
function escapeForTemplate(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

/**
 * Generate TypeScript module exporting shader sources
 */
function generateShaderModule() {
  const shaders = {};

  // Read all GLSL shaders
  const glslFiles = readdirSync(GL2_DIR).filter(f => f.endsWith('.vert') || f.endsWith('.frag'));

  for (const file of glslFiles) {
    const name = basename(file, extname(file));
    const type = extname(file).slice(1); // 'vert' or 'frag'
    const key = `${name}_${type}`;

    const glslPath = join(GL2_DIR, file);
    const wgslPath = join(WGSL_DIR, `${file}.wgsl`);

    const glslSource = readFileSync(glslPath, 'utf-8');
    const wgslSource = existsSync(wgslPath) ? readFileSync(wgslPath, 'utf-8') : null;

    shaders[key] = {
      name,
      type,
      glsl: glslSource,
      wgsl: wgslSource,
    };
  }

  // Generate TypeScript module
  let tsContent = `/**
 * Auto-generated shader sources
 * DO NOT EDIT - Generated by scripts/transpile-shaders.mjs
 *
 * Source of truth: src/shaders/gl2/*.vert, *.frag
 * WGSL generated by: naga-wasi-cli
 */

`;

  // Export GLSL shaders
  tsContent += `// ============================================================================\n`;
  tsContent += `// GLSL ES 3.00 Shaders (WebGL2)\n`;
  tsContent += `// ============================================================================\n\n`;

  for (const [key, shader] of Object.entries(shaders)) {
    const constName = `GLSL_${shader.name.toUpperCase()}_${shader.type.toUpperCase()}`;
    tsContent += `export const ${constName} = /* glsl */ \`${escapeForTemplate(shader.glsl)}\`;\n\n`;
  }

  // Export WGSL shaders
  tsContent += `// ============================================================================\n`;
  tsContent += `// WGSL Shaders (WebGPU)\n`;
  tsContent += `// ============================================================================\n\n`;

  for (const [key, shader] of Object.entries(shaders)) {
    const constName = `WGSL_${shader.name.toUpperCase()}_${shader.type.toUpperCase()}`;
    if (shader.wgsl) {
      tsContent += `export const ${constName} = /* wgsl */ \`${escapeForTemplate(shader.wgsl)}\`;\n\n`;
    } else {
      tsContent += `// ${constName} - transpilation failed, using fallback\n`;
      tsContent += `export const ${constName}: string | null = null;\n\n`;
    }
  }

  // Write TypeScript module
  const outputPath = join(GEN_DIR, 'shaders.ts');
  writeFileSync(outputPath, tsContent);
  console.log(`Generated: ${outputPath}`);
}

// Main execution
console.log('Transpiling GLSL -> WGSL...');
console.log(`Source: ${GL2_DIR}`);
console.log(`Output: ${WGSL_DIR}`);
console.log('');

const glslFiles = readdirSync(GL2_DIR).filter(f => f.endsWith('.vert') || f.endsWith('.frag'));

let success = true;
for (const file of glslFiles) {
  const inputPath = join(GL2_DIR, file);
  const outputPath = join(WGSL_DIR, `${file}.wgsl`);
  const shaderType = extname(file).slice(1);

  if (!transpileShader(inputPath, outputPath, shaderType)) {
    success = false;
  }
}

console.log('');
console.log('Generating TypeScript module...');
generateShaderModule();

console.log('');
if (success) {
  console.log('Shader transpilation completed successfully.');
} else {
  console.log('Shader transpilation completed with errors.');
  process.exit(1);
}

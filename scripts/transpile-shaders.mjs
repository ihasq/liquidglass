#!/usr/bin/env node
/**
 * Shader Transpilation Script (WGSL -> GLSL)
 *
 * Converts WGSL shaders to GLSL ES 3.00 using naga-wasi-cli.
 * WGSL is the source of truth; GLSL is generated for WebGL2 compatibility.
 *
 * Uses wgsl_reflect for proper AST-based parsing instead of regex.
 *
 * Source: src/shaders/*.wgsl
 * Output: generated/gl2/*.vert, *.frag
 *
 * WGSL -> GLSL conversion notes:
 * - naga outputs GLSL 450 by default
 * - We post-process to convert to GLSL ES 300 for WebGL2
 * - Uniform blocks are converted to individual uniforms (extracted via wgsl_reflect)
 * - Texture/sampler pairs are converted to combined sampler2D
 *
 * IMPORTANT: Y-axis convention differs between WebGL2 and WebGPU!
 * - WebGPU/WGSL: Y=0 at top (Vulkan/D3D convention)
 * - WebGL2/GLSL: Y=0 at bottom (OpenGL convention)
 *
 * Y-axis dependent code must be marked with `// @webgl2-y-flip` comment in WGSL.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WgslReflect } from 'wgsl_reflect';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const WGSL_DIR = join(ROOT, 'src/shaders');
const GL2_DIR = join(ROOT, 'generated/gl2');

// Ensure output directory exists
if (!existsSync(GL2_DIR)) {
  mkdirSync(GL2_DIR, { recursive: true });
}

/**
 * Map WGSL type names to GLSL type names
 * Comprehensive mapping covering all WGSL uniform-compatible types
 */
function wgslTypeToGlsl(typeName) {
  const typeMap = {
    // Scalars
    'f32': 'float',
    'f16': 'float',  // f16 not supported in GLSL ES 300, fallback to float
    'i32': 'int',
    'u32': 'uint',
    'bool': 'bool',

    // Vectors (template syntax)
    'vec2<f32>': 'vec2',
    'vec3<f32>': 'vec3',
    'vec4<f32>': 'vec4',
    'vec2<f16>': 'vec2',  // f16 fallback
    'vec3<f16>': 'vec3',
    'vec4<f16>': 'vec4',
    'vec2<i32>': 'ivec2',
    'vec3<i32>': 'ivec3',
    'vec4<i32>': 'ivec4',
    'vec2<u32>': 'uvec2',
    'vec3<u32>': 'uvec3',
    'vec4<u32>': 'uvec4',
    'vec2<bool>': 'bvec2',
    'vec3<bool>': 'bvec3',
    'vec4<bool>': 'bvec4',

    // Vectors (short syntax)
    'vec2f': 'vec2',
    'vec3f': 'vec3',
    'vec4f': 'vec4',
    'vec2h': 'vec2',  // f16 fallback
    'vec3h': 'vec3',
    'vec4h': 'vec4',
    'vec2i': 'ivec2',
    'vec3i': 'ivec3',
    'vec4i': 'ivec4',
    'vec2u': 'uvec2',
    'vec3u': 'uvec3',
    'vec4u': 'uvec4',

    // Square matrices (template syntax)
    'mat2x2<f32>': 'mat2',
    'mat3x3<f32>': 'mat3',
    'mat4x4<f32>': 'mat4',

    // Non-square matrices (template syntax)
    'mat2x3<f32>': 'mat2x3',
    'mat2x4<f32>': 'mat2x4',
    'mat3x2<f32>': 'mat3x2',
    'mat3x4<f32>': 'mat3x4',
    'mat4x2<f32>': 'mat4x2',
    'mat4x3<f32>': 'mat4x3',

    // Matrices (short syntax)
    'mat2x2f': 'mat2',
    'mat3x3f': 'mat3',
    'mat4x4f': 'mat4',
    'mat2x3f': 'mat2x3',
    'mat2x4f': 'mat2x4',
    'mat3x2f': 'mat3x2',
    'mat3x4f': 'mat3x4',
    'mat4x2f': 'mat4x2',
    'mat4x3f': 'mat4x3',
  };

  // Handle array types: array<T, N> -> T[N]
  const arrayMatch = typeName.match(/^array<(.+),\s*(\d+)>$/);
  if (arrayMatch) {
    const elementType = wgslTypeToGlsl(arrayMatch[1]);
    const count = arrayMatch[2];
    return `${elementType}[${count}]`;
  }

  return typeMap[typeName] || typeName;
}

/**
 * Extract shader metadata using wgsl_reflect
 */
function extractShaderMetadata(wgslSource) {
  const reflect = new WgslReflect(wgslSource);

  // Extract uniform buffer members
  const uniforms = [];
  for (const uniform of reflect.uniforms) {
    if (uniform.type.isStruct && uniform.type.members) {
      for (const member of uniform.type.members) {
        uniforms.push({
          name: member.name,
          type: wgslTypeToGlsl(member.type.name),
          group: uniform.group,
          binding: uniform.binding,
        });
      }
    }
  }

  // Extract textures with their bindings
  const textures = reflect.textures.map(tex => ({
    name: tex.name,
    group: tex.group,
    binding: tex.binding,
    type: tex.type.name,
  }));

  // Extract samplers with their bindings
  const samplers = reflect.samplers.map(samp => ({
    name: samp.name,
    group: samp.group,
    binding: samp.binding,
  }));

  // Detect Y-axis dependent code via comments
  const hasYFlipCode = wgslSource.includes('@webgl2-y-flip');

  return { uniforms, textures, samplers, hasYFlipCode };
}

/**
 * Generate GLSL uniform declarations from parsed metadata
 * Note: Texture/sampler declarations are handled separately via naga replacement
 */
function generateUniformDeclarations(metadata) {
  const lines = [];

  // Generate individual uniform declarations (from uniform buffers only)
  for (const uniform of metadata.uniforms) {
    lines.push(`uniform ${uniform.type} ${uniform.name};`);
  }

  return lines.join('\n');
}

/**
 * Build naga name mapping for textures/samplers
 * naga generates names like _group_0_binding_1_fs for group=0, binding=1 fragment shader
 */
function buildNagaNameMap(metadata, shaderStage) {
  const map = {};
  const stageSuffix = shaderStage === 'frag' ? 'fs' : 'vs';

  for (const texture of metadata.textures) {
    const nagaName = `_group_${texture.group}_binding_${texture.binding}_${stageSuffix}`;
    let uniformName = texture.name;
    if (!uniformName.startsWith('u_')) {
      uniformName = 'u_' + uniformName.charAt(0).toLowerCase() + uniformName.slice(1);
    }
    map[nagaName] = uniformName;
  }

  return map;
}

/**
 * Post-process naga GLSL 450 output to GLSL ES 300
 * Uses parsed metadata instead of hardcoded values
 */
function postprocessGlslForWebGL2(glslSource, shaderType, metadata) {
  let processed = glslSource;

  // Replace version directive (naga outputs 310 es or 450, we need 300 es for WebGL2)
  processed = processed.replace(/#version\s+(450|310\s+es)\b/g, '#version 300 es');

  // Remove naga's precision qualifiers (we'll add our own)
  processed = processed.replace(/precision\s+highp\s+(float|int)\s*;\s*\n/g, '');

  // Add precision qualifier for fragment shaders (after version directive)
  if (shaderType === 'frag') {
    processed = processed.replace(
      /(#version\s+300\s+es\s*\n)/,
      '$1precision highp float;\n'
    );
  }

  // Remove layout(location = 0) from output declarations
  processed = processed.replace(/layout\s*\(\s*location\s*=\s*0\s*\)\s*out/g, 'out');

  // Remove struct definitions that are only used for uniform blocks
  processed = processed.replace(
    /struct\s+Uniforms\s*\{[^}]+\}\s*;?\s*\n?/g,
    ''
  );

  // Remove the uniform block declarations
  processed = processed.replace(
    /uniform\s+\w+_block_\d+\w*\s*\{\s*\w+\s+_group_\d+_binding_\d+_\w+\s*;\s*\}\s*;?\s*\n?/g,
    ''
  );

  // Convert naga's _group_X_binding_Y_fs.member access to just member
  processed = processed.replace(/_group_\d+_binding_\d+_\w+\.(\w+)/g, '$1');

  // Build texture name mapping and apply replacements
  const nameMap = buildNagaNameMap(metadata, shaderType);
  for (const [nagaName, uniformName] of Object.entries(nameMap)) {
    // Replace sampler2D declaration
    const declRegex = new RegExp(`uniform\\s+highp\\s+sampler2D\\s+${nagaName}\\s*;`, 'g');
    processed = processed.replace(declRegex, `uniform sampler2D ${uniformName};`);

    // Replace texture sampling calls
    const sampleRegex = new RegExp(`texture\\s*\\(\\s*${nagaName}\\s*,`, 'g');
    processed = processed.replace(sampleRegex, `texture(${uniformName},`);
  }

  // Convert naga's output variable to standard fragColor
  processed = processed.replace(/out\s+vec4\s+_fs2p_location0\s*;/g, 'out vec4 fragColor;');
  processed = processed.replace(/_fs2p_location0/g, 'fragColor');

  // Insert uniform declarations (from parsed metadata)
  const uniformDecls = generateUniformDeclarations(metadata);
  if (uniformDecls && shaderType === 'frag') {
    // Insert after precision directive
    processed = processed.replace(
      /(precision\s+highp\s+float\s*;\s*\n)/,
      `$1\n${uniformDecls}\n\n`
    );
  }

  // =========================================================================
  // Y-AXIS COORDINATE SYSTEM FIX
  // =========================================================================
  // WebGPU: Y=0 at top, so `py >= centerY` means bottom half
  // WebGL2: Y=0 at bottom, so `py < centerY` means bottom half
  //
  // This transformation is applied when @webgl2-y-flip markers are detected
  // =========================================================================

  if (metadata.hasYFlipCode) {
    // Fix isBottom: `py >= centerY` (WebGPU) -> `py < centerY` (WebGL2)
    processed = processed.replace(
      /bool\s+isBottom\s*=\s*\(?py\s*>=\s*centerY\)?/g,
      'bool isBottom = py < centerY'
    );

    // Swap qy calculations:
    // Pattern A: qy = (py - centerY) -> qy = (centerY - 1.0 - py)
    // Pattern B: qy = (centerY - 1.0 - py) -> qy = (py - centerY)
    processed = processed.replace(
      /qy\s*=\s*\(?\s*py\s*-\s*centerY\s*\)?\s*;/g,
      'qy = __PLACEHOLDER_A__;'
    );
    processed = processed.replace(
      /qy\s*=\s*\(?\s*\(?\s*centerY\s*-\s*1\.0\s*\)?\s*-\s*py\s*\)?\s*;/g,
      'qy = __PLACEHOLDER_B__;'
    );
    processed = processed.replace(/__PLACEHOLDER_A__/g, '(centerY - 1.0 - py)');
    processed = processed.replace(/__PLACEHOLDER_B__/g, '(py - centerY)');
  }

  // Clean up extra whitespace
  processed = processed.replace(/\n\s*\n\s*\n/g, '\n\n');

  return processed.trim() + '\n';
}

/**
 * Transpile WGSL to GLSL using naga-wasi-cli
 */
function transpileShader(inputPath, outputPath, shaderType, shaderName) {
  // Read WGSL source
  const wgslSource = readFileSync(inputPath, 'utf-8');

  // Parse with wgsl_reflect
  let metadata;
  try {
    metadata = extractShaderMetadata(wgslSource);
  } catch (parseError) {
    console.error(`  [FAIL] ${basename(inputPath)}: WGSL parse error: ${parseError.message}`);
    return false;
  }

  // Use relative paths from project root (required for WASI filesystem access)
  const relativeInputPath = inputPath.replace(ROOT + '/', '');
  const tempOutputName = `_tmp_${shaderName}.${shaderType}`;
  const tempOutputPath = join(ROOT, tempOutputName);

  try {
    // Run naga to convert WGSL -> GLSL
    execSync(
      `npx naga-wasi-cli "${relativeInputPath}" "${tempOutputName}"`,
      {
        cwd: ROOT,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    // Read the naga output
    const nagaOutput = readFileSync(tempOutputPath, 'utf-8');

    // Post-process for WebGL2 compatibility using parsed metadata
    const processedGlsl = postprocessGlslForWebGL2(nagaOutput, shaderType, metadata);

    // Write final output
    writeFileSync(outputPath, processedGlsl);

    const uniformCount = metadata.uniforms.length;
    const textureCount = metadata.textures.length;
    console.log(`  [OK] ${basename(inputPath)} -> ${basename(outputPath)} (${uniformCount} uniforms, ${textureCount} textures)`);
    return true;
  } catch (error) {
    console.error(`  [FAIL] ${basename(inputPath)}: ${error.message}`);
    if (error.stderr) {
      console.error(`         ${error.stderr.toString().trim()}`);
    }
    return false;
  } finally {
    // Clean up temp file
    try {
      if (existsSync(tempOutputPath)) {
        unlinkSync(tempOutputPath);
      }
    } catch {}
  }
}

/**
 * Determine shader type from filename
 */
function getShaderInfo(filename) {
  if (filename.endsWith('.vert.wgsl')) {
    return {
      type: 'vert',
      name: filename.replace('.vert.wgsl', ''),
      outputExt: '.vert'
    };
  } else if (filename.endsWith('.frag.wgsl')) {
    return {
      type: 'frag',
      name: filename.replace('.frag.wgsl', ''),
      outputExt: '.frag'
    };
  }
  return null;
}

// Main execution
console.log('Transpiling WGSL -> GLSL ES 300 (using wgsl_reflect)...');
console.log(`Source: ${WGSL_DIR}`);
console.log(`Output: ${GL2_DIR}`);
console.log('');

const wgslFiles = readdirSync(WGSL_DIR).filter(f => f.endsWith('.wgsl'));

let success = true;
for (const file of wgslFiles) {
  const shaderInfo = getShaderInfo(file);
  if (!shaderInfo) {
    console.warn(`  [SKIP] ${file}: Unknown shader type`);
    continue;
  }

  const inputPath = join(WGSL_DIR, file);
  const outputPath = join(GL2_DIR, `${shaderInfo.name}${shaderInfo.outputExt}`);

  if (!transpileShader(inputPath, outputPath, shaderInfo.type, shaderInfo.name)) {
    success = false;
  }
}

console.log('');
if (success) {
  console.log('Shader transpilation completed successfully.');
} else {
  console.log('Shader transpilation completed with errors.');
  process.exit(1);
}

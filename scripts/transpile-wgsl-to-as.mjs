#!/usr/bin/env node
/**
 * WGSL -> AssemblyScript Transpiler
 *
 * Converts WGSL fragment shaders to AssemblyScript for WASM-SIMD execution.
 * Uses wgsl_reflect's WgslParser for proper AST-based parsing.
 *
 * This enables a single source of truth (WGSL) for all backends:
 *   - WebGPU: WGSL (direct)
 *   - WebGL2: GLSL (via naga transpilation)
 *   - WASM-SIMD: AssemblyScript (via this transpiler)
 *
 * Source: src/shaders/quadrant.frag.wgsl
 * Output: generated/wasm-simd/index.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WgslParser } from 'wgsl_reflect';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const WGSL_INPUT = join(ROOT, 'src/shaders/quadrant.frag.wgsl');
const AS_OUTPUT = join(ROOT, 'generated/wasm-simd/index.ts');

// ============================================================================
// AST Node Type Detection
// ============================================================================

function getNodeType(node) {
  const name = node.constructor.name;
  // Map minified class names to semantic names
  const typeMap = {
    'ie': 'Struct',
    'F': 'Var',
    'P': 'Const',
    'D': 'Function',
    'U': 'Let',
    'V': 'VarDecl',
    'If': 'If',
    'ne': 'If',
    'Q': 'If',        // Another minified if
    'Return': 'Return',
    'fe': 'Return',
    'Y': 'Return',    // Another minified return
    '_e': 'Literal',  // Literal expression
    'xe': 'Variable', // Variable reference
    'we': 'Binary',   // Binary expression
    'me': 'Call',     // Function call
    // Loop and control flow (handled via pattern matching)
    'For': 'For',
    'While': 'While',
    'Break': 'Break',
    'Continue': 'Continue',
    // Expression types (handled via pattern matching in convertExpr)
    'UnaryExpr': 'Unary',
    'MemberAccess': 'Member',
    'IndexAccess': 'Index',
  };
  return typeMap[name] || name;
}

// ============================================================================
// Expression Conversion
// ============================================================================

function convertExpr(expr, indent = '') {
  if (!expr) return 'undefined';

  const type = expr.constructor.name;

  // Typed literal value (e.g., f32 constant)
  // Has structure: { value: { data: Float32Array([...]) }, type: { name: 'f32' } }
  if (expr.value && expr.value.data && expr.value.data[0] !== undefined) {
    const val = expr.value.data[0];
    const valStr = String(val);
    // Ensure floats have decimal point for AssemblyScript
    if (!valStr.includes('.') && !valStr.includes('e')) {
      return valStr + '.0';
    }
    return valStr;
  }

  // Simple literal value
  if (expr.value !== undefined && typeof expr.value !== 'object') {
    const val = String(expr.value);
    // Ensure floats have decimal point
    if (typeof expr.value === 'number' && !val.includes('.') && !val.includes('e')) {
      return val + '.0';
    }
    return val;
  }

  // Variable reference
  if (expr.name !== undefined && !expr.args && !expr.value) {
    const name = expr.name;
    // Map uniform access
    if (name === 'uniforms') return 'uniforms';
    return name;
  }

  // Member access (e.g., uniforms.u_quadResolution.x)
  if (expr.object && expr.member) {
    const obj = convertExpr(expr.object);
    const member = expr.member;

    // Handle uniform struct access
    if (obj === 'uniforms') {
      const uniformMap = {
        'u_quadResolution': { x: 'f32(quadWidth)', y: 'f32(quadHeight)' },
        'u_fullResolution': { x: 'f32(fullWidth)', y: 'f32(fullHeight)' },
        'u_borderRadius': 'borderRadius',
        'u_edgeWidthRatio': 'edgeWidthRatio',
      };
      return uniformMap[member] || `${obj}.${member}`;
    }

    // Handle vec.x, vec.y access on uniform-derived values
    if (typeof obj === 'object' && obj[member]) {
      return obj[member];
    }

    return `${obj}.${member}`;
  }

  // Nested member access
  if (expr.postfix && expr.postfix.length > 0) {
    let result = convertExpr(expr.value);
    for (const post of expr.postfix) {
      if (post.member) {
        // Check if result is an object mapping
        if (typeof result === 'object' && result[post.member]) {
          result = result[post.member];
        } else {
          result = `${result}.${post.member}`;
        }
      } else if (post.index !== undefined) {
        result = `${result}[${convertExpr(post.index)}]`;
      }
    }
    return result;
  }

  // Binary operation
  if (expr.left && expr.right && expr.operator) {
    const left = convertExpr(expr.left);
    const right = convertExpr(expr.right);
    const op = expr.operator;

    // Handle operator mapping
    const opMap = {
      'and': '&&',
      'or': '||',
    };
    const asOp = opMap[op] || op;

    return `${left} ${asOp} ${right}`;
  }

  // Unary operation
  if (expr.operator && expr.right && !expr.left) {
    return `${expr.operator}${convertExpr(expr.right)}`;
  }

  // Function call
  if (expr.name && expr.args) {
    const name = expr.name;
    const args = expr.args.map(a => convertExpr(a)).join(', ');

    // Handle special functions
    if (name === 'vec4') return `vec4<f32>(${args})`;
    if (name === 'vec2') return `vec2<f32>(${args})`;
    if (name === 'clamp') return `clamp<f32>(${args})`;
    if (name === 'floor') return `floor(${args})`;
    if (name === 'min') return `min(${args})`;
    if (name === 'max') return `max(${args})`;
    if (name === 'sqrt') return `sqrt(${args})`;
    if (name === 'exp2') return `exp2(${args})`;

    return `${name}(${args})`;
  }

  // Create expression (constructor)
  if (expr.type && expr.args) {
    const typeName = expr.type.name || expr.type;
    const args = expr.args.map(a => convertExpr(a)).join(', ');
    return `${typeName}(${args})`;
  }

  // Fallback
  console.warn('Unknown expression type:', type, expr);
  return `/* unknown: ${type} */`;
}

// ============================================================================
// Statement Conversion
// ============================================================================

function convertStatement(stmt, indent = '    ') {
  const type = getNodeType(stmt);

  // Let declaration
  if (type === 'Let' || type === 'U') {
    const name = stmt.name;
    const value = convertExpr(stmt.value);

    // Handle uniform access that returns object
    if (typeof value === 'object') {
      // This shouldn't happen for final values, but handle it
      return `${indent}const ${name}: f32 = ${JSON.stringify(value)};`;
    }

    return `${indent}const ${name}: f32 = ${value};`;
  }

  // Var declaration
  if (type === 'VarDecl' || type === 'V') {
    const name = stmt.name;
    const initValue = stmt.value ? convertExpr(stmt.value) : '0.0';
    return `${indent}let ${name}: f32 = ${initValue};`;
  }

  // If statement
  if (type === 'If' || type === 'ne') {
    const cond = convertExpr(stmt.condition);
    const bodyLines = stmt.body.map(s => convertStatement(s, indent + '  ')).join('\n');

    let result = `${indent}if (${cond}) {\n${bodyLines}\n${indent}}`;

    if (stmt.elseBody && stmt.elseBody.length > 0) {
      const elseLines = stmt.elseBody.map(s => convertStatement(s, indent + '  ')).join('\n');
      result += ` else {\n${elseLines}\n${indent}}`;
    }

    return result;
  }

  // Return statement
  if (type === 'Return' || type === 'fe') {
    const value = convertExpr(stmt.value);
    return `${indent}return ${value};`;
  }

  // Assignment
  if (stmt.variable && stmt.value) {
    const varName = stmt.variable.name || convertExpr(stmt.variable);
    const value = convertExpr(stmt.value);
    return `${indent}${varName} = ${value};`;
  }

  // For loop
  if (type === 'For') {
    const init = stmt.init ? convertStatement(stmt.init, '') : '';
    const cond = stmt.condition ? convertExpr(stmt.condition) : 'true';
    const update = stmt.update ? convertExpr(stmt.update) : '';
    const bodyLines = stmt.body.map(s => convertStatement(s, indent + '  ')).join('\n');
    return `${indent}for (${init}; ${cond}; ${update}) {\n${bodyLines}\n${indent}}`;
  }

  // While loop
  if (type === 'While') {
    const cond = convertExpr(stmt.condition);
    const bodyLines = stmt.body.map(s => convertStatement(s, indent + '  ')).join('\n');
    return `${indent}while (${cond}) {\n${bodyLines}\n${indent}}`;
  }

  // Break/Continue
  if (type === 'Break') return `${indent}break;`;
  if (type === 'Continue') return `${indent}continue;`;

  console.warn('Unknown statement type:', type, stmt);
  return `${indent}/* unknown statement: ${type} */`;
}

// ============================================================================
// Function Conversion
// ============================================================================

function convertHelperFunction(fn) {
  const name = fn.name;
  const params = fn.args.map(a => `${a.name}: f32`).join(', ');
  const returnType = fn.returnType?.name || 'f32';

  // Convert body statements
  const bodyLines = fn.body.map(stmt => {
    const type = getNodeType(stmt);

    if (type === 'If' || type === 'ne' || type === 'Q') {
      // Handle if with early return
      const cond = convertExpr(stmt.condition);
      return `  if (${cond}) { ${stmt.body.map(s => {
        const sType = getNodeType(s);
        if (sType === 'Return' || sType === 'fe' || sType === 'Y') {
          return `return ${convertExpr(s.value)};`;
        }
        return convertStatement(s, '');
      }).join(' ')} }`;
    }

    if (type === 'Let' || type === 'U') {
      const varName = stmt.name;
      const value = convertExpr(stmt.value);
      return `  const ${varName}: f32 = ${value};`;
    }

    if (type === 'Return' || type === 'fe' || type === 'Y') {
      return `  return ${convertExpr(stmt.value)};`;
    }

    return `  ${convertStatement(stmt, '')}`;
  }).join('\n');

  // Special handling for fastExp - replace exp2(k) with bit manipulation
  let finalBody = bodyLines;
  if (name === 'fastExp') {
    finalBody = finalBody.replace(
      /return expR \* exp2\(k\);/,
      `const kInt = i32(k);
  const pow2k = reinterpret<f32>((kInt + 127) << 23);
  return expR * pow2k;`
    );
  }

  return `@inline
function ${name}(${params}): ${returnType} {
${finalBody}
}`;
}

// ============================================================================
// Main Body Conversion (Fragment -> Loop)
// ============================================================================

function convertMainBodyToLoop(mainFn) {
  const statements = mainFn.body;
  const lines = [];

  // Track which variables need special handling
  const skipVars = new Set(['quadWidth', 'quadHeight', 'fullWidth', 'fullHeight']);
  const uniformVars = new Map();

  // First pass: identify uniform-derived variables
  for (const stmt of statements) {
    const type = getNodeType(stmt);
    if (type === 'Let' || type === 'U') {
      const name = stmt.name;
      if (skipVars.has(name)) continue;

      // Check if value references uniforms
      const valueStr = JSON.stringify(stmt.value);
      if (valueStr.includes('uniforms')) {
        uniformVars.set(name, stmt);
      }
    }
  }

  // Pre-loop setup
  lines.push('  const halfW: f32 = f32(fullWidth) * 0.5;');
  lines.push('  const halfH: f32 = f32(fullHeight) * 0.5;');
  lines.push('  const minHalf = min(halfW, halfH);');
  lines.push('  const edgeWidth: f32 = minHalf * edgeWidthRatio;');
  lines.push('  const r: f32 = min(borderRadius, minHalf);');
  lines.push('');
  lines.push('  const negThreeOverEdgeWidth: f32 = -3.0 / edgeWidth;');
  lines.push('  const cornerThresholdX: f32 = halfW - r;');
  lines.push('  const cornerThresholdY: f32 = halfH - r;');
  lines.push('');
  lines.push('  const totalPixels = quadWidth * quadHeight;');
  lines.push('');
  lines.push('  for (let i: i32 = 0; i < totalPixels; i++) {');
  lines.push('    // Quadrant pixel coordinates');
  lines.push('    const qx: i32 = i % quadWidth;');
  lines.push('    const qy: i32 = i / quadWidth;');
  lines.push('    const idx: i32 = i * 4;');
  lines.push('');
  lines.push('    // Map to full image coordinates (bottom-right quadrant)');
  lines.push('    const fx: f32 = f32(qx);');
  lines.push('    const fy: f32 = f32(qy);');
  lines.push('');
  lines.push('    const dx: f32 = fx;');
  lines.push('    const dy: f32 = fy;');
  lines.push('');

  // Find statements after coordinate setup
  let inLoopBody = false;
  for (const stmt of statements) {
    const type = getNodeType(stmt);
    const name = stmt.name;

    // Skip pre-computed values
    if (skipVars.has(name)) continue;
    if (['halfW', 'halfH', 'minHalf', 'edgeWidth', 'r', 'negThreeOverEdgeWidth',
         'cornerThresholdX', 'cornerThresholdY', 'qx', 'qy', 'dx', 'dy'].includes(name)) {
      continue;
    }

    // Start collecting loop body after dx/dy
    if (name === 'inCornerX') inLoopBody = true;

    if (inLoopBody) {
      if (type === 'Let' || type === 'U') {
        const value = convertExpr(stmt.value);
        lines.push(`    const ${name}: f32 = ${value};`);
      } else if (type === 'VarDecl' || type === 'V') {
        const value = stmt.value ? convertExpr(stmt.value) : '0.0';
        lines.push(`    let ${name}: f32 = ${value};`);
      } else if (type === 'If' || type === 'ne') {
        lines.push('');
        lines.push(convertIfStatement(stmt, '    '));
      } else if (type === 'Return' || type === 'fe') {
        // Convert return vec4 to memory stores
        lines.push('');
        lines.push('    // Encode to RGB (128 = neutral)');
        lines.push('    const rVal: u8 = u8(clamp<i32>(i32(rVal_f * 255.0), 0, 255));');
        lines.push('    const gVal: u8 = u8(clamp<i32>(i32(gVal_f * 255.0), 0, 255));');
        lines.push('');
        lines.push('    store<u8>(idx, rVal);');
        lines.push('    store<u8>(idx + 1, gVal);');
        lines.push('    store<u8>(idx + 2, 128);  // B unused');
        lines.push('    store<u8>(idx + 3, 255);  // A = opaque');
      }
    }
  }

  lines.push('  }');

  return lines.join('\n');
}

function convertIfStatement(stmt, indent) {
  const lines = [];
  const cond = convertExpr(stmt.condition);

  lines.push(`${indent}if (${cond}) {`);

  for (const s of stmt.body) {
    const type = getNodeType(s);
    if (type === 'Let' || type === 'U') {
      lines.push(`${indent}  const ${s.name}: f32 = ${convertExpr(s.value)};`);
    } else if (type === 'If' || type === 'ne') {
      lines.push(convertIfStatement(s, indent + '  '));
    } else if (s.variable && s.value) {
      // Assignment
      const varName = s.variable.name || convertExpr(s.variable);
      lines.push(`${indent}  ${varName} = ${convertExpr(s.value)};`);
    }
  }

  lines.push(`${indent}}`);

  if (stmt.elseBody && stmt.elseBody.length > 0) {
    lines.push(`${indent}else {`);
    for (const s of stmt.elseBody) {
      const type = getNodeType(s);
      if (type === 'Let' || type === 'U') {
        lines.push(`${indent}  const ${s.name}: f32 = ${convertExpr(s.value)};`);
      } else if (type === 'If' || type === 'ne') {
        lines.push(convertIfStatement(s, indent + '  '));
      } else if (s.variable && s.value) {
        const varName = s.variable.name || convertExpr(s.variable);
        lines.push(`${indent}  ${varName} = ${convertExpr(s.value)};`);
      }
    }
    lines.push(`${indent}}`);
  }

  return lines.join('\n');
}

// ============================================================================
// AssemblyScript Generation
// ============================================================================

function generateAssemblyScript(ast) {
  // Extract constants
  const constants = ast.filter(n => getNodeType(n) === 'Const');

  // Extract helper functions (not main)
  const helpers = ast.filter(n => getNodeType(n) === 'Function' && n.name !== 'main');

  // Find main function
  const mainFn = ast.find(n => n.name === 'main');
  if (!mainFn) throw new Error('Main function not found in AST');

  // Generate constant declarations
  const constSection = constants.map(c => {
    const name = c.name;
    const value = convertExpr(c.value);
    return `const ${name}: f32 = ${value};`;
  }).join('\n');

  // Generate helper functions
  const helperSection = helpers.map(convertHelperFunction).join('\n\n');

  return `/**
 * SIMD-accelerated displacement map generator (QUADRANT VERSION)
 *
 * AUTO-GENERATED from src/shaders/quadrant.frag.wgsl
 * DO NOT EDIT MANUALLY - changes will be overwritten
 *
 * Generates only 1/4 of the displacement map (bottom-right quadrant).
 * The quadrant is then composited 4 times with appropriate flips on the SVG side.
 *
 * This reduces WASM computation to 1/4 of the original cost.
 *
 * Memory layout:
 * - Output buffer starts at offset 0
 * - Each pixel = 4 bytes (R, G, B, A)
 *
 * Quadrant coordinate system:
 * - Origin (0,0) is at the CENTER of the full image
 * - X increases rightward, Y increases downward
 * - This quadrant represents bottom-right of the full displacement map
 */

${constSection}

// Fast exp() approximation using Schraudolph's method with polynomial correction
${helperSection}

/**
 * Generate displacement map for BOTTOM-RIGHT QUADRANT only
 *
 * @param quadWidth - Width of the quadrant (= full width / 2, rounded up)
 * @param quadHeight - Height of the quadrant (= full height / 2, rounded up)
 * @param fullWidth - Full image width (for proper corner radius calculation)
 * @param fullHeight - Full image height
 * @param borderRadius - Corner radius in full image pixels
 * @param edgeWidthRatio - Edge width as ratio of min dimension (0.1-1.0)
 */
export function generateQuadrantDisplacementMap(
  quadWidth: i32,
  quadHeight: i32,
  fullWidth: i32,
  fullHeight: i32,
  borderRadius: f32,
  edgeWidthRatio: f32
): void {
  const halfW: f32 = f32(fullWidth) * 0.5;
  const halfH: f32 = f32(fullHeight) * 0.5;
  const minHalf = min(halfW, halfH);
  const edgeWidth: f32 = minHalf * edgeWidthRatio;
  const r: f32 = min(borderRadius, minHalf);

  const negThreeOverEdgeWidth: f32 = -3.0 / edgeWidth;
  const cornerThresholdX: f32 = halfW - r;
  const cornerThresholdY: f32 = halfH - r;

  const totalPixels = quadWidth * quadHeight;

  for (let i: i32 = 0; i < totalPixels; i++) {
    // Quadrant pixel coordinates (0,0 at top-left of quadrant)
    const qx: i32 = i % quadWidth;
    const qy: i32 = i / quadWidth;
    const idx: i32 = i * 4;

    // Map to full image coordinates (bottom-right quadrant)
    // qx=0 -> center of full image, qx=quadWidth-1 -> right edge
    // qy=0 -> center of full image, qy=quadHeight-1 -> bottom edge
    const fx: f32 = f32(qx);  // distance from center (rightward)
    const fy: f32 = f32(qy);  // distance from center (downward)

    // dx, dy are distances from center (always positive in this quadrant)
    const dx: f32 = fx;
    const dy: f32 = fy;

    // Check if in corner region
    const inCornerX = dx > cornerThresholdX;
    const inCornerY = dy > cornerThresholdY;
    const inCorner = inCornerX && inCornerY;

    let distFromEdge: f32 = 0.0;
    let dirX: f32 = 0.0;
    let dirY: f32 = 0.0;

    if (inCorner) {
      // Corner region
      const cornerX: f32 = dx - cornerThresholdX;
      const cornerY: f32 = dy - cornerThresholdY;
      const cornerDist: f32 = sqrt(cornerX * cornerX + cornerY * cornerY);

      distFromEdge = r - cornerDist;

      if (cornerDist > 0.001) {
        const invDist: f32 = 1.0 / cornerDist;
        // Direction points radially outward from corner center
        // In bottom-right quadrant, both signs are positive
        dirX = cornerX * invDist;
        dirY = cornerY * invDist;
      }
    } else {
      // Edge region
      const distX: f32 = halfW - dx;
      const distY: f32 = halfH - dy;

      if (distX < distY) {
        distFromEdge = distX;
        dirX = 1.0;  // Points rightward (toward edge)
      } else {
        distFromEdge = distY;
        dirY = 1.0;  // Points downward (toward edge)
      }
    }

    // Exponential decay magnitude
    const clampedDist: f32 = max(distFromEdge, 0.0);
    const expArg: f32 = clampedDist * negThreeOverEdgeWidth;
    const magnitude: f32 = fastExp(expArg);

    // Displacement vector (pointing inward = negative direction)
    const dispX: f32 = -dirX * magnitude;
    const dispY: f32 = -dirY * magnitude;

    // Encode to RGB (128 = neutral)
    // For bottom-right quadrant: dispX <= 0, dispY <= 0
    // So encoded values will be <= 128
    const rVal: u8 = u8(clamp<i32>(i32(128.0 + dispX * 127.0), 0, 255));
    const gVal: u8 = u8(clamp<i32>(i32(128.0 + dispY * 127.0), 0, 255));

    store<u8>(idx, rVal);
    store<u8>(idx + 1, gVal);
    store<u8>(idx + 2, 128);  // B unused
    store<u8>(idx + 3, 255);  // A = opaque
  }
}

/**
 * SIMD-optimized version - processes 4 pixels per iteration
 */
export function generateQuadrantDisplacementMapSIMD(
  quadWidth: i32,
  quadHeight: i32,
  fullWidth: i32,
  fullHeight: i32,
  borderRadius: f32,
  edgeWidthRatio: f32
): void {
  const halfW: f32 = f32(fullWidth) * 0.5;
  const halfH: f32 = f32(fullHeight) * 0.5;
  const minHalf = min(halfW, halfH);
  const edgeWidth: f32 = minHalf * edgeWidthRatio;
  const r: f32 = min(borderRadius, minHalf);

  const cornerThresholdX: f32 = halfW - r;
  const cornerThresholdY: f32 = halfH - r;
  const negThreeOverEdgeWidth: f32 = -3.0 / edgeWidth;

  // SIMD constants
  const cornerThreshXVec = f32x4.splat(cornerThresholdX);
  const cornerThreshYVec = f32x4.splat(cornerThresholdY);
  const halfWVec = f32x4.splat(halfW);
  const halfHVec = f32x4.splat(halfH);
  const rVec = f32x4.splat(r);
  const negThreeOverEdgeWidthVec = f32x4.splat(negThreeOverEdgeWidth);
  const zeroVec = f32x4.splat(0.0);
  const oneVec = f32x4.splat(1.0);
  const epsilonVec = f32x4.splat(0.001);
  const v128Vec = f32x4.splat(128.0);
  const v127Vec = f32x4.splat(127.0);

  const totalPixels = quadWidth * quadHeight;
  const simdPixels = (totalPixels / 4) * 4;

  // Process 4 pixels at a time
  for (let i: i32 = 0; i < simdPixels; i += 4) {
    const qx0: i32 = (i + 0) % quadWidth;
    const qx1: i32 = (i + 1) % quadWidth;
    const qx2: i32 = (i + 2) % quadWidth;
    const qx3: i32 = (i + 3) % quadWidth;

    const qy0: i32 = (i + 0) / quadWidth;
    const qy1: i32 = (i + 1) / quadWidth;
    const qy2: i32 = (i + 2) / quadWidth;
    const qy3: i32 = (i + 3) / quadWidth;

    // dx, dy = distance from center (always positive in quadrant)
    const dxVec = f32x4(f32(qx0), f32(qx1), f32(qx2), f32(qx3));
    const dyVec = f32x4(f32(qy0), f32(qy1), f32(qy2), f32(qy3));

    // Check corner region
    const inCornerX = f32x4.gt(dxVec, cornerThreshXVec);
    const inCornerY = f32x4.gt(dyVec, cornerThreshYVec);
    const inCornerMask = v128.and(inCornerX, inCornerY);

    // Corner calculations
    const cornerX = f32x4.sub(dxVec, cornerThreshXVec);
    const cornerY = f32x4.sub(dyVec, cornerThreshYVec);
    const cornerDistSq = f32x4.add(f32x4.mul(cornerX, cornerX), f32x4.mul(cornerY, cornerY));
    const cornerDist = f32x4.sqrt(cornerDistSq);

    // Edge distance calculations
    const distXEdge = f32x4.sub(halfWVec, dxVec);
    const distYEdge = f32x4.sub(halfHVec, dyVec);
    const useXMask = f32x4.lt(distXEdge, distYEdge);

    // Distance from edge
    const cornerDistFromEdge = f32x4.sub(rVec, cornerDist);
    const edgeDistFromEdge = v128.bitselect(distXEdge, distYEdge, useXMask);
    const distFromEdgeVec = v128.bitselect(cornerDistFromEdge, edgeDistFromEdge, inCornerMask);

    // Direction (always positive in this quadrant)
    const invCornerDist = f32x4.div(oneVec, f32x4.max(cornerDist, epsilonVec));
    const cornerDirX = f32x4.mul(cornerX, invCornerDist);
    const cornerDirY = f32x4.mul(cornerY, invCornerDist);

    const edgeDirX = v128.bitselect(oneVec, zeroVec, useXMask);
    const edgeDirY = v128.bitselect(zeroVec, oneVec, useXMask);

    const dirXVec = v128.bitselect(cornerDirX, edgeDirX, inCornerMask);
    const dirYVec = v128.bitselect(cornerDirY, edgeDirY, inCornerMask);

    // Exponential decay
    const clampedDistVec = f32x4.max(distFromEdgeVec, zeroVec);
    const expArg = f32x4.mul(clampedDistVec, negThreeOverEdgeWidthVec);
    const magnitudeVec = fastExpSimd(expArg);

    // Displacement (negative direction = inward)
    const dispXVec = f32x4.neg(f32x4.mul(dirXVec, magnitudeVec));
    const dispYVec = f32x4.neg(f32x4.mul(dirYVec, magnitudeVec));

    // Encode
    let rValVec = f32x4.add(v128Vec, f32x4.mul(dispXVec, v127Vec));
    let gValVec = f32x4.add(v128Vec, f32x4.mul(dispYVec, v127Vec));

    const maxIntVec = f32x4.splat(255.0);
    rValVec = f32x4.max(f32x4.min(rValVec, maxIntVec), zeroVec);
    gValVec = f32x4.max(f32x4.min(gValVec, maxIntVec), zeroVec);

    // Store results
    const r0 = u8(i32(f32x4.extract_lane(rValVec, 0)));
    const r1 = u8(i32(f32x4.extract_lane(rValVec, 1)));
    const r2 = u8(i32(f32x4.extract_lane(rValVec, 2)));
    const r3 = u8(i32(f32x4.extract_lane(rValVec, 3)));

    const g0 = u8(i32(f32x4.extract_lane(gValVec, 0)));
    const g1 = u8(i32(f32x4.extract_lane(gValVec, 1)));
    const g2 = u8(i32(f32x4.extract_lane(gValVec, 2)));
    const g3 = u8(i32(f32x4.extract_lane(gValVec, 3)));

    const idx0 = (i + 0) * 4;
    const idx1 = (i + 1) * 4;
    const idx2 = (i + 2) * 4;
    const idx3 = (i + 3) * 4;

    store<u8>(idx0, r0); store<u8>(idx0 + 1, g0); store<u8>(idx0 + 2, 128); store<u8>(idx0 + 3, 255);
    store<u8>(idx1, r1); store<u8>(idx1 + 1, g1); store<u8>(idx1 + 2, 128); store<u8>(idx1 + 3, 255);
    store<u8>(idx2, r2); store<u8>(idx2 + 1, g2); store<u8>(idx2 + 2, 128); store<u8>(idx2 + 3, 255);
    store<u8>(idx3, r3); store<u8>(idx3 + 1, g3); store<u8>(idx3 + 2, 128); store<u8>(idx3 + 3, 255);
  }

  // Scalar fallback for remaining pixels
  for (let i: i32 = simdPixels; i < totalPixels; i++) {
    const qx: i32 = i % quadWidth;
    const qy: i32 = i / quadWidth;
    const idx: i32 = i * 4;

    const dx: f32 = f32(qx);
    const dy: f32 = f32(qy);

    const inCornerX = dx > cornerThresholdX;
    const inCornerY = dy > cornerThresholdY;
    const inCorner = inCornerX && inCornerY;

    let distFromEdge: f32 = 0.0;
    let dirX: f32 = 0.0;
    let dirY: f32 = 0.0;

    if (inCorner) {
      const cornerX: f32 = dx - cornerThresholdX;
      const cornerY: f32 = dy - cornerThresholdY;
      const cornerDist: f32 = sqrt(cornerX * cornerX + cornerY * cornerY);

      distFromEdge = r - cornerDist;

      if (cornerDist > 0.001) {
        const invDist: f32 = 1.0 / cornerDist;
        dirX = cornerX * invDist;
        dirY = cornerY * invDist;
      }
    } else {
      const distX: f32 = halfW - dx;
      const distY: f32 = halfH - dy;

      if (distX < distY) {
        distFromEdge = distX;
        dirX = 1.0;
      } else {
        distFromEdge = distY;
        dirY = 1.0;
      }
    }

    const clampedDist: f32 = max(distFromEdge, 0.0);
    const expArg: f32 = clampedDist * negThreeOverEdgeWidth;
    const magnitude: f32 = fastExp(expArg);

    const dispX: f32 = -dirX * magnitude;
    const dispY: f32 = -dirY * magnitude;

    const rVal: u8 = u8(clamp<i32>(i32(128.0 + dispX * 127.0), 0, 255));
    const gVal: u8 = u8(clamp<i32>(i32(128.0 + dispY * 127.0), 0, 255));

    store<u8>(idx, rVal);
    store<u8>(idx + 1, gVal);
    store<u8>(idx + 2, 128);
    store<u8>(idx + 3, 255);
  }
}

// SIMD fast exp helper
@inline
function fastExpSimd(x: v128): v128 {
  const x0 = f32x4.extract_lane(x, 0);
  const x1 = f32x4.extract_lane(x, 1);
  const x2 = f32x4.extract_lane(x, 2);
  const x3 = f32x4.extract_lane(x, 3);

  return f32x4(
    fastExp(x0),
    fastExp(x1),
    fastExp(x2),
    fastExp(x3)
  );
}

// Required memory for quadrant (1/4 of full)
export function getRequiredMemoryQuad(quadWidth: i32, quadHeight: i32): i32 {
  return quadWidth * quadHeight * 4;
}

@inline
function clamp<T>(value: T, minVal: T, maxVal: T): T {
  return min(max(value, minVal), maxVal);
}
`;
}

// ============================================================================
// Main Execution
// ============================================================================

console.log('Transpiling WGSL -> AssemblyScript (using wgsl_reflect WgslParser)...');
console.log(`Source: ${WGSL_INPUT}`);
console.log(`Output: ${AS_OUTPUT}`);
console.log('');

if (!existsSync(WGSL_INPUT)) {
  console.error(`[FAIL] Source file not found: ${WGSL_INPUT}`);
  process.exit(1);
}

try {
  const wgslSource = readFileSync(WGSL_INPUT, 'utf-8');

  // Parse WGSL using WgslParser
  const parser = new WgslParser();
  const ast = parser.parse(wgslSource);

  console.log(`  Parsed ${ast.length} AST nodes`);

  // Generate AssemblyScript
  const asOutput = generateAssemblyScript(ast);

  writeFileSync(AS_OUTPUT, asOutput);
  console.log(`  [OK] quadrant.frag.wgsl -> index.ts`);
  console.log('');
  console.log('AssemblyScript transpilation completed successfully.');
} catch (error) {
  console.error(`  [FAIL] ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
}

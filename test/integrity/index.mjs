#!/usr/bin/env node
/**
 * Integrity Test Suite Runner
 *
 * Orchestrates all integrity tests in the correct order:
 * 1. Type Validation - Verify TypeScript types compile correctly
 * 2. Build Test - Verify the build completes successfully
 * 3. SMT Coverage - Verify shader mathematical correctness via Z3
 * 4. E2E Tests - Browser-based end-to-end tests via CDP
 *
 * Usage:
 *   npm test              # Run all integrity tests
 *   npm test -- --only=types     # Run only type tests
 *   npm test -- --only=build     # Run only build tests
 *   npm test -- --only=smt       # Run only SMT tests
 *   npm test -- --only=e2e       # Run only E2E tests
 *   npm test -- --verbose        # Verbose output
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// ============================================================================
// Configuration
// ============================================================================

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose') || args.includes('-v');
const ONLY = args.find(a => a.startsWith('--only='))?.split('=')[1];

const config = {
  timeout: 120000,  // 2 minutes per test phase
  colors: {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
  }
};

const { colors: c } = config;

// ============================================================================
// Utilities
// ============================================================================

function log(message, color = '') {
  console.log(`${color}${message}${c.reset}`);
}

function logHeader(title) {
  const line = '═'.repeat(60);
  console.log('');
  log(`╔${line}╗`, c.cyan);
  log(`║  ${title.padEnd(58)}║`, c.cyan);
  log(`╚${line}╝`, c.cyan);
}

function logSection(title) {
  const line = '─'.repeat(58);
  console.log('');
  log(`┌${line}┐`, c.dim);
  log(`│ ${title.padEnd(57)}│`, c.bold);
  log(`└${line}┘`, c.dim);
}

function logResult(test, passed, duration = null) {
  const icon = passed ? `${c.green}✓` : `${c.red}✗`;
  const durationStr = duration ? ` ${c.dim}(${duration}ms)` : '';
  log(`  ${icon} ${test}${durationStr}`, c.reset);
}

/**
 * Execute a command and return result
 */
function exec(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: ROOT,
      stdio: VERBOSE ? 'inherit' : 'pipe',
      shell: process.platform === 'win32',
      ...options,
    });

    let stdout = '';
    let stderr = '';

    if (!VERBOSE && proc.stdout) {
      proc.stdout.on('data', data => { stdout += data; });
    }
    if (!VERBOSE && proc.stderr) {
      proc.stderr.on('data', data => { stderr += data; });
    }

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Command timed out after ${config.timeout}ms`));
    }, config.timeout);

    proc.on('close', code => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });

    proc.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Run a test module
 */
async function runTestModule(name, modulePath) {
  const start = Date.now();
  try {
    const module = await import(modulePath);
    const result = await module.default();
    const duration = Date.now() - start;
    return { name, ...result, duration };
  } catch (error) {
    const duration = Date.now() - start;
    return {
      name,
      passed: false,
      tests: [],
      errors: [error.message],
      duration,
    };
  }
}

// ============================================================================
// Test Phases
// ============================================================================

/**
 * Phase 1: Type Validation
 * Runs TypeScript compiler in check mode
 */
async function runTypeValidation() {
  logSection('Phase 1: Type Validation');

  const tests = [];
  let allPassed = true;

  // Test 1.1: TypeScript compilation
  const start = Date.now();
  const tscResult = await exec('npx', ['tsc', '--noEmit']);
  const tscDuration = Date.now() - start;

  if (tscResult.code === 0) {
    logResult('TypeScript compilation', true, tscDuration);
    tests.push({ name: 'tsc-compilation', passed: true, duration: tscDuration });
  } else {
    logResult('TypeScript compilation', false, tscDuration);
    tests.push({
      name: 'tsc-compilation',
      passed: false,
      duration: tscDuration,
      error: tscResult.stderr || tscResult.stdout,
    });
    allPassed = false;
    if (!VERBOSE) {
      console.log(`${c.dim}${tscResult.stderr || tscResult.stdout}${c.reset}`);
    }
  }

  // Test 1.2: Schema type consistency
  const schemaStart = Date.now();
  try {
    const schemaPath = join(ROOT, 'src/schema/parameters.ts');
    const schemaContent = readFileSync(schemaPath, 'utf-8');

    // Verify schema structure
    const hasParametersDef = schemaContent.includes('export const PARAMETERS');
    const hasParameterName = schemaContent.includes('export type ParameterName');
    const hasLiquidGlassParams = schemaContent.includes('export type LiquidGlassParams');
    const hasDefaultParams = schemaContent.includes('export const DEFAULT_PARAMS');

    const schemaDuration = Date.now() - schemaStart;
    const schemaValid = hasParametersDef && hasParameterName && hasLiquidGlassParams && hasDefaultParams;

    logResult('Schema type consistency', schemaValid, schemaDuration);
    tests.push({ name: 'schema-consistency', passed: schemaValid, duration: schemaDuration });

    if (!schemaValid) {
      allPassed = false;
      console.log(`${c.dim}  Missing exports: ${[
        !hasParametersDef && 'PARAMETERS',
        !hasParameterName && 'ParameterName',
        !hasLiquidGlassParams && 'LiquidGlassParams',
        !hasDefaultParams && 'DEFAULT_PARAMS',
      ].filter(Boolean).join(', ')}${c.reset}`);
    }
  } catch (error) {
    const schemaDuration = Date.now() - schemaStart;
    logResult('Schema type consistency', false, schemaDuration);
    tests.push({ name: 'schema-consistency', passed: false, error: error.message, duration: schemaDuration });
    allPassed = false;
  }

  // Test 1.3: Verify filter-manager types
  const fmStart = Date.now();
  try {
    const typesPath = join(ROOT, 'src/core/filter/filter-manager-types.ts');
    if (existsSync(typesPath)) {
      const typesContent = readFileSync(typesPath, 'utf-8');
      const hasFilterState = typesContent.includes('FilterState');
      const fmDuration = Date.now() - fmStart;

      logResult('FilterManager types', hasFilterState, fmDuration);
      tests.push({ name: 'filter-manager-types', passed: hasFilterState, duration: fmDuration });

      if (!hasFilterState) allPassed = false;
    } else {
      // Check alternative location
      const altPath = join(ROOT, 'src/core/filter/types.ts');
      if (existsSync(altPath)) {
        const fmDuration = Date.now() - fmStart;
        logResult('FilterManager types (types.ts)', true, fmDuration);
        tests.push({ name: 'filter-manager-types', passed: true, duration: fmDuration });
      } else {
        const fmDuration = Date.now() - fmStart;
        logResult('FilterManager types', false, fmDuration);
        tests.push({ name: 'filter-manager-types', passed: false, duration: fmDuration });
        allPassed = false;
      }
    }
  } catch (error) {
    const fmDuration = Date.now() - fmStart;
    logResult('FilterManager types', false, fmDuration);
    tests.push({ name: 'filter-manager-types', passed: false, error: error.message, duration: fmDuration });
    allPassed = false;
  }

  return { passed: allPassed, tests };
}

/**
 * Phase 2: Build Test
 * Runs the full build pipeline
 */
async function runBuildTest() {
  logSection('Phase 2: Build Test');

  const tests = [];
  let allPassed = true;

  // Test 2.1: Shader transpilation (WGSL -> GLSL)
  const glslStart = Date.now();
  const glslResult = await exec('npm', ['run', 'shaders:glsl']);
  const glslDuration = Date.now() - glslStart;

  if (glslResult.code === 0) {
    logResult('WGSL -> GLSL transpilation', true, glslDuration);
    tests.push({ name: 'shader-glsl', passed: true, duration: glslDuration });
  } else {
    logResult('WGSL -> GLSL transpilation', false, glslDuration);
    tests.push({ name: 'shader-glsl', passed: false, duration: glslDuration, error: glslResult.stderr });
    allPassed = false;
  }

  // Test 2.2: Shader transpilation (WGSL -> AssemblyScript)
  const asStart = Date.now();
  const asResult = await exec('npm', ['run', 'shaders:as']);
  const asDuration = Date.now() - asStart;

  if (asResult.code === 0) {
    logResult('WGSL -> AssemblyScript transpilation', true, asDuration);
    tests.push({ name: 'shader-as', passed: true, duration: asDuration });
  } else {
    logResult('WGSL -> AssemblyScript transpilation', false, asDuration);
    tests.push({ name: 'shader-as', passed: false, duration: asDuration, error: asResult.stderr });
    allPassed = false;
  }

  // Test 2.3: Generated files exist
  const genStart = Date.now();
  const generatedFiles = [
    'generated/gl2/fullscreen.vert',   // Shared vertex shader
    'generated/gl2/quadrant.frag',     // Pass 1: quadrant displacement
    'generated/gl2/composite.frag',    // Pass 2: quadrant compositing
    'generated/wasm-simd/index.ts',    // AssemblyScript WASM source
  ];

  const missingFiles = generatedFiles.filter(f => !existsSync(join(ROOT, f)));
  const genDuration = Date.now() - genStart;

  if (missingFiles.length === 0) {
    logResult('Generated shader files exist', true, genDuration);
    tests.push({ name: 'generated-files', passed: true, duration: genDuration });
  } else {
    logResult('Generated shader files exist', false, genDuration);
    tests.push({
      name: 'generated-files',
      passed: false,
      duration: genDuration,
      error: `Missing: ${missingFiles.join(', ')}`
    });
    allPassed = false;
  }

  // Test 2.4: TypeScript compilation
  const tscStart = Date.now();
  const tscResult = await exec('npx', ['tsc']);
  const tscDuration = Date.now() - tscStart;

  if (tscResult.code === 0) {
    logResult('TypeScript compilation', true, tscDuration);
    tests.push({ name: 'tsc-build', passed: true, duration: tscDuration });
  } else {
    logResult('TypeScript compilation', false, tscDuration);
    tests.push({ name: 'tsc-build', passed: false, duration: tscDuration, error: tscResult.stderr });
    allPassed = false;
  }

  // Test 2.5: Vite build
  const viteStart = Date.now();
  const viteResult = await exec('npx', ['vite', 'build']);
  const viteDuration = Date.now() - viteStart;

  if (viteResult.code === 0) {
    logResult('Vite bundle build', true, viteDuration);
    tests.push({ name: 'vite-build', passed: true, duration: viteDuration });
  } else {
    logResult('Vite bundle build', false, viteDuration);
    tests.push({ name: 'vite-build', passed: false, duration: viteDuration, error: viteResult.stderr });
    allPassed = false;
  }

  // Test 2.6: Output files exist
  const outStart = Date.now();
  const outputFiles = [
    'dist/liquidglass.js',
    'dist/liquidglass.d.ts',
  ];

  const missingOutputs = outputFiles.filter(f => !existsSync(join(ROOT, f)));
  const outDuration = Date.now() - outStart;

  if (missingOutputs.length === 0) {
    logResult('Output bundle files exist', true, outDuration);
    tests.push({ name: 'output-files', passed: true, duration: outDuration });
  } else {
    logResult('Output bundle files exist', false, outDuration);
    tests.push({
      name: 'output-files',
      passed: false,
      duration: outDuration,
      error: `Missing: ${missingOutputs.join(', ')}`
    });
    allPassed = false;
  }

  return { passed: allPassed, tests };
}

/**
 * Phase 3: SMT Coverage Test
 * Runs Z3-based mathematical verification
 */
async function runSMTCoverage() {
  logSection('Phase 3: SMT Mathematical Coverage');

  const tests = [];
  let allPassed = true;

  // Test 3.1: Transpiler coverage verification (WGSL->GLSL)
  const tcStart = Date.now();
  const tcResult = await exec('node', ['scripts/verify-transpiler-coverage.mjs']);
  const tcDuration = Date.now() - tcStart;

  if (tcResult.code === 0) {
    logResult('Transpiler coverage (WGSL->GLSL)', true, tcDuration);
    tests.push({ name: 'smt-transpiler-glsl', passed: true, duration: tcDuration });
  } else {
    logResult('Transpiler coverage (WGSL->GLSL)', false, tcDuration);
    tests.push({ name: 'smt-transpiler-glsl', passed: false, duration: tcDuration, error: tcResult.stderr });
    allPassed = false;
  }

  // Test 3.2: AssemblyScript transpiler SMT verification
  const asStart = Date.now();
  const asResult = await exec('node', ['scripts/verify-transpiler-smt.mjs']);
  const asDuration = Date.now() - asStart;

  if (asResult.code === 0) {
    logResult('Transpiler coverage (WGSL->AS)', true, asDuration);
    tests.push({ name: 'smt-transpiler-as', passed: true, duration: asDuration });
  } else {
    logResult('Transpiler coverage (WGSL->AS)', false, asDuration);
    tests.push({ name: 'smt-transpiler-as', passed: false, duration: asDuration, error: asResult.stderr });
    allPassed = false;
  }

  // Test 3.3: Shader equivalence verification
  const seStart = Date.now();
  const seResult = await exec('node', ['scripts/verify-shader-equivalence.mjs']);
  const seDuration = Date.now() - seStart;

  if (seResult.code === 0) {
    logResult('Shader output equivalence (WGSL≡GLSL)', true, seDuration);
    tests.push({ name: 'smt-shader-equiv', passed: true, duration: seDuration });
  } else {
    logResult('Shader output equivalence (WGSL≡GLSL)', false, seDuration);
    tests.push({ name: 'smt-shader-equiv', passed: false, duration: seDuration, error: seResult.stderr });
    allPassed = false;
  }

  // Test 3.4: Shader mathematical coverage
  const smcStart = Date.now();
  const smcResult = await exec('node', ['test/integrity/smt/shader-math-coverage.mjs']);
  const smcDuration = Date.now() - smcStart;

  if (smcResult.code === 0) {
    logResult('Shader mathematical invariants', true, smcDuration);
    tests.push({ name: 'smt-shader-math', passed: true, duration: smcDuration });
  } else {
    logResult('Shader mathematical invariants', false, smcDuration);
    tests.push({ name: 'smt-shader-math', passed: false, duration: smcDuration, error: smcResult.stderr });
    allPassed = false;
  }

  // Test 3.5: Parameter schema validation
  const psStart = Date.now();
  const psResult = await exec('node', ['test/integrity/smt/parameter-validation.mjs']);
  const psDuration = Date.now() - psStart;

  if (psResult.code === 0) {
    logResult('Parameter schema validation', true, psDuration);
    tests.push({ name: 'smt-params', passed: true, duration: psDuration });
  } else {
    logResult('Parameter schema validation', false, psDuration);
    tests.push({ name: 'smt-params', passed: false, duration: psDuration, error: psResult.stderr });
    allPassed = false;
  }

  return { passed: allPassed, tests };
}

/**
 * Phase 4: E2E Tests
 * Runs browser-based end-to-end tests via CDP
 */
async function runE2ETests() {
  logSection('Phase 4: E2E Browser Tests');

  const tests = [];
  let allPassed = true;

  const e2eStart = Date.now();
  const e2eResult = await exec('node', ['test/e2e/runner.mjs']);
  const e2eDuration = Date.now() - e2eStart;

  // Parse E2E results from output
  const output = e2eResult.stdout + e2eResult.stderr;

  // Extract pass/fail counts from output
  const passedMatch = output.match(/Passed:\s*(\d+)/);
  const failedMatch = output.match(/Failed:\s*(\d+)/);
  const skippedMatch = output.match(/Skipped:\s*(\d+)/);

  const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
  const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
  const skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;

  if (e2eResult.code === 0) {
    logResult(`E2E browser tests (${passed} passed, ${skipped} skipped)`, true, e2eDuration);
    tests.push({
      name: 'e2e-browser',
      passed: true,
      duration: e2eDuration,
      details: { passed, failed, skipped }
    });
  } else {
    logResult(`E2E browser tests (${passed} passed, ${failed} failed)`, false, e2eDuration);
    tests.push({
      name: 'e2e-browser',
      passed: false,
      duration: e2eDuration,
      error: `${failed} tests failed`,
      details: { passed, failed, skipped }
    });
    allPassed = false;

    // Show detailed output for failures
    if (!VERBOSE) {
      console.log(`${c.dim}${output}${c.reset}`);
    }
  }

  return { passed: allPassed, tests };
}

// ============================================================================
// Main Runner
// ============================================================================

async function main() {
  logHeader('LiquidGlass Integrity Test Suite');

  const startTime = Date.now();
  const results = {
    phases: [],
    totalTests: 0,
    totalPassed: 0,
    totalFailed: 0,
  };

  // Phase 1: Type Validation
  if (!ONLY || ONLY === 'types') {
    const typeResult = await runTypeValidation();
    results.phases.push({ name: 'Type Validation', ...typeResult });
    results.totalTests += typeResult.tests.length;
    results.totalPassed += typeResult.tests.filter(t => t.passed).length;
    results.totalFailed += typeResult.tests.filter(t => !t.passed).length;

    if (!typeResult.passed && !ONLY) {
      log('\n  Type validation failed. Stopping tests.', c.red);
      process.exit(1);
    }
  }

  // Phase 2: Build Test
  if (!ONLY || ONLY === 'build') {
    const buildResult = await runBuildTest();
    results.phases.push({ name: 'Build Test', ...buildResult });
    results.totalTests += buildResult.tests.length;
    results.totalPassed += buildResult.tests.filter(t => t.passed).length;
    results.totalFailed += buildResult.tests.filter(t => !t.passed).length;

    if (!buildResult.passed && !ONLY) {
      log('\n  Build test failed. Stopping tests.', c.red);
      process.exit(1);
    }
  }

  // Phase 3: SMT Coverage
  if (!ONLY || ONLY === 'smt') {
    const smtResult = await runSMTCoverage();
    results.phases.push({ name: 'SMT Coverage', ...smtResult });
    results.totalTests += smtResult.tests.length;
    results.totalPassed += smtResult.tests.filter(t => t.passed).length;
    results.totalFailed += smtResult.tests.filter(t => !t.passed).length;

    if (!smtResult.passed && !ONLY) {
      log('\n  SMT coverage failed. Stopping tests.', c.red);
      process.exit(1);
    }
  }

  // Phase 4: E2E Tests
  if (!ONLY || ONLY === 'e2e') {
    const e2eResult = await runE2ETests();
    results.phases.push({ name: 'E2E Tests', ...e2eResult });
    results.totalTests += e2eResult.tests.length;
    results.totalPassed += e2eResult.tests.filter(t => t.passed).length;
    results.totalFailed += e2eResult.tests.filter(t => !t.passed).length;
  }

  // Summary
  const totalDuration = Date.now() - startTime;

  console.log('');
  logHeader('Test Summary');

  for (const phase of results.phases) {
    const phaseTests = phase.tests.length;
    const phasePassed = phase.tests.filter(t => t.passed).length;
    const icon = phase.passed ? `${c.green}✓` : `${c.red}✗`;
    log(`  ${icon} ${phase.name}: ${phasePassed}/${phaseTests} tests passed`, c.reset);
  }

  console.log('');
  log(`  Total: ${results.totalPassed}/${results.totalTests} tests passed`, c.bold);
  log(`  Duration: ${totalDuration}ms`, c.dim);
  console.log('');

  if (results.totalFailed > 0) {
    log('╔══════════════════════════════════════════════════════════════╗', c.red);
    log('║  INTEGRITY TESTS FAILED                                      ║', c.red);
    log('╚══════════════════════════════════════════════════════════════╝', c.red);
    process.exit(1);
  } else {
    log('╔══════════════════════════════════════════════════════════════╗', c.green);
    log('║  ALL INTEGRITY TESTS PASSED                                  ║', c.green);
    log('╚══════════════════════════════════════════════════════════════╝', c.green);
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});

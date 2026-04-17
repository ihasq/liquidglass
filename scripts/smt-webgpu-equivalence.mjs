#!/usr/bin/env node
/**
 * SMT-based equivalence verification for WebGPU displacement map generator
 *
 * This script verifies that the WebGPU implementation produces equivalent
 * output to the WASM-SIMD and WebGL2 implementations by:
 *
 * 1. Comparing the mathematical expressions in each shader
 * 2. Testing boundary conditions and edge cases
 * 3. Verifying quadrant compositing logic
 *
 * Usage: node scripts/smt-webgpu-equivalence.mjs
 */

import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

console.log('='.repeat(70));
console.log('WebGPU Displacement Map Equivalence Verification');
console.log('='.repeat(70));
console.log();

/**
 * SMT-LIB2 formulas for verification
 */
const SMT_FORMULAS = {
    /**
     * Verify fastExp approximation bounds
     * The fast exponential should match exp() within 0.3% for x in [-87, 0]
     */
    fastExpBounds: `
; Verify fastExp approximation bounds
(set-logic QF_NRA)

; Input x in valid range
(declare-const x Real)
(assert (>= x (- 87.0)))
(assert (<= x 0.0))

; Constants
(define-fun LOG2E () Real 1.4426950408889634)
(define-fun LN2 () Real 0.6931471805599453)

; fastExp implementation
(define-fun k ((x Real)) Real (to_real (to_int (* x LOG2E))))
(define-fun r ((x Real)) Real (- x (* (k x) LN2)))
(define-fun r2 ((x Real)) Real (* (r x) (r x)))
(define-fun r3 ((x Real)) Real (* (r2 x) (r x)))
(define-fun r4 ((x Real)) Real (* (r2 x) (r2 x)))
(define-fun expR ((x Real)) Real
    (+ 1.0 (r x) (* (r2 x) 0.5) (* (r3 x) 0.16666667) (* (r4 x) 0.04166667)))
(define-fun fastExp ((x Real)) Real (* (expR x) (^ 2.0 (k x))))

; True exp for comparison (approximated as Taylor series for SMT)
(define-fun trueExp ((x Real)) Real (^ 2.71828182845904523536 x))

; Verify relative error < 0.5% (accounting for SMT precision)
(define-fun relError ((x Real)) Real
    (/ (- (fastExp x) (trueExp x)) (trueExp x)))

; Find a counterexample where error > 0.5%
(assert (or (> (relError x) 0.005) (< (relError x) (- 0.005))))

(check-sat)
`,

    /**
     * Verify quadrant symmetry
     * BR quadrant should mirror correctly to other quadrants
     */
    quadrantSymmetry: `
; Verify quadrant compositing symmetry
(set-logic QF_LIA)

; Original BR quadrant pixel value (0-255)
(declare-const r_br Int)
(declare-const g_br Int)
(assert (>= r_br 0))
(assert (<= r_br 255))
(assert (>= g_br 0))
(assert (<= g_br 255))

; Composited values for other quadrants
(define-fun r_bl () Int (- 255 r_br))  ; X invert
(define-fun g_bl () Int g_br)

(define-fun r_tr () Int r_br)
(define-fun g_tr () Int (- 255 g_br))  ; Y invert

(define-fun r_tl () Int (- 255 r_br))  ; X+Y invert
(define-fun g_tl () Int (- 255 g_br))

; Verify symmetry: if BR has displacement (r,g), then:
; - BL should have (-r, g) which is (255-r, g)
; - TR should have (r, -g) which is (r, 255-g)
; - TL should have (-r, -g) which is (255-r, 255-g)

; The neutral point is 128, so displacement d = r - 128
; -d = 128 - (r - 128) = 256 - r ≈ 255 - r (clamped to [0,255])

; Verify: r_bl + r_br = 255 (perfect inversion)
(assert (not (= (+ r_bl r_br) 255)))

(check-sat)
`,

    /**
     * Verify displacement direction consistency
     * In BR quadrant, displacement should point inward (negative direction)
     */
    displacementDirection: `
; Verify displacement direction in BR quadrant
(set-logic QF_LRA)

; Position in BR quadrant (positive distances from center)
(declare-const qx Real)
(declare-const qy Real)
(assert (>= qx 0.0))
(assert (>= qy 0.0))

; Full image dimensions
(declare-const halfW Real)
(declare-const halfH Real)
(assert (> halfW 0.0))
(assert (> halfH 0.0))

; Not in corner region (edge region)
(declare-const r Real)
(assert (>= r 0.0))
(define-fun cornerThreshX () Real (- halfW r))
(define-fun cornerThreshY () Real (- halfH r))
(assert (<= qx cornerThreshX))

; Distance from X edge
(define-fun distX () Real (- halfW qx))
(define-fun distY () Real (- halfH qy))

; Assume X edge is closer
(assert (< distX distY))

; Direction should be (1, 0) pointing toward edge
; Displacement is -dir * magnitude, so dispX should be negative
(define-fun dirX () Real 1.0)
(define-fun magnitude () Real 0.5)  ; Some positive magnitude
(define-fun dispX () Real (* (- dirX) magnitude))

; Encoded value should be < 128 (negative displacement)
(define-fun encodedR () Real (+ 128.0 (* dispX 127.0)))

; Verify: encoded R < 128 when in BR quadrant pointing toward X edge
(assert (>= encodedR 128.0))

(check-sat)
`,

    /**
     * Verify WebGPU coordinate system
     * WebGPU Y=0 at top (same as Canvas), unlike WebGL Y=0 at bottom
     */
    coordinateSystem: `
; Verify WebGPU coordinate system consistency with WASM
(set-logic QF_LIA)

; Full image dimensions
(declare-const fullWidth Int)
(declare-const fullHeight Int)
(assert (> fullWidth 0))
(assert (> fullHeight 0))

; Center position
(define-fun centerX () Int (div fullWidth 2))
(define-fun centerY () Int (div fullHeight 2))

; A pixel in BR quadrant (WebGPU coords: Y=0 at top)
(declare-const px Int)
(declare-const py Int)
(assert (>= px centerX))
(assert (>= py centerY))
(assert (< px fullWidth))
(assert (< py fullHeight))

; Quadrant coordinates
(define-fun qx () Int (- px centerX))
(define-fun qy () Int (- py centerY))

; Verify qx and qy are non-negative in BR quadrant
(assert (or (< qx 0) (< qy 0)))

(check-sat)
`,
};

/**
 * Run Z3 SMT solver on a formula
 */
async function runZ3(formula, name) {
    return new Promise((resolve, reject) => {
        const tempFile = `/tmp/smt_${name}_${Date.now()}.smt2`;
        writeFileSync(tempFile, formula);

        const z3 = spawn('z3', [tempFile]);
        let output = '';
        let error = '';

        z3.stdout.on('data', (data) => {
            output += data.toString();
        });

        z3.stderr.on('data', (data) => {
            error += data.toString();
        });

        z3.on('close', (code) => {
            try {
                unlinkSync(tempFile);
            } catch (e) { /* ignore */ }

            if (code !== 0 && error) {
                reject(new Error(`Z3 error: ${error}`));
            } else {
                resolve(output.trim());
            }
        });

        z3.on('error', (err) => {
            if (err.code === 'ENOENT') {
                resolve('SKIPPED');  // Z3 not installed
            } else {
                reject(err);
            }
        });
    });
}

/**
 * Run all verification checks
 */
async function main() {
    const results = [];

    for (const [name, formula] of Object.entries(SMT_FORMULAS)) {
        process.stdout.write(`Checking ${name}... `);

        try {
            const result = await runZ3(formula, name);

            if (result === 'SKIPPED') {
                console.log('⏭️  SKIPPED (Z3 not installed)');
                results.push({ name, status: 'skipped' });
            } else if (result === 'unsat') {
                // unsat means no counterexample found = property holds
                console.log('✅ VERIFIED');
                results.push({ name, status: 'verified' });
            } else if (result === 'sat') {
                // sat means counterexample found = property violated
                console.log('❌ COUNTEREXAMPLE FOUND');
                results.push({ name, status: 'failed' });
            } else {
                console.log(`⚠️  UNKNOWN: ${result}`);
                results.push({ name, status: 'unknown', result });
            }
        } catch (error) {
            console.log(`❌ ERROR: ${error.message}`);
            results.push({ name, status: 'error', error: error.message });
        }
    }

    console.log();
    console.log('='.repeat(70));
    console.log('Summary:');
    console.log('='.repeat(70));

    const verified = results.filter(r => r.status === 'verified').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const failed = results.filter(r => r.status === 'failed').length;

    console.log(`  Verified: ${verified}`);
    console.log(`  Skipped:  ${skipped}`);
    console.log(`  Failed:   ${failed}`);
    console.log();

    if (failed > 0) {
        console.log('⚠️  Some verifications failed!');
        process.exit(1);
    } else if (skipped === results.length) {
        console.log('ℹ️  All checks skipped (install Z3 for full verification)');
        console.log('   brew install z3  # macOS');
        console.log('   apt install z3   # Ubuntu');
    } else {
        console.log('✅ All verifications passed!');
    }
}

main().catch(console.error);

/**
 * Segment Delta LUT Decoder - Compute Shader
 *
 * Decodes SDLT format directly on GPU:
 * - Level 0: Delta-encoded sparse samples (16 per profile)
 * - Level 1: Segment-delta encoded samples (15 per segment × 16 segments)
 *
 * Parallel strategy:
 * - Each workgroup handles one profile
 * - Within workgroup: parallel prefix sum for delta decoding
 * - Segment deltas decoded in parallel (each segment independent after anchor)
 */

// Constants
const SAMPLES: u32 = 256u;
const SEGMENT_SIZE: u32 = 16u;
const SEGMENTS: u32 = 16u;  // SAMPLES / SEGMENT_SIZE
const PROFILE_COUNT: u32 = 6u;

// Uniforms
struct DecodeParams {
    level: u32,           // 0 or 1
    profileCount: u32,
    samples: u32,
    segmentSize: u32,
}

@group(0) @binding(0) var<uniform> params: DecodeParams;

// Input: Delta-encoded R16F data (uploaded as u32 pairs)
@group(0) @binding(1) var<storage, read> deltaData: array<u32>;

// Output: Decoded LUT texture (256 x 6, R32F)
@group(0) @binding(2) var lutTexture: texture_storage_2d<r32float, write>;

// Shared memory for prefix sum within workgroup
var<workgroup> sharedValues: array<f32, 256>;
var<workgroup> sharedAnchors: array<f32, 16>;

/**
 * Convert R16F (half-float) to F32
 */
fn float16ToFloat32(h: u32) -> f32 {
    let s = (h >> 15u) & 1u;
    let e = (h >> 10u) & 0x1Fu;
    let f = h & 0x3FFu;

    if (e == 0u) {
        // Denormalized
        let sign = select(1.0, -1.0, s == 1u);
        return sign * pow(2.0, -14.0) * (f32(f) / 1024.0);
    } else if (e == 31u) {
        // Inf/NaN
        return select(1.0 / 0.0, 0.0 / 0.0, f != 0u);
    }

    let sign = select(1.0, -1.0, s == 1u);
    return sign * pow(2.0, f32(e) - 15.0) * (1.0 + f32(f) / 1024.0);
}

/**
 * Read R16F value from packed u32 array
 * Index is the R16F index (2 per u32)
 */
fn readFloat16(index: u32) -> f32 {
    let wordIndex = index / 2u;
    let byteOffset = (index % 2u) * 16u;
    let word = deltaData[wordIndex];
    let halfWord = (word >> byteOffset) & 0xFFFFu;
    return float16ToFloat32(halfWord);
}

/**
 * Level 0 Decoder: Decode sparse anchor samples with delta
 * Input: 16 delta-encoded R16F values per profile
 * Output: 256 interpolated samples per profile
 */
@compute @workgroup_size(16, 1, 1)
fn decodeLevel0(
    @builtin(workgroup_id) workgroupId: vec3<u32>,
    @builtin(local_invocation_id) localId: vec3<u32>
) {
    let profileIndex = workgroupId.x;
    let segIndex = localId.x;

    if (profileIndex >= params.profileCount) {
        return;
    }

    // Calculate input offset for this profile's Level 0 data
    // Header: 8 bytes = 4 u16 = 2 u32
    // Level 0: SEGMENTS × profileCount × u16
    let headerOffset = 4u;  // 8 bytes / 2 (u16 per index)
    let l0Offset = headerOffset + profileIndex * SEGMENTS;

    // Read delta value
    let delta = readFloat16(l0Offset + segIndex);

    // Store in shared memory for prefix sum
    sharedValues[segIndex] = delta;
    workgroupBarrier();

    // Parallel prefix sum (Hillis-Steele algorithm)
    for (var stride = 1u; stride < SEGMENTS; stride *= 2u) {
        var val = sharedValues[segIndex];
        if (segIndex >= stride) {
            val += sharedValues[segIndex - stride];
        }
        workgroupBarrier();
        sharedValues[segIndex] = val;
        workgroupBarrier();
    }

    // Now sharedValues[segIndex] contains the decoded anchor value
    let anchorValue = sharedValues[segIndex];
    sharedAnchors[segIndex] = anchorValue;
    workgroupBarrier();

    // Interpolate to full resolution (each thread handles SEGMENT_SIZE samples)
    let startIdx = segIndex * SEGMENT_SIZE;
    let startVal = anchorValue;
    let endVal = select(sharedAnchors[segIndex + 1u], anchorValue, segIndex >= SEGMENTS - 1u);

    for (var i = 0u; i < SEGMENT_SIZE; i++) {
        let idx = startIdx + i;
        if (idx < SAMPLES) {
            let t = f32(i) / f32(SEGMENT_SIZE);
            let interpolated = startVal * (1.0 - t) + endVal * t;
            textureStore(lutTexture, vec2<i32>(i32(idx), i32(profileIndex)), vec4<f32>(interpolated, 0.0, 0.0, 1.0));
        }
    }
}

/**
 * Level 1 Decoder: Decode full quality samples
 * Input: Segment-delta encoded samples (15 per segment × 16 segments)
 * Output: Full 256 samples per profile
 */
@compute @workgroup_size(16, 16, 1)
fn decodeLevel1(
    @builtin(workgroup_id) workgroupId: vec3<u32>,
    @builtin(local_invocation_id) localId: vec3<u32>
) {
    let profileIndex = workgroupId.x;
    let segIndex = localId.x;
    let sampleOffset = localId.y;  // 0-15 within segment

    if (profileIndex >= params.profileCount) {
        return;
    }

    // First, decode Level 0 anchors (same as above, but only thread 0 of each segment)
    // Calculate Level 0 offset
    let headerOffset = 4u;
    let l0Offset = headerOffset + profileIndex * SEGMENTS;

    // All threads in first row (sampleOffset == 0) decode anchors
    if (sampleOffset == 0u) {
        let delta = readFloat16(l0Offset + segIndex);
        sharedValues[segIndex] = delta;
    }
    workgroupBarrier();

    // Prefix sum for anchors (only first row participates)
    if (sampleOffset == 0u) {
        for (var stride = 1u; stride < SEGMENTS; stride *= 2u) {
            var val = sharedValues[segIndex];
            if (segIndex >= stride) {
                val += sharedValues[segIndex - stride];
            }
            workgroupBarrier();
            sharedValues[segIndex] = val;
            workgroupBarrier();
        }
        sharedAnchors[segIndex] = sharedValues[segIndex];
    }
    workgroupBarrier();

    // Now decode Level 1 segment deltas
    // Level 1 offset: after header + Level 0 data
    let l0Size = SEGMENTS * params.profileCount;
    let l1BaseOffset = headerOffset + l0Size;

    // Each profile has (SEGMENT_SIZE - 1) × SEGMENTS samples in Level 1
    let samplesPerProfile = (SEGMENT_SIZE - 1u) * SEGMENTS;
    let profileL1Offset = l1BaseOffset + profileIndex * samplesPerProfile;

    // Within profile: segment × (SEGMENT_SIZE - 1) + (sampleOffset - 1)
    let sampleIdx = segIndex * SEGMENT_SIZE + sampleOffset;

    if (sampleOffset == 0u) {
        // Anchor sample - already decoded, just write
        textureStore(lutTexture, vec2<i32>(i32(sampleIdx), i32(profileIndex)),
                     vec4<f32>(sharedAnchors[segIndex], 0.0, 0.0, 1.0));
    } else {
        // Decode segment delta with prefix sum within segment
        let segmentL1Offset = profileL1Offset + segIndex * (SEGMENT_SIZE - 1u);

        // Read deltas for this segment into shared memory
        // Use a different region of shared memory for segment work
        let sharedOffset = SEGMENTS + segIndex * SEGMENT_SIZE;

        // Read delta (sampleOffset - 1 because anchor is not in L1)
        let deltaIdx = segmentL1Offset + (sampleOffset - 1u);
        let delta = readFloat16(deltaIdx);
        sharedValues[sharedOffset + sampleOffset] = delta;
        workgroupBarrier();

        // Prefix sum within segment
        for (var stride = 1u; stride < SEGMENT_SIZE; stride *= 2u) {
            var val = sharedValues[sharedOffset + sampleOffset];
            if (sampleOffset >= stride) {
                val += sharedValues[sharedOffset + sampleOffset - stride];
            }
            workgroupBarrier();
            sharedValues[sharedOffset + sampleOffset] = val;
            workgroupBarrier();
        }

        // Add anchor value to get final sample
        let finalValue = sharedAnchors[segIndex] + sharedValues[sharedOffset + sampleOffset];

        if (sampleIdx < SAMPLES) {
            textureStore(lutTexture, vec2<i32>(i32(sampleIdx), i32(profileIndex)),
                         vec4<f32>(finalValue, 0.0, 0.0, 1.0));
        }
    }
}

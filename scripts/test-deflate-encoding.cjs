// Test deflate encoding by comparing with zlib
const zlib = require('zlib');

// Test data: "AAAA" (4 bytes of 'A')
// Expected: first 'A' as literal, then length-3 match at distance 1
const testData = Buffer.from('AAAA');

// Compress with zlib
const compressed = zlib.deflateRawSync(testData, { level: 1 });
console.log('Input:', testData.toString('hex'));
console.log('Compressed:', compressed.toString('hex'));
console.log('Compressed bits:');

for (let i = 0; i < compressed.length; i++) {
  const byte = compressed[i];
  console.log(`  Byte ${i}: ${byte.toString(2).padStart(8, '0')} (${byte})`);
}

// Manual decode
console.log('\nManual decode:');
let bitPos = 0;
let bytePos = 0;

function readBits(n) {
  let result = 0;
  for (let i = 0; i < n; i++) {
    const bit = (compressed[bytePos] >> (bitPos % 8)) & 1;
    result |= bit << i;
    bitPos++;
    if (bitPos % 8 === 0) bytePos++;
  }
  return result;
}

// Block header
const bfinal = readBits(1);
const btype = readBits(2);
console.log(`BFINAL: ${bfinal}, BTYPE: ${btype}`);

// Decode a few symbols using fixed Huffman
function decodeFixedLitLen() {
  // Read up to 9 bits and decode
  let code = 0;

  // Try 7 bits first (codes 256-279)
  code = readBits(7);
  const rev7 = reverseBits(code, 7);
  if (rev7 >= 0 && rev7 <= 23) {
    return 256 + rev7;
  }

  // Try 8 bits
  const bit8 = readBits(1);
  code = (code | (bit8 << 7));
  const rev8 = reverseBits(code, 8);

  // 8-bit codes: 0-143 (0x30-0xBF) or 280-287 (0xC0-0xC7)
  if (rev8 >= 0x30 && rev8 <= 0xBF) {
    return rev8 - 0x30;
  }
  if (rev8 >= 0xC0 && rev8 <= 0xC7) {
    return 280 + (rev8 - 0xC0);
  }

  // Try 9 bits (144-255)
  const bit9 = readBits(1);
  code = (code | (bit9 << 8));
  const rev9 = reverseBits(code, 9);
  if (rev9 >= 0x190 && rev9 <= 0x1FF) {
    return 144 + (rev9 - 0x190);
  }

  return -1; // Error
}

function reverseBits(v, n) {
  let r = 0;
  for (let i = 0; i < n; i++) {
    r |= ((v >> i) & 1) << (n - 1 - i);
  }
  return r;
}

// Try to decode first few symbols
console.log('Decoding symbols:');
bitPos = 3; // Skip header
bytePos = 0;

for (let i = 0; i < 5; i++) {
  const startBit = bitPos;
  // This is simplified - proper decoding is more complex
  // Let's just read and print the raw bits
  const bits = [];
  const tempBitPos = bitPos;
  const tempBytePos = bytePos;
  for (let j = 0; j < 9; j++) {
    const bp = tempBitPos + j;
    const by = Math.floor(bp / 8);
    const bit = (compressed[by] >> (bp % 8)) & 1;
    bits.push(bit);
  }
  console.log(`  Position ${startBit}: next 9 bits = ${bits.join('')}`);

  // Actually decode
  const savedBitPos = bitPos;
  const savedBytePos = bytePos;

  // Read 7 bits and check if it's a length code (256-279)
  let code7 = 0;
  for (let j = 0; j < 7; j++) {
    const bp = bitPos + j;
    const by = Math.floor(bp / 8);
    code7 |= ((compressed[by] >> (bp % 8)) & 1) << j;
  }
  const rev7 = reverseBits(code7, 7);

  if (rev7 >= 0 && rev7 <= 23) {
    // It's a length code 256-279
    console.log(`    -> 7-bit code, reversed = ${rev7}, symbol = ${256 + rev7}`);
    bitPos += 7;
    if (256 + rev7 === 256) {
      console.log('    END OF BLOCK');
      break;
    }
    continue;
  }

  // Read 8 bits
  let code8 = 0;
  for (let j = 0; j < 8; j++) {
    const bp = bitPos + j;
    const by = Math.floor(bp / 8);
    code8 |= ((compressed[by] >> (bp % 8)) & 1) << j;
  }
  const rev8 = reverseBits(code8, 8);

  if (rev8 >= 0x30 && rev8 <= 0xBF) {
    // Literal 0-143
    console.log(`    -> 8-bit code 0x${rev8.toString(16)}, literal = ${rev8 - 0x30} ('${String.fromCharCode(rev8 - 0x30)}')`);
    bitPos += 8;
    continue;
  }

  if (rev8 >= 0xC0 && rev8 <= 0xC7) {
    // Length code 280-287
    console.log(`    -> 8-bit code 0x${rev8.toString(16)}, length code = ${280 + (rev8 - 0xC0)}`);
    bitPos += 8;
    continue;
  }

  console.log(`    -> Unknown (code7=${code7}, rev7=${rev7}, code8=${code8}, rev8=0x${rev8.toString(16)})`);
  break;
}

// Verify by decompressing
const decompressed = zlib.inflateRawSync(compressed);
console.log('\nDecompressed:', decompressed.toString());

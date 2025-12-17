/**
 * Icon Generator Script for Slowverb Extension
 * 
 * Generates PNG icons for the extension.
 * Run: node scripts/generate-icons.cjs
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * CRC32 implementation for PNG chunks
 */
const crc32 = (buf) => {
  let crc = 0xFFFFFFFF;
  const table = [];
  
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

/**
 * Creates a PNG with a gradient purple circle (Slowverb icon)
 */
const createIconPNG = (size) => {
  const width = size;
  const height = size;
  
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);  // bit depth
  ihdrData.writeUInt8(6, 9);  // color type (RGBA)
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace
  
  const ihdrCrc = crc32(Buffer.concat([Buffer.from('IHDR'), ihdrData]));
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdrData.copy(ihdr, 8);
  ihdr.writeUInt32BE(ihdrCrc, 21);
  
  // Generate image data - purple circle with sound wave pattern
  const rawData = [];
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = (width / 2) - 2;
  
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter byte
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= radius) {
        // Inside circle - gradient purple
        const t = dist / radius;
        const r = Math.round(123 - t * 30); // 0x7b to darker
        const g = Math.round(104 - t * 30); // 0x68 to darker
        const b = Math.round(238 - t * 20); // 0xee to darker
        
        // Add wave pattern
        const wave = Math.sin((x + y) * 0.3) * 0.1 + 0.9;
        
        rawData.push(
          Math.min(255, Math.round(r * wave)),
          Math.min(255, Math.round(g * wave)),
          Math.min(255, Math.round(b * wave)),
          255 // alpha
        );
      } else {
        // Outside circle - transparent
        rawData.push(0, 0, 0, 0);
      }
    }
  }
  
  // Compress image data
  const compressed = zlib.deflateSync(Buffer.from(rawData), { level: 9 });
  
  const idatCrc = crc32(Buffer.concat([Buffer.from('IDAT'), compressed]));
  const idat = Buffer.alloc(12 + compressed.length);
  idat.writeUInt32BE(compressed.length, 0);
  idat.write('IDAT', 4);
  compressed.copy(idat, 8);
  idat.writeUInt32BE(idatCrc, 8 + compressed.length);
  
  // IEND chunk
  const iendCrc = crc32(Buffer.from('IEND'));
  const iend = Buffer.alloc(12);
  iend.writeUInt32BE(0, 0);
  iend.write('IEND', 4);
  iend.writeUInt32BE(iendCrc, 8);
  
  return Buffer.concat([signature, ihdr, idat, iend]);
};

// Generate icons
const sizes = [16, 48, 128];
const outputDir = path.join(__dirname, '..', 'assets', 'icons');

// Ensure directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

sizes.forEach(size => {
  const png = createIconPNG(size);
  const filename = path.join(outputDir, `icon${size}.png`);
  fs.writeFileSync(filename, png);
  console.log(`Generated: icon${size}.png (${png.length} bytes)`);
});

console.log('Icon generation complete!');

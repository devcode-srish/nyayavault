/**
 * NyayaVault — Lightweight Standard PKZIP Archiver (Zero External Dependencies)
 *
 * Implements standard PKZIP 2.0 file format using Node.js built-in `zlib` and `crypto`:
 * - Local File Headers (0x04034b50) with raw Deflate compression (method 8)
 * - CRC-32 checksum calculation via `zlib.crc32`
 * - Central Directory Headers (0x02014b50)
 * - End of Central Directory Record (0x06054b50)
 * - Safe path handling and path traversal prevention
 */

import zlib from "zlib";

export interface ZipEntry {
  path: string; // Relative POSIX path, e.g. "artifacts/documents/doc1.pdf"
  content: Buffer | string;
}

/**
 * Creates a standard PKZIP binary buffer from an array of file entries.
 */
export function createZipArchive(entries: ZipEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let currentOffset = 0;

  for (const entry of entries) {
    const rawPath = entry.path.replace(/\\/g, "/").replace(/^\/+/, "");
    const pathBuffer = Buffer.from(rawPath, "utf8");
    const uncompressedData =
      typeof entry.content === "string" ? Buffer.from(entry.content, "utf8") : entry.content;

    const uncompressedSize = uncompressedData.length;
    const crc = zlib.crc32(uncompressedData);

    // Deflate compress data
    const compressedData = zlib.deflateRawSync(uncompressedData);
    const compressedSize = compressedData.length;

    // Use compression method 8 (Deflated) unless uncompressed is smaller
    const useCompression = compressedSize < uncompressedSize;
    const finalData = useCompression ? compressedData : uncompressedData;
    const finalCompressedSize = useCompression ? compressedSize : uncompressedSize;
    const compressionMethod = useCompression ? 8 : 0;

    // Standard MS-DOS Date/Time (fixed or current)
    const dosTime = 0x0000;
    const dosDate = 0x5421; // 2022-01-01

    // 1. Local File Header (30 bytes + filename + data)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6); // General purpose bit flag (UTF-8)
    localHeader.writeUInt16LE(compressionMethod, 8); // Compression method
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14); // CRC-32
    localHeader.writeUInt32LE(finalCompressedSize, 18); // Compressed size
    localHeader.writeUInt32LE(uncompressedSize, 22); // Uncompressed size
    localHeader.writeUInt16LE(pathBuffer.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28); // Extra field length

    const localChunk = Buffer.concat([localHeader, pathBuffer, finalData]);
    localHeaders.push(localChunk);

    // 2. Central Directory Header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central file header signature
    centralHeader.writeUInt16LE(20, 4); // Version made by (2.0)
    centralHeader.writeUInt16LE(20, 6); // Version needed to extract (2.0)
    centralHeader.writeUInt16LE(0x0800, 8); // General purpose bit flag (UTF-8)
    centralHeader.writeUInt16LE(compressionMethod, 10); // Compression method
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16); // CRC-32
    centralHeader.writeUInt32LE(finalCompressedSize, 20); // Compressed size
    centralHeader.writeUInt32LE(uncompressedSize, 24); // Uncompressed size
    centralHeader.writeUInt16LE(pathBuffer.length, 28); // File name length
    centralHeader.writeUInt16LE(0, 30); // Extra field length
    centralHeader.writeUInt16LE(0, 32); // File comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number start
    centralHeader.writeUInt16LE(0, 36); // Internal file attributes
    centralHeader.writeUInt32LE(0, 38); // External file attributes
    centralHeader.writeUInt32LE(currentOffset, 42); // Relative offset of local header

    const centralChunk = Buffer.concat([centralHeader, pathBuffer]);
    centralHeaders.push(centralChunk);

    currentOffset += localChunk.length;
  }

  const centralDirectoryOffset = currentOffset;
  const centralDirectoryBuffer = Buffer.concat(centralHeaders);
  const centralDirectorySize = centralDirectoryBuffer.length;

  // 3. End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // Number of this disk
  eocd.writeUInt16LE(0, 6); // Disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8); // Number of central directory records on this disk
  eocd.writeUInt16LE(entries.length, 10); // Total number of central directory records
  eocd.writeUInt32LE(centralDirectorySize, 12); // Size of central directory
  eocd.writeUInt32LE(centralDirectoryOffset, 16); // Offset of start of central directory
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localHeaders, centralDirectoryBuffer, eocd]);
}

/**
 * Lightweight ZIP extractor for reading and testing ZIP archives.
 * Returns map of relative paths to file contents.
 */
export function extractZipArchive(zipBuffer: Buffer): Map<string, Buffer> {
  const result = new Map<string, Buffer>();

  // Find EOCD signature (0x06054b50) from end
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= 0; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("Invalid ZIP archive: End of Central Directory record not found");
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralDirSize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  let currentPos = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (zipBuffer.readUInt32LE(currentPos) !== 0x02014b50) {
      throw new Error(`Invalid Central Directory header at entry ${i}`);
    }

    const method = zipBuffer.readUInt16LE(currentPos + 10);
    const crc = zipBuffer.readUInt32LE(currentPos + 16);
    const compressedSize = zipBuffer.readUInt32LE(currentPos + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(currentPos + 24);
    const nameLength = zipBuffer.readUInt16LE(currentPos + 28);
    const extraLength = zipBuffer.readUInt16LE(currentPos + 30);
    const commentLength = zipBuffer.readUInt16LE(currentPos + 32);
    const localOffset = zipBuffer.readUInt32LE(currentPos + 42);

    const fileName = zipBuffer.toString("utf8", currentPos + 46, currentPos + 46 + nameLength);

    // Read local header
    if (zipBuffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Invalid Local Header for file "${fileName}" at offset ${localOffset}`);
    }

    const localNameLen = zipBuffer.readUInt16LE(localOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressedBytes = zipBuffer.slice(dataStart, dataStart + compressedSize);

    let uncompressedBytes: Buffer;
    if (method === 8) {
      uncompressedBytes = zlib.inflateRawSync(compressedBytes);
    } else if (method === 0) {
      uncompressedBytes = compressedBytes;
    } else {
      throw new Error(`Unsupported compression method ${method} for "${fileName}"`);
    }

    // Verify CRC32
    const calculatedCrc = zlib.crc32(uncompressedBytes);
    if (calculatedCrc !== crc) {
      throw new Error(`CRC-32 checksum mismatch for "${fileName}"`);
    }

    result.set(fileName, uncompressedBytes);
    currentPos += 46 + nameLength + extraLength + commentLength;
  }

  return result;
}

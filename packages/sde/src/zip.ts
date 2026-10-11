import { inflateRawSync } from 'node:zlib';

/**
 * Reads named entries from a zip archive held in memory. Enough for the SDE download:
 * stored or deflated entries, no zip64, no encryption.
 */
export function readZipEntries(zip: Buffer, names: readonly string[]): Map<string, Buffer> {
  const wanted = new Set(names);
  const found = new Map<string, Buffer>();

  // The end-of-central-directory record sits in the last 64 KiB (22 bytes + comment).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive');

  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = zip.readUInt16LE(at + 10);
    const compressedSize = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localHeader = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (!wanted.has(name)) continue;

    // The local header has its own name/extra lengths; the data follows them.
    const dataStart =
      localHeader + 30 + zip.readUInt16LE(localHeader + 26) + zip.readUInt16LE(localHeader + 28);
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) found.set(name, Buffer.from(data));
    else if (method === 8) found.set(name, inflateRawSync(data));
    else throw new Error(`unsupported zip compression method ${method} for ${name}`);
  }

  const missing = names.filter((name) => !found.has(name));
  if (missing.length > 0) throw new Error(`missing in archive: ${missing.join(', ')}`);
  return found;
}

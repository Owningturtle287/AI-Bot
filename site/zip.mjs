const decode = new TextDecoder();
const U32_MAX = 0xffffffff;
const MiB = 1024 * 1024;
const dataError = message => new Error(message);

async function view(blob, offset, size) {
  if (!Number.isSafeInteger(offset + size) || offset < 0 || size < 0 || offset + size > blob.size) {
    throw dataError('The ZIP contains an invalid file offset.');
  }
  return new DataView(await blob.slice(offset, offset + size).arrayBuffer());
}

function safe64(buffer, offset) {
  const value = Number(buffer.getBigUint64(offset, true));
  if (!Number.isSafeInteger(value)) throw dataError('A ZIP field exceeds the browser’s file range.');
  return value;
}

function zip64Extra(extra, entry) {
  const keys = ['length', 'compressed', 'offset'].filter(key => entry[key] === U32_MAX);
  if (!keys.length) return;
  for (let start = 0; start + 4 <= extra.byteLength;) {
    const kind = extra.getUint16(start, true);
    const size = extra.getUint16(start + 2, true);
    if (start + 4 + size > extra.byteLength) break;
    if (kind === 1 && size >= keys.length * 8) {
      keys.forEach((key, i) => { entry[key] = safe64(extra, start + 4 + i * 8); });
      return;
    }
    start += 4 + size;
  }
  throw dataError('A ZIP64 entry is missing its size or offset.');
}

export async function readZip(blob) {
  const start = Math.max(0, blob.size - 65557);
  const tail = await view(blob, start, blob.size - start);
  let end = tail.byteLength - 22;
  for (; end >= 0; end--) {
    if (tail.getUint32(end, true) === 0x06054b50 && end + 22 + tail.getUint16(end + 20, true) === tail.byteLength) break;
  }
  if (end < 0) throw dataError('This file is not a readable ZIP archive.');
  if (tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true)) throw dataError('Use a single ZIP file.');
  let count = tail.getUint16(end + 10, true);
  let size = tail.getUint32(end + 12, true);
  let offset = tail.getUint32(end + 16, true);
  if (count === 65535 || size === U32_MAX || offset === U32_MAX) {
    const locator = await view(blob, start + end - 20, 20);
    if (locator.getUint32(0, true) !== 0x07064b50 || locator.getUint32(16, true) !== 1) {
      throw dataError('This ZIP64 archive is incomplete or split.');
    }
    const record = await view(blob, safe64(locator, 8), 56);
    if (record.getUint32(0, true) !== 0x06064b50 || record.getUint32(16, true) || record.getUint32(20, true)) {
      throw dataError('This ZIP64 directory is invalid or split.');
    }
    count = safe64(record, 32);
    size = safe64(record, 40);
    offset = safe64(record, 48);
  }
  if (size > 32 * MiB || count > 50000) throw dataError('The ZIP has too many files. Split it into smaller archives.');
  const directory = await view(blob, offset, size);
  const entries = [];
  let expanded = 0;
  for (let index = 0, cursor = 0; index < count; index++) {
    if (cursor + 46 > size || directory.getUint32(cursor, true) !== 0x02014b50) throw dataError('The ZIP directory is damaged.');
    const nameSize = directory.getUint16(cursor + 28, true);
    const extraSize = directory.getUint16(cursor + 30, true);
    const next = cursor + 46 + nameSize + extraSize + directory.getUint16(cursor + 32, true);
    if (next > size) throw dataError('The ZIP directory is truncated.');
    const name = decode.decode(new Uint8Array(directory.buffer, cursor + 46, nameSize));
    if (/\.(jsonl|txt|md)$/i.test(name) && !name.split('/').some(part => part.startsWith('.') || part === '__MACOSX')) {
      if ((directory.getUint16(cursor + 8, true) & 1) || directory.getUint16(cursor + 34, true)) throw dataError('Use an unencrypted, single-part ZIP.');
      const entry = {
        name, method: directory.getUint16(cursor + 10, true), crc: directory.getUint32(cursor + 16, true),
        compressed: directory.getUint32(cursor + 20, true), length: directory.getUint32(cursor + 24, true),
        offset: directory.getUint32(cursor + 42, true), limit: offset
      };
      zip64Extra(new DataView(directory.buffer, cursor + 46 + nameSize, extraSize), entry);
      if (![0, 8].includes(entry.method)) throw dataError('Use stored or deflate ZIP compression.');
      expanded += entry.length;
      if (expanded > 24 * 1024 ** 3) throw dataError('The selected text expands beyond 24 GiB. Split the archive.');
      entries.push(entry);
    }
    cursor = next;
  }
  if (!entries.some(entry => entry.length)) throw dataError('Add a nonempty JSONL, TXT or Markdown file to the ZIP.');
  return { entries, expanded };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

export async function* lines(blob, entry, onBytes) {
  const header = await view(blob, entry.offset, 30);
  if (header.getUint32(0, true) !== 0x04034b50) throw dataError('A ZIP file header is damaged.');
  const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const end = start + entry.compressed;
  if (end > entry.limit) throw dataError('A ZIP file extends beyond the data section.');
  let stream = blob.slice(start, end).stream();
  if (entry.method === 8) {
    try {
      stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
    } catch {
      throw dataError('This browser needs a newer version to open compressed ZIPs.');
    }
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let length = 0;
  let crc = U32_MAX;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > entry.length) throw dataError('The ZIP expands beyond its declared size.');
      for (const byte of value) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
      pending += decoder.decode(value, { stream: true });
      const pieces = pending.split('\n');
      pending = pieces.pop();
      for (const line of pieces) {
        if (line.length > MiB) throw dataError('A data row is larger than 1 MiB. Split long records.');
        yield line.trimEnd();
      }
      if (pending.length > MiB) throw dataError('A data row is larger than 1 MiB. Split long records.');
      onBytes(length);
    }
    pending += decoder.decode();
    if (pending) yield pending.trimEnd();
    if (length !== entry.length || ((crc ^ U32_MAX) >>> 0) !== entry.crc) throw dataError('A ZIP file failed its size or checksum check.');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

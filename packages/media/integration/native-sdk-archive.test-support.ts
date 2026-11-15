import { createHash } from 'node:crypto';

/** Read a body once, refusing bytes outside the caller's remaining allowance. */
export const readArchiveBody = async (
  body: ReadableStream<Uint8Array>,
  limit: number,
  accept: (chunk: Uint8Array) => Promise<void>,
) => {
  const reader = body.getReader();
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) throw new Error('Archive body exceeds allowance');
      hash.update(next.value);
      await accept(next.value);
    }
    return { bytes, sha256: hash.digest('hex') };
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
};

/** Sum ZIP central-directory sizes without expanding or executing any member. */
export const inspectArchiveDirectory = (archive: Buffer) => {
  let end = archive.length - 22;
  const floor = Math.max(0, end - 65535);
  while (end >= floor) {
    if (
      archive.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + archive.readUInt16LE(end + 20) === archive.length
    )
      break;
    end--;
  }
  if (end < floor) throw new Error('Archive end record missing');
  const count = archive.readUInt16LE(end + 10);
  const size = archive.readUInt32LE(end + 12);
  const offset = archive.readUInt32LE(end + 16);
  if (
    archive.readUInt16LE(end + 4) !== 0 ||
    archive.readUInt16LE(end + 6) !== 0 ||
    archive.readUInt16LE(end + 8) !== count ||
    count === 65535 ||
    size === 0xffffffff ||
    offset === 0xffffffff ||
    offset + size !== end
  )
    throw new Error('Unsupported split or ZIP64 archive');
  let cursor = offset;
  let expandedBytes = 0;
  let compressedMemberBytes = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || archive.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error('Invalid archive directory member');
    const compressed = archive.readUInt32LE(cursor + 20);
    const expanded = archive.readUInt32LE(cursor + 24);
    const next =
      cursor +
      46 +
      archive.readUInt16LE(cursor + 28) +
      archive.readUInt16LE(cursor + 30) +
      archive.readUInt16LE(cursor + 32);
    if (compressed === 0xffffffff || expanded === 0xffffffff || next > end)
      throw new Error('Unsupported or truncated archive member');
    compressedMemberBytes += compressed;
    expandedBytes += expanded;
    cursor = next;
  }
  if (cursor !== end) throw new Error('Archive directory size mismatch');
  return {
    entries: count,
    expandedBytes,
    compressedMemberBytes,
    directoryBytes: size,
  };
};

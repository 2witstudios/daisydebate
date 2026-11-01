import {
  decodeNoteRecord,
  encodeNoteRecord,
  expireNoteRecord,
  removesOnlyNoteCopies,
  NOTE_RECORD_MAX_COUNT,
  NOTE_RECORD_MAX_TOTAL_BYTES,
  type NoteRecord,
} from './note-draft';

export type DraftStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>;
export type NoteSnapshot = {
  readonly record: NoteRecord;
  readonly raw: string | null;
};
export type NoteWrite = {
  readonly stored: boolean;
  readonly snapshot: NoteSnapshot;
};
const prefix = 'daisy:round-notes:draft:';
const keyOf = (principalId: string, roundId: string, id: string) =>
  `${prefix}${principalId}:${roundId}:${id}`;
export const noteDraftKeys = (storage: DraftStorage): readonly string[] => {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
};
const empty = (): NoteSnapshot => ({ record: {}, raw: null });
const hasCopies = (record: NoteRecord) =>
  record.active !== undefined || record.recovery !== undefined;

/** One principal's note-storage adapter. Each complete record write is atomic; no pre-delete eviction. */
export function createNoteStorage({
  storage,
  principalId,
  roundId,
  failed,
}: {
  readonly storage: DraftStorage | null;
  readonly principalId: string;
  readonly roundId: string;
  readonly failed: (id: string) => void;
}) {
  const read = (
    id: string,
    now: number,
    serverRevision = Number.MAX_SAFE_INTEGER,
  ): NoteSnapshot => {
    if (!storage) return empty();
    try {
      const key = keyOf(principalId, roundId, id);
      const raw = storage.getItem(key);
      if (raw === null) return empty();
      const decoded = decodeNoteRecord(raw, { now, serverRevision });
      if (!decoded.ok) {
        failed(id);
        try {
          storage.removeItem(key);
          return empty();
        } catch {
          return { record: {}, raw };
        }
      }
      const record = decoded.record;
      const encoded = encodeNoteRecord(record)!;
      if (!decoded.expired && hasCopies(record)) return { record, raw };
      // Only expired copies or empty records are pruned on reads. Original
      // per-copy timestamps and every unexpired copy remain unchanged.
      try {
        if (hasCopies(record)) storage.setItem(key, encoded.raw);
        else storage.removeItem(key);
        return { record, raw: hasCopies(record) ? encoded.raw : null };
      } catch {
        failed(id);
        return { record, raw };
      }
    } catch {
      failed(id);
      return empty();
    }
  };

  const write = (
    id: string,
    previous: NoteSnapshot,
    record: NoteRecord,
    now: number,
  ): NoteWrite => {
    record = expireNoteRecord(record, now);
    const encoded = encodeNoteRecord(record);
    if (encoded === null) {
      failed(id);
      return { stored: false, snapshot: previous };
    }
    if (!storage) {
      if (hasCopies(record)) {
        failed(id);
        return { stored: false, snapshot: previous };
      }
      return { stored: true, snapshot: empty() };
    }
    try {
      const key = keyOf(principalId, roundId, id);
      const currentRaw = storage.getItem(key);
      if (currentRaw !== previous.raw) {
        failed(id);
        return { stored: false, snapshot: read(id, now) };
      }
      if (!hasCopies(record)) {
        storage.removeItem(key);
        return { stored: true, snapshot: empty() };
      }
      let otherCount = 0,
        otherBytes = 0;
      for (const storedKey of noteDraftKeys(storage)) {
        if (storedKey === key) continue;
        const raw = storage.getItem(storedKey);
        if (raw === null) continue;
        const decoded = decodeNoteRecord(raw, {
          now,
          serverRevision: Number.MAX_SAFE_INTEGER,
        });
        if (!decoded.ok) {
          storage.removeItem(storedKey);
          continue;
        }
        const bounded = encodeNoteRecord(decoded.record)!;
        if (!hasCopies(decoded.record)) {
          storage.removeItem(storedKey);
          continue;
        }
        if (decoded.expired) storage.setItem(storedKey, bounded.raw);
        otherCount += 1;
        otherBytes += decoded.expired
          ? bounded.bytes
          : new TextEncoder().encode(raw).length;
      }
      const overfull =
        otherCount + 1 > NOTE_RECORD_MAX_COUNT ||
        otherBytes + encoded.bytes > NOTE_RECORD_MAX_TOTAL_BYTES;
      if (overfull) {
        // Decode the fresh durable value, never a caller-supplied record, for
        // this strict-removal decision. Shrinking cannot strand both choices
        // in an already overfull record, nor admit new or changed copies.
        const prior =
          currentRaw === null
            ? null
            : decodeNoteRecord(currentRaw, {
                now,
                serverRevision: Number.MAX_SAFE_INTEGER,
              });
        if (
          !prior?.ok ||
          !removesOnlyNoteCopies(
            prior.record,
            record,
            new TextEncoder().encode(currentRaw!).length,
            encoded.bytes,
          )
        ) {
          failed(id);
          return { stored: false, snapshot: previous };
        }
      }
      storage.setItem(key, encoded.raw);
      return { stored: true, snapshot: { record, raw: encoded.raw } };
    } catch {
      failed(id);
      return { stored: false, snapshot: previous };
    }
  };

  const purge = () => {
    if (!storage) return true;
    try {
      for (const key of noteDraftKeys(storage))
        if (key.startsWith(`${prefix}${principalId}:`)) storage.removeItem(key);
      return true;
    } catch {
      failed('');
      return false;
    }
  };
  return { read, write, purge };
}

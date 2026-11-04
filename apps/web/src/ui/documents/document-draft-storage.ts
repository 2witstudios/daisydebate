import {
  decodeDraftRecord,
  encodeDraftRecord,
  expireDraftRecord,
  DRAFT_RECORD_MAX_COUNT,
  DRAFT_RECORD_MAX_TOTAL_BYTES,
  type DraftRecord,
} from '../../features/documents/document-draft';
import type { DraftSnapshot } from '../../features/documents/document-saving';

export type DraftStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>;
export type DraftWrite = {
  readonly stored: boolean;
  readonly snapshot: DraftSnapshot;
};
const prefix = 'daisy:document-drafts:copy:';
export const isDraftKey = (key: string) => key.startsWith(prefix);
const principalPrefix = (principalId: string) => `${prefix}${principalId}:`;
export const isPrincipalDraftKey = (key: string, principalId: string) =>
  key.startsWith(principalPrefix(principalId));
const keyOf = (principalId: string, id: string) =>
  `${principalPrefix(principalId)}${id}`;
export const draftKeys = (storage: DraftStorage): readonly string[] => {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && isDraftKey(key)) keys.push(key);
  }
  return keys;
};
const empty = (): DraftSnapshot => ({ record: {}, raw: null });
const hasCopies = (record: DraftRecord) =>
  record.active !== undefined || record.recovery !== undefined;

const bytesOf = (raw: string) => new TextEncoder().encode(raw).length;

const otherRecords = (storage: DraftStorage, key: string) =>
  draftKeys(storage).flatMap((other) => {
    const raw = other === key ? null : storage.getItem(other);
    return raw === null ? [] : [raw];
  });

const fits = (count: number, bytes: number) =>
  count <= DRAFT_RECORD_MAX_COUNT && bytes <= DRAFT_RECORD_MAX_TOTAL_BYTES;

/** Stored size decides this on every keystroke; only a full browser pays to decode. */
const withinBrowserBound = (
  storage: DraftStorage,
  key: string,
  bytes: number,
  now: number,
) => {
  const others = otherRecords(storage, key);
  const stored = others.reduce((sum, raw) => sum + bytesOf(raw), bytes);
  if (fits(others.length + 1, stored)) return true;
  const live = others.flatMap((raw) => {
    const decoded = decodeDraftRecord(raw, now);
    if (!decoded.ok) return [raw];
    return hasCopies(decoded.record)
      ? [encodeDraftRecord(decoded.record)!.raw]
      : [];
  });
  return fits(
    live.length + 1,
    live.reduce((sum, raw) => sum + bytesOf(raw), bytes),
  );
};

/** Retention holds while a browser stays in use, not only for the document reopened. */
export function pruneExpiredDrafts(storage: DraftStorage, now: number) {
  for (const key of draftKeys(storage)) {
    const raw = storage.getItem(key);
    if (raw === null) continue;
    const decoded = decodeDraftRecord(raw, now);
    if (!decoded.ok || !hasCopies(decoded.record)) storage.removeItem(key);
    else if (decoded.expired)
      storage.setItem(key, encodeDraftRecord(decoded.record)!.raw);
  }
}

/** One principal's draft-storage adapter. Each complete record write is atomic; no pre-delete eviction. */
export function createDraftStorage({
  storage,
  principalId,
  failed,
}: {
  readonly storage: DraftStorage | null;
  readonly principalId: string;
  readonly failed: (id: string) => void;
}) {
  const read = (id: string, now: number): DraftSnapshot => {
    if (!storage) return empty();
    try {
      const key = keyOf(principalId, id);
      const raw = storage.getItem(key);
      if (raw === null) return empty();
      const decoded = decodeDraftRecord(raw, now);
      if (!decoded.ok) {
        // A corrupt record is simply discarded; only a failed removal is a problem.
        try {
          storage.removeItem(key);
          return empty();
        } catch {
          failed(id);
          return { record: {}, raw };
        }
      }
      const record = decoded.record;
      const encoded = encodeDraftRecord(record)!;
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
    previous: DraftSnapshot,
    record: DraftRecord,
    now: number,
  ): DraftWrite => {
    record = expireDraftRecord(record, now);
    const encoded = encodeDraftRecord(record);
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
      const key = keyOf(principalId, id);
      const currentRaw = storage.getItem(key);
      if (currentRaw !== previous.raw) {
        failed(id);
        return { stored: false, snapshot: read(id, now) };
      }
      if (!hasCopies(record)) {
        storage.removeItem(key);
        return { stored: true, snapshot: empty() };
      }
      // A shrinking write can never add to the browser total, so it always
      // proceeds; anything else pays the bound over every other record.
      const shrinks =
        currentRaw !== null && encoded.bytes <= bytesOf(currentRaw);
      if (!shrinks && !withinBrowserBound(storage, key, encoded.bytes, now)) {
        failed(id);
        return { stored: false, snapshot: previous };
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
      for (const key of draftKeys(storage))
        if (isPrincipalDraftKey(key, principalId)) storage.removeItem(key);
      return true;
    } catch {
      failed('');
      return false;
    }
  };
  return { read, write, purge };
}

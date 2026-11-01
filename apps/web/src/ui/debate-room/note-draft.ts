/** One immutable local copy; moving slots never renews its retention. */
export type NoteCopy = {
  readonly generation: string;
  readonly html: string;
  readonly baseRevision: number;
  readonly savedAt: number;
  readonly expiresAt: number;
};
export type NoteRecord = {
  readonly active?: NoteCopy;
  readonly recovery?: NoteCopy;
};
export type NoteOffer = {
  readonly documentId: string;
  readonly slot: 'active' | 'recovery';
  readonly copy: NoteCopy;
};
export type NoteTransition = {
  readonly status: 'changed' | 'unchanged' | 'stale' | 'occupied' | 'overflow';
  readonly record: NoteRecord;
};
export const noteCopies = (record: NoteRecord): readonly NoteCopy[] =>
  [record.active, record.recovery].filter(
    (copy): copy is NoteCopy => copy !== undefined,
  );

export const sameNoteCopy = (one: NoteCopy, two: NoteCopy): boolean =>
  one.generation === two.generation &&
  one.html === two.html &&
  one.baseRevision === two.baseRevision &&
  one.savedAt === two.savedAt &&
  one.expiresAt === two.expiresAt;

/** Overfull untrusted storage permits removal only, never replacement or renewal. */
export const removesOnlyNoteCopies = (
  before: NoteRecord,
  after: NoteRecord,
  beforeBytes: number,
  afterBytes: number,
): boolean => {
  const previous = noteCopies(before),
    next = noteCopies(after);
  return (
    next.length < previous.length &&
    afterBytes <= beforeBytes &&
    next.every((copy) =>
      previous.some((original) => sameNoteCopy(copy, original)),
    )
  );
};

const NOTE_RECORD_MAX_BYTES = 256 * 1024;
export const NOTE_RECORD_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const NOTE_RECORD_MAX_COUNT = 16;
const retentionMs = 7 * 24 * 60 * 60 * 1000;
const bytesOf = (raw: string) => new TextEncoder().encode(raw).length;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const slots = (
  active: NoteCopy | undefined,
  recovery: NoteCopy | undefined,
): NoteRecord => ({
  ...(active ? { active } : {}),
  ...(recovery ? { recovery } : {}),
});

export const newNoteCopy = ({
  html,
  baseRevision,
  generation,
  now,
}: {
  readonly html: string;
  readonly baseRevision: number;
  readonly generation: string;
  readonly now: number;
}): NoteCopy => ({
  html,
  baseRevision,
  generation,
  savedAt: now,
  expiresAt: now + retentionMs,
});

const parseCopy = (value: unknown): NoteCopy | null => {
  if (!object(value)) return null;
  const fields = ['generation', 'html', 'baseRevision', 'savedAt', 'expiresAt'];
  if (
    !fields.every((field) => Object.hasOwn(value, field)) ||
    Object.keys(value).some((field) => !fields.includes(field))
  )
    return null;
  const { generation, html, baseRevision, savedAt, expiresAt } = value;
  if (
    typeof generation !== 'string' ||
    generation.length === 0 ||
    generation.length > 128 ||
    typeof html !== 'string' ||
    !count(baseRevision) ||
    !count(savedAt) ||
    !count(expiresAt) ||
    expiresAt - savedAt !== retentionMs
  )
    return null;
  return { generation, html, baseRevision, savedAt, expiresAt };
};

export const expireNoteRecord = (record: NoteRecord, now: number): NoteRecord =>
  slots(
    record.active && record.active.expiresAt > now ? record.active : undefined,
    record.recovery && record.recovery.expiresAt > now
      ? record.recovery
      : undefined,
  );

/** Pre-ship shape only. Expiration removes each copy independently; invalid data is never offered. */
export function decodeNoteRecord(
  raw: string,
  {
    now,
    serverRevision,
  }: { readonly now: number; readonly serverRevision: number },
):
  | {
      readonly ok: true;
      readonly record: NoteRecord;
      readonly expired: boolean;
    }
  | { readonly ok: false } {
  if (
    bytesOf(raw) > NOTE_RECORD_MAX_BYTES ||
    !count(now) ||
    !count(serverRevision)
  )
    return { ok: false };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (
    !object(value) ||
    Object.keys(value).some(
      (field) => field !== 'active' && field !== 'recovery',
    )
  )
    return { ok: false };
  const active = Object.hasOwn(value, 'active')
    ? parseCopy(value.active)
    : undefined;
  const recovery = Object.hasOwn(value, 'recovery')
    ? parseCopy(value.recovery)
    : undefined;
  if (
    active === null ||
    recovery === null ||
    (active && recovery && active.generation === recovery.generation)
  )
    return { ok: false };
  if (
    [active, recovery].some(
      (copy) =>
        copy !== undefined &&
        (copy.savedAt > now || copy.baseRevision > serverRevision),
    )
  )
    return { ok: false };
  const record = expireNoteRecord(slots(active, recovery), now);
  return {
    ok: true,
    record,
    expired: active !== record.active || recovery !== record.recovery,
  };
}

/** The whole entry, never an individual slot, pays the serialized-byte bound. */
export const encodeNoteRecord = (
  record: NoteRecord,
): { readonly raw: string; readonly bytes: number } | null => {
  const raw = JSON.stringify(record);
  const bytes = bytesOf(raw);
  return bytes <= NOTE_RECORD_MAX_BYTES ? { raw, bytes } : null;
};
const proposed = (previous: NoteRecord, next: NoteRecord): NoteTransition =>
  encodeNoteRecord(next) === null
    ? { status: 'overflow', record: previous }
    : { status: 'changed', record: next };

/** Typing may replace owned active text, but cannot consume an unseen retained offer. */
export function editNoteRecord(
  record: NoteRecord,
  active: NoteCopy,
  activeOffered: boolean,
): NoteTransition {
  if (record.active && activeOffered) {
    if (record.recovery) return { status: 'occupied', record };
    return proposed(record, { active, recovery: record.active });
  }
  return proposed(record, slots(active, record.recovery));
}

/** Only a named active generation can be cleared/rebased. Recovery is independent. */
export function acknowledgeNoteRecord(
  record: NoteRecord,
  {
    generation,
    revision,
    rebaseGeneration,
  }: {
    readonly generation: string;
    readonly revision: number;
    readonly rebaseGeneration: string | null;
  },
): NoteTransition {
  if (record.active?.generation === generation)
    return proposed(record, slots(undefined, record.recovery));
  if (record.active && record.active.generation === rebaseGeneration)
    return proposed(record, {
      active: { ...record.active, baseRevision: revision },
      ...(record.recovery ? { recovery: record.recovery } : {}),
    });
  return { status: 'unchanged', record };
}

/** A prior owner's paused edit becomes an explicit offer; no invisible save queue. */
export const offerNoteRecord = (record: NoteRecord): NoteRecord =>
  record.active && !record.recovery ? { recovery: record.active } : record;

/** Restore is a proposal until the storage adapter commits it atomically. */
export function restoreNoteRecord(
  record: NoteRecord,
  {
    generation,
    active,
    activeOffered,
    newGeneration,
    revision,
  }: {
    readonly generation: string;
    readonly active: NoteCopy | null;
    readonly activeOffered: boolean;
    readonly newGeneration: string;
    readonly revision: number;
  },
): NoteTransition {
  const selectedRecovery = record.recovery?.generation === generation;
  const selected = selectedRecovery
    ? record.recovery
    : record.active?.generation === generation
      ? record.active
      : undefined;
  if (!selected) return { status: 'stale', record };
  const different =
    active && active.generation !== generation ? active : undefined;
  if (
    different &&
    record.active &&
    activeOffered &&
    record.active.generation !== generation &&
    record.active.generation !== different.generation
  )
    return { status: 'occupied', record };
  if (!selectedRecovery && different && record.recovery)
    return { status: 'occupied', record };
  const recovery = selectedRecovery
    ? (different ??
      (record.active?.generation !== generation ? record.active : undefined))
    : (different ?? record.recovery);
  return proposed(
    record,
    slots(
      { ...selected, generation: newGeneration, baseRevision: revision },
      recovery,
    ),
  );
}

export function discardNoteRecord(
  record: NoteRecord,
  generation: string,
): NoteTransition {
  if (record.recovery?.generation === generation)
    return proposed(record, slots(record.active, undefined));
  if (record.active?.generation === generation)
    return proposed(record, slots(undefined, record.recovery));
  return { status: 'stale', record };
}

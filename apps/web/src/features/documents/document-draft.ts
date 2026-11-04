/** One immutable local copy; moving slots never renews its retention. */
export type DraftCopy = {
  readonly generation: string;
  readonly html: string;
  readonly baseRevision: number;
  readonly savedAt: number;
  readonly expiresAt: number;
};
export type DraftRecord = {
  readonly active?: DraftCopy;
  readonly recovery?: DraftCopy;
};
export type DraftTransition = {
  readonly status: 'changed' | 'unchanged' | 'stale' | 'occupied' | 'overflow';
  readonly record: DraftRecord;
};
export const draftCopies = (record: DraftRecord): readonly DraftCopy[] =>
  [record.active, record.recovery].filter(
    (copy): copy is DraftCopy => copy !== undefined,
  );

export const sameDraftCopy = (one: DraftCopy, two: DraftCopy): boolean =>
  one.generation === two.generation &&
  one.html === two.html &&
  one.baseRevision === two.baseRevision &&
  one.savedAt === two.savedAt &&
  one.expiresAt === two.expiresAt;

const DRAFT_RECORD_MAX_BYTES = 256 * 1024;
export const DRAFT_RECORD_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const DRAFT_RECORD_MAX_COUNT = 16;
const retentionMs = 7 * 24 * 60 * 60 * 1000;
const bytesOf = (raw: string) => new TextEncoder().encode(raw).length;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const slots = (
  active: DraftCopy | undefined,
  recovery: DraftCopy | undefined,
): DraftRecord => ({
  ...(active ? { active } : {}),
  ...(recovery ? { recovery } : {}),
});

export const newDraftCopy = ({
  html,
  baseRevision,
  generation,
  now,
}: {
  readonly html: string;
  readonly baseRevision: number;
  readonly generation: string;
  readonly now: number;
}): DraftCopy => ({
  html,
  baseRevision,
  generation,
  savedAt: now,
  expiresAt: now + retentionMs,
});

const parseCopy = (value: unknown): DraftCopy | null => {
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

export const expireDraftRecord = (
  record: DraftRecord,
  now: number,
): DraftRecord =>
  slots(
    record.active && record.active.expiresAt > now ? record.active : undefined,
    record.recovery && record.recovery.expiresAt > now
      ? record.recovery
      : undefined,
  );

/** Pre-ship shape only. Expiration removes each copy independently; invalid data is never offered. */
export function decodeDraftRecord(
  raw: string,
  now: number,
):
  | {
      readonly ok: true;
      readonly record: DraftRecord;
      readonly expired: boolean;
    }
  | { readonly ok: false } {
  if (bytesOf(raw) > DRAFT_RECORD_MAX_BYTES || !count(now))
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
  // A clock can step backwards past savedAt, so only expiresAt governs time.
  const record = expireDraftRecord(slots(active, recovery), now);
  return {
    ok: true,
    record,
    expired: active !== record.active || recovery !== record.recovery,
  };
}

/** The whole entry, never an individual slot, pays the serialized-byte bound. */
export const encodeDraftRecord = (
  record: DraftRecord,
): { readonly raw: string; readonly bytes: number } | null => {
  const raw = JSON.stringify(record);
  const bytes = bytesOf(raw);
  return bytes <= DRAFT_RECORD_MAX_BYTES ? { raw, bytes } : null;
};
const proposed = (previous: DraftRecord, next: DraftRecord): DraftTransition =>
  encodeDraftRecord(next) === null
    ? { status: 'overflow', record: previous }
    : { status: 'changed', record: next };

/** Typing may replace owned active text, but cannot consume an unseen retained offer. */
export function editDraftRecord(
  record: DraftRecord,
  active: DraftCopy,
  activeOffered: boolean,
): DraftTransition {
  // Another tab can move this same copy aside. It returns to active rather than
  // filling both slots, because a record holding one generation twice is corrupt.
  const recovery =
    record.recovery?.generation === active.generation
      ? undefined
      : record.recovery;
  if (record.active && activeOffered) {
    if (recovery) return { status: 'occupied', record };
    return proposed(record, { active, recovery: record.active });
  }
  return proposed(record, slots(active, recovery));
}

/**
 * An acknowledged generation is proven committed, so no slot keeps it. A named
 * newer edit rebases. With nothing newer pending, this owner's own earlier
 * copies are obsolete too, even if another tab moved one aside. Copies from
 * elsewhere are never touched.
 */
export function acknowledgeDraftRecord(
  record: DraftRecord,
  {
    generation,
    revision,
    rebaseGeneration,
    supersededByThisOwner,
  }: {
    readonly generation: string;
    readonly revision: number;
    readonly rebaseGeneration: string | null;
    /** An earlier copy this owner wrote and its newest saved edit replaces. */
    readonly supersededByThisOwner: (generation: string) => boolean;
  },
): DraftTransition {
  const obsolete = (copy: DraftCopy | undefined) =>
    copy !== undefined &&
    (copy.generation === generation ||
      (rebaseGeneration === null && supersededByThisOwner(copy.generation)));
  const recovery = obsolete(record.recovery) ? undefined : record.recovery;
  const active = record.active;
  if (active && active.generation === rebaseGeneration)
    return proposed(
      record,
      slots({ ...active, baseRevision: revision }, recovery),
    );
  if (!obsolete(active) && recovery === record.recovery)
    return { status: 'unchanged', record };
  return proposed(
    record,
    slots(obsolete(active) ? undefined : active, recovery),
  );
}

/** Whether a 409 revision is the server's copy of one of this owner's unanswered saves. */
export const ownUnansweredCommit = (
  unanswered: readonly DraftCopy[],
  revision: number,
  matchesServer: (html: string) => boolean,
): DraftCopy | undefined =>
  unanswered.find(
    (copy) => revision === copy.baseRevision + 1 && matchesServer(copy.html),
  );

/** A copy matching the server's text has nothing left to recover, whichever save committed it. */
export const settleDraftRecord = (
  record: DraftRecord,
  matchesServer: (html: string) => boolean,
): DraftRecord => {
  const active =
      record.active && !matchesServer(record.active.html)
        ? record.active
        : undefined,
    recovery =
      record.recovery && !matchesServer(record.recovery.html)
        ? record.recovery
        : undefined;
  return active === record.active && recovery === record.recovery
    ? record
    : slots(active, recovery);
};

/** A prior owner's paused edit becomes an explicit offer; no invisible save queue. */
export const offerDraftRecord = (record: DraftRecord): DraftRecord =>
  record.active && !record.recovery ? { recovery: record.active } : record;

/** Restore is a proposal until the storage adapter commits it atomically. */
export function restoreDraftRecord(
  record: DraftRecord,
  {
    generation,
    active,
    activeOffered,
    newGeneration,
    revision,
  }: {
    readonly generation: string;
    readonly active: DraftCopy | null;
    readonly activeOffered: boolean;
    readonly newGeneration: string;
    readonly revision: number;
  },
): DraftTransition {
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

export function discardDraftRecord(
  record: DraftRecord,
  generation: string,
): DraftTransition {
  if (record.recovery?.generation === generation)
    return proposed(record, slots(record.active, undefined));
  if (record.active?.generation === generation)
    return proposed(record, slots(undefined, record.recovery));
  return { status: 'stale', record };
}

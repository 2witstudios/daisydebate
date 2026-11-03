import type {
  RecordingApplied,
  RecordingDeletionClaim,
  RecordingObjectStore,
  RecordingRecord,
  RecordingStore,
} from './ports';

/** An in-memory store with the real one's contract, for the feature's unit tests. */
export const fakeRecordingStore = (
  seed: readonly RecordingRecord[] = [],
  options: {
    readonly failedBefore?: readonly string[];
    readonly sourcesRemain?: readonly string[];
    readonly endedHolds?: readonly string[];
  } = {},
) => {
  const rows = new Map(seed.map((record) => [record.id, record]));
  const due = new Map<string, number>();
  const deferred: { readonly id: string; readonly retryAt: string }[] = [];
  const apply: RecordingStore['apply'] = async (
    id,
    decide,
    expectedVersion,
  ): Promise<RecordingApplied> => {
    const record = rows.get(id);
    if (!record) return { kind: 'missing' };
    if (expectedVersion !== undefined && record.version !== expectedVersion)
      return { kind: 'stale', record };
    const transition = decide(record);
    if (transition.kind !== 'moved')
      return { kind: 'decided', record, transition };
    const next = {
      ...record,
      lifecycle: transition.next,
      version: record.version + 1,
    };
    rows.set(id, next);
    return { kind: 'decided', record: next, transition };
  };
  const store: RecordingStore = {
    request: async (input) => {
      const existing = [...rows.values()].find(
        (row) => row.roundId === input.roundId,
      );
      if (existing) return existing;
      const created: RecordingRecord = {
        ...input,
        lifecycle: { status: 'requested' },
        version: 1,
      };
      rows.set(created.id, created);
      return created;
    },
    find: async (id) => rows.get(id) ?? null,
    findByRound: async (roundId) =>
      [...rows.values()].find((row) => row.roundId === roundId) ?? null,
    apply,
    applyParticipantRemoval: (id, decide, { expectedVersion }) =>
      apply(id, decide, expectedVersion),
    claimDeletions: async ({ limit }): Promise<RecordingDeletionClaim[]> =>
      [...rows.values()]
        .filter((row) => row.lifecycle.status === 'removing')
        .slice(0, limit)
        .map((record) => ({ record, attempts: due.get(record.id) ?? 0 })),
    deferDeletion: async (id, { retryAt, failed }) => {
      if (failed) due.set(id, (due.get(id) ?? 0) + 1);
      deferred.push({ id, retryAt });
    },
    sourcesRemain: async (id) => (options.sourcesRemain ?? []).includes(id),
    listEndedEvidenceHolds: async ({ limit }) =>
      (options.endedHolds ?? []).slice(0, limit),
    listFailedBefore: async ({ limit }) =>
      (options.failedBefore ?? []).slice(0, limit),
  };
  return { store, rows, deferred };
};

export const fakeObjectStore = (
  keys: readonly string[] = [],
  options: {
    readonly failRemoval?: boolean;
    readonly texts?: Readonly<Record<string, string>>;
  } = {},
) => {
  const objects = new Set(keys);
  const store: RecordingObjectStore = {
    signedRead: (key, { expiresInSeconds, attachmentName }) =>
      `https://store.test/${key}?expires=${expiresInSeconds}${attachmentName ? `&attachment=${attachmentName}` : ''}`,
    readText: async (key) => {
      const text = options.texts?.[key];
      if (text === undefined) throw new Error('missing object');
      return text;
    },
    listKeys: async (prefix, limit) =>
      [...objects].filter((key) => key.startsWith(prefix)).slice(0, limit),
    removeKeys: async (removed) => {
      if (options.failRemoval) throw new Error('vendor outage');
      removed.forEach((key) => objects.delete(key));
    },
  };
  return { store, objects };
};

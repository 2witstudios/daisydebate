import type { readYouthRecordingPeople } from './youth-recording-people';

/** A Youth Round's youth debaters and their linked adults, as one read answers. */
export type YouthRoundPeople = Awaited<
  ReturnType<typeof readYouthRecordingPeople>
>;

/**
 * How long a Youth Round's people are reused (ADR 0150, ADR 0155). A
 * Recording's playback authorizes every HLS segment, and a live Round's
 * watchers poll and subscribe, so without this each would re-read every
 * debater's schools and guardians. A revoked grant or an ended guardian link
 * stops admitting within this long. The web and the realtime server each keep
 * one per process.
 */
export const YOUTH_PEOPLE_TTL_MS = 15_000;
const MAX_ROUNDS = 500;

/** A Round's people through the cache, and, without reading, those it already holds. */
export type YouthPeopleCache = {
  (roundId: string): Promise<YouthRoundPeople>;
  /** The people a fresh, settled read holds now; undefined when none does. */
  readonly peek: (roundId: string) => YouthRoundPeople | undefined;
};

/**
 * A short, bounded cache of one read per Round. A failed read is not kept, and
 * a full cache drops its oldest entry first.
 */
export const youthPeopleCache = (deps: {
  readonly read: (roundId: string) => Promise<YouthRoundPeople>;
  readonly nowMs: () => number;
}): YouthPeopleCache => {
  const entries = new Map<
    string,
    {
      readonly atMs: number;
      readonly people: Promise<YouthRoundPeople>;
      settled?: YouthRoundPeople;
    }
  >();
  const fresh = (roundId: string) => {
    const kept = entries.get(roundId);
    return kept && deps.nowMs() - kept.atMs < YOUTH_PEOPLE_TTL_MS
      ? kept
      : undefined;
  };
  const cached = (roundId: string): Promise<YouthRoundPeople> => {
    const nowMs = deps.nowMs();
    const kept = entries.get(roundId);
    if (kept && nowMs - kept.atMs < YOUTH_PEOPLE_TTL_MS) return kept.people;
    entries.delete(roundId);
    if (entries.size >= MAX_ROUNDS) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    const people = deps.read(roundId);
    const entry: {
      readonly atMs: number;
      readonly people: Promise<YouthRoundPeople>;
      settled?: YouthRoundPeople;
    } = { atMs: nowMs, people };
    entries.set(roundId, entry);
    people.then(
      (read) => {
        entry.settled = read;
      },
      () => {
        if (entries.get(roundId)?.people === people) entries.delete(roundId);
      },
    );
    return people;
  };
  return Object.assign(cached, {
    peek: (roundId: string) => fresh(roundId)?.settled,
  });
};

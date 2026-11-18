import type { YouthRoundPeople } from './youth-audience';

/**
 * How long a Youth Round's people are reused (ADR 0149). A Recording's
 * playback authorizes every HLS segment, so without this each segment would
 * re-read every debater's schools and guardians. A revoked grant or an ended
 * guardian link stops admitting within this long.
 */
export const YOUTH_PEOPLE_TTL_MS = 15_000;
const MAX_ROUNDS = 500;

/**
 * A short, bounded cache of one read per Round. A failed read is not kept, and
 * a full cache drops its oldest entry first.
 */
export const youthPeopleCache = (deps: {
  readonly read: (roundId: string) => Promise<YouthRoundPeople>;
  readonly nowMs: () => number;
}) => {
  const entries = new Map<
    string,
    { readonly atMs: number; readonly people: Promise<YouthRoundPeople> }
  >();
  return (roundId: string): Promise<YouthRoundPeople> => {
    const nowMs = deps.nowMs();
    const kept = entries.get(roundId);
    if (kept && nowMs - kept.atMs < YOUTH_PEOPLE_TTL_MS) return kept.people;
    entries.delete(roundId);
    if (entries.size >= MAX_ROUNDS) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    const people = deps.read(roundId);
    entries.set(roundId, { atMs: nowMs, people });
    people.catch(() => {
      if (entries.get(roundId)?.people === people) entries.delete(roundId);
    });
    return people;
  };
};

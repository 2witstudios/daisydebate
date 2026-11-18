import type { YouthRoundPeople } from './youth-people-cache';

/** Bounded: a full map drops its oldest Round first. */
const MAX_ROUNDS = 5_000;

/**
 * A Round's linked adults for its live audience (ADR 0155): on a Youth Round,
 * the actors of every youth debater's coaches and guardians, the same people
 * as its Recording's audience (ADR 0150), read through the injected 15-second
 * cache; null on every other Round. Whether a Round is a Youth one is frozen
 * at Start, so it is read once per Round; a missing Round is asked again.
 */
export const youthRoundLinkedAdults = (deps: {
  /** True on a ranked Round on the Youth division; null when there is no such Round. */
  readonly readRoundYouth: (roundId: string) => Promise<boolean | null>;
  readonly people: (
    roundId: string,
  ) => Promise<Pick<YouthRoundPeople, 'debaters'>>;
}) => {
  const youth = new Map<string, boolean>();
  const isYouth = async (roundId: string) => {
    const known = youth.get(roundId);
    if (known !== undefined) return known;
    const found = await deps.readRoundYouth(roundId);
    if (found === null) return false;
    if (youth.size >= MAX_ROUNDS) {
      const oldest = youth.keys().next().value;
      if (oldest !== undefined) youth.delete(oldest);
    }
    youth.set(roundId, found);
    return found;
  };
  return async (
    roundId: string,
  ): Promise<{ readonly linkedAdultActorIds: readonly string[] } | null> => {
    if (!(await isYouth(roundId))) return null;
    const { debaters } = await deps.people(roundId);
    return {
      linkedAdultActorIds: [
        ...new Set(debaters.flatMap((debater) => debater.linkedAdultActorIds)),
      ],
    };
  };
};

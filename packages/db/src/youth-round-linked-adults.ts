import type { YouthLiveFact } from '@daisy/protocol';
import type { YouthRoundPeople } from './youth-people-cache';

/** Bounded: a full map drops its oldest Round first. */
const MAX_ROUNDS = 5_000;

type People = Pick<YouthRoundPeople, 'debaters'>;

/**
 * A Round's linked adults, and, without reading, what is already known of
 * them: null for a Round known not to be a Youth one, the fact when its
 * people are cached and fresh, undefined when only a read can tell.
 */
export type LinkedAdults = {
  (roundId: string): Promise<YouthLiveFact | null>;
  readonly peek: (roundId: string) => YouthLiveFact | null | undefined;
};

const factOf = ({ debaters }: People): YouthLiveFact => ({
  linkedAdultActorIds: [
    ...new Set(debaters.flatMap((debater) => debater.linkedAdultActorIds)),
  ],
});

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
  readonly people: ((roundId: string) => Promise<People>) & {
    readonly peek?: (roundId: string) => People | undefined;
  };
}): LinkedAdults => {
  const youth = new Map<string, boolean>();
  // One read per Round even when several ask at once.
  const pending = new Map<string, Promise<boolean>>();
  const isYouth = (roundId: string): Promise<boolean> => {
    const known = youth.get(roundId);
    if (known !== undefined) return Promise.resolve(known);
    const asking = pending.get(roundId);
    if (asking) return asking;
    const read = deps
      .readRoundYouth(roundId)
      .then((found) => {
        if (found === null) return false;
        if (youth.size >= MAX_ROUNDS) {
          const oldest = youth.keys().next().value;
          if (oldest !== undefined) youth.delete(oldest);
        }
        youth.set(roundId, found);
        return found;
      })
      .finally(() => pending.delete(roundId));
    pending.set(roundId, read);
    return read;
  };
  const linked = async (roundId: string) =>
    (await isYouth(roundId)) ? factOf(await deps.people(roundId)) : null;
  return Object.assign(linked, {
    peek: (roundId: string) => {
      const known = youth.get(roundId);
      if (known === undefined) return undefined;
      if (!known) return null;
      const people = deps.people.peek?.(roundId);
      return people === undefined ? undefined : factOf(people);
    },
  });
};

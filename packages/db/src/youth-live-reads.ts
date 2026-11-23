import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { query } from './raw-rows';
import { readRoundYouth } from './round-youth-read';
import { readYouthRecordingPeople } from './youth-recording-people';
import { readStudentLiveRounds } from './youth-students-live';
import type { TxSource } from './tx';
import { youthReuseFencedSql } from './youth-round-sql';
import type { YouthLiveFact } from '@daisy/protocol/youth-live';

/**
 * The live audience's own reads (ADR 0155): whether a Round is a Youth one,
 * its youth debaters' linked adults (ADR 0150's people read, as a named
 * input), and the live Rounds an adult's
 * students debate in, for Watch.
 */
export const youthLiveReadOperations = ({
  database,
}: {
  readonly database: TxSource;
}) => ({
  readRoundYouth: (roundId: string) => readRoundYouth(database, roundId),
  /**
   * A Youth Round's youth debaters and their linked adults (ADR 0150, ADR
   * 0158), one statement. The Recording's audience and the live audience
   * both read it; the Recording's takedown reads it fresh, past any cache.
   */
  readYouthRoundPeople: (roundId: string) =>
    readYouthRecordingPeople(database, roundId),
  readStudentLiveRounds: (adultUserId: string, lobbyId?: string) =>
    readStudentLiveRounds(database, adultUserId, lobbyId),
  /**
   * Whether this Round's content may not leave Daisy (the reuse fence, ADR
   * 0161). The web asks it beside the shared spectator read, which the
   * audience publisher also runs and whose role never reads media releases.
   */
  readRoundReuseFenced: async (roundId: string): Promise<boolean> => {
    const [row] = await query(
      database,
      z.object({ fenced: z.boolean() }),
      sql`select ${youthReuseFencedSql(sql`${roundId}`)} as fenced`,
    );
    return row?.fenced ?? true;
  },
});

/**
 * A Youth Round's linked adults for its live audience and its Recording
 * (ADR 0150, ADR 0155): one 15-second people cache and one resolver over it
 * per set of reads, so the web's Recording playback and live watchers share
 * a cache, and the realtime server keeps its own on its own lanes.
 */

/** The reads a Youth Round's people and its division come from. */
export type YouthLiveReads = {
  readonly readRoundYouth: (roundId: string) => Promise<boolean | null>;
  readonly readYouthRoundPeople: (
    roundId: string,
  ) => ReturnType<typeof readYouthRecordingPeople>;
};

const peopleOf = new WeakMap<YouthLiveReads, YouthPeopleCache>();
const linkedOf = new WeakMap<YouthLiveReads, LinkedAdults>();

/** The one people cache for these reads. Monotonic: a wall clock stepping back must not stretch it. */
export const youthPeopleFor = (reads: YouthLiveReads): YouthPeopleCache => {
  const known = peopleOf.get(reads);
  if (known) return known;
  const made = youthPeopleCache({
    read: reads.readYouthRoundPeople,
    nowMs: () => performance.now(),
  });
  peopleOf.set(reads, made);
  return made;
};

/** The one linked-adults resolver for these reads, over their people cache. */
export const linkedAdultsFor = (reads: YouthLiveReads): LinkedAdults => {
  const known = linkedOf.get(reads);
  if (known) return known;
  const made = youthRoundLinkedAdults({
    readRoundYouth: reads.readRoundYouth,
    people: youthPeopleFor(reads),
  });
  linkedOf.set(reads, made);
  return made;
};

/** Bounded: a full map drops its oldest Round first. */
const MAX_YOUTH_ROUNDS = 5_000;

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
 * A Round's linked adults for its live audience (ADR 0155): on a Youth Room's
 * Round (ADR 0162),
 * the actors of every youth debater's coaches and guardians, the same people
 * as its Recording's audience (ADR 0150), read through the injected 15-second
 * cache; null on every other Round. Whether a Round is a Youth one is frozen
 * at Start, so it is read once per Round; a missing Round is asked again.
 */
export const youthRoundLinkedAdults = (deps: {
  /** True when the Round's Room is in the Youth lobby (ADR 0162); null when there is no such Round. */
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
        if (youth.size >= MAX_YOUTH_ROUNDS) {
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
const MAX_PEOPLE_ROUNDS = 500;

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
    if (entries.size >= MAX_PEOPLE_ROUNDS) {
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

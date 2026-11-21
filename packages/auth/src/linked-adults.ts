/**
 * Who a Youth Round's youth debaters' linked adults are (ADR 0150 §3, ADR
 * 0155, ADR 0158), stated over the facts the rule reads. The rule runs in
 * SQL, in the registered SECURITY DEFINER functions
 * `daisy_linked_adult_users` and `daisy_round_linked_adult_actors`, which
 * the web and the realtime server both call; this is its TypeScript
 * statement, the spec those functions are held to on shared fixtures
 * (`packages/db/integration/round-linked-adult-actors.integration.ts`).
 *
 * A linked adult of a minor is an adult with an active guardian link to
 * them, the owner of an open school they are an active member of, or an
 * active member of that school holding a live organization grant whose role
 * carries `school.roster.manage`; never the minor. A Youth Round's youth
 * debaters are the people holding its current debating seats; any other
 * Round has none.
 */

import {
  isYouthRound,
  type AgeBand,
  type RatingDivision,
} from '@daisy/protocol';

export type LinkedAdultFacts = {
  readonly round: {
    readonly ladderDivision: RatingDivision | null;
    /** The Round's Room; null for a Round with no Room. */
    readonly room: { readonly division: RatingDivision } | null;
  };
  readonly seats: readonly {
    readonly actorId: string;
    readonly debating: boolean;
    /** False for a judge seat its slot no longer names. */
    readonly current: boolean;
  }[];
  /** Every actor the facts name, with the person behind it, if any. */
  readonly actors: readonly {
    readonly id: string;
    readonly userId: string | null;
  }[];
  /** A person's valid age band; a person without one is absent. */
  readonly ageBands: readonly {
    readonly userId: string;
    readonly band: AgeBand;
  }[];
  readonly guardianLinks: readonly {
    readonly guardianUserId: string;
    readonly minorUserId: string;
    readonly active: boolean;
  }[];
  readonly organizations: readonly {
    readonly id: string;
    readonly school: boolean;
    readonly open: boolean;
    readonly ownerUserId: string | null;
  }[];
  readonly memberships: readonly {
    readonly organizationId: string;
    readonly userId: string;
    readonly active: boolean;
  }[];
  readonly grants: readonly {
    readonly organizationId: string;
    readonly userId: string;
    /** An organization grant, neither revoked nor expired. */
    readonly live: boolean;
    /** Its role carries `school.roster.manage`. */
    readonly rosterManage: boolean;
  }[];
};

type RoundLinkedAdults = {
  readonly debaters: readonly {
    readonly actorId: string;
    readonly userId: string;
    readonly linkedAdultActorIds: readonly string[];
  }[];
};

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

/** A minor's linked adults' user ids, sorted. */
const linkedAdultsOf = (
  facts: Omit<LinkedAdultFacts, 'round' | 'seats' | 'actors'>,
  minorUserId: string,
): readonly string[] => {
  const adult = (userId: string) =>
    facts.ageBands.some(
      (each) => each.userId === userId && each.band === 'adult',
    );
  const activeMember = (organizationId: string, userId: string) =>
    facts.memberships.some(
      (m) =>
        m.organizationId === organizationId && m.userId === userId && m.active,
    );
  const schools = facts.organizations.filter(
    (o) => o.school && o.open && activeMember(o.id, minorUserId),
  );
  const candidates = [
    ...facts.guardianLinks
      .filter((link) => link.minorUserId === minorUserId && link.active)
      .map((link) => link.guardianUserId),
    ...schools.flatMap((school) => [
      ...(school.ownerUserId === null ? [] : [school.ownerUserId]),
      ...facts.grants
        .filter(
          (grant) =>
            grant.organizationId === school.id &&
            grant.live &&
            grant.rosterManage &&
            activeMember(school.id, grant.userId),
        )
        .map((grant) => grant.userId),
    ]),
  ];
  return sorted(
    candidates.filter((userId) => userId !== minorUserId && adult(userId)),
  );
};

/** A Round's youth debaters, each with their linked adults' actors, by actor id. */
export const linkedAdultsOfRound = (
  facts: LinkedAdultFacts,
): RoundLinkedAdults => {
  if (!isYouthRound(facts.round, facts.round.room)) return { debaters: [] };
  const userOf = (actorId: string) =>
    facts.actors.find((actor) => actor.id === actorId)?.userId ?? null;
  const debaters = sorted(
    facts.seats
      .filter((seat) => seat.debating && seat.current)
      .map((seat) => seat.actorId),
  );
  return {
    debaters: debaters.flatMap((actorId) => {
      const userId = userOf(actorId);
      if (userId === null) return [];
      const adults = linkedAdultsOf(facts, userId);
      return {
        actorId,
        userId,
        linkedAdultActorIds: sorted(
          facts.actors
            .filter(
              (actor) => actor.userId !== null && adults.includes(actor.userId),
            )
            .map((actor) => actor.id),
        ),
      };
    }),
  };
};

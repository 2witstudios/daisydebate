import { rankedAgeAdmitted } from '@daisy/auth/age-floor';
import type { CompetitionType } from '@daisy/protocol';
import type { lockAuthorizationActors } from './authorization';

/**
 * Decision 79: ranked play is for members at or over the ranked age floor.
 * A Room rates when it is ranked (the Freestyle ladder) or a league Room on a
 * ladder. The age is each person's band on their fenced account, which the
 * command already holds; nothing here reads the age record itself.
 */
type RatedRoomFacts = {
  readonly competitionType: CompetitionType;
  readonly leagueLadderId: string | null;
};
type FencedAccounts = Awaited<ReturnType<typeof lockAuthorizationActors>>;

/** Whether a Room's Round would rate anyone: ranked, or on a league ladder. */
export const roomRates = (room: RatedRoomFacts): boolean =>
  room.competitionType === 'ranked' || room.leagueLadderId !== null;

/**
 * Whether this person's fenced age keeps them out of this Room: it rates and
 * they are under the floor, or no fenced account says otherwise.
 */
export const belowRankedAge = (
  room: RatedRoomFacts,
  accounts: FencedAccounts,
  actorId: string,
): boolean =>
  roomRates(room) &&
  !rankedAgeAdmitted(
    accounts.find((account) => account?.actorId === actorId)?.ageBand ?? null,
  );

/**
 * A seating target, ineligible when its age keeps it out of this Room, so the
 * engine refuses it as it refuses any ineligible target; a bot always fits.
 */
export const seatableInRoom = <
  A extends {
    readonly actorId: string;
    readonly kind: 'human' | 'bot';
    readonly eligible: boolean;
  },
>(
  room: RatedRoomFacts,
  accounts: FencedAccounts,
  actor: A | null,
): A | null =>
  actor && {
    ...actor,
    eligible:
      actor.eligible &&
      (actor.kind !== 'human' ||
        !belowRankedAge(room, accounts, actor.actorId)),
  };

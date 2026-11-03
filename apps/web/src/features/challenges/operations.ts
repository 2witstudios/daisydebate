import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import type { ChallengeListRow, ChallengeStore } from '@daisy/db/challenges';
import { createAppError, createRefusal, isAppError } from '@daisy/errors';
import { ROOM_SEAT_HOLD_MS } from '@daisy/protocol';
import type {
  RatingLadder,
  ChallengeList,
  CompetitionType,
  ChallengeResult,
  PresenceActivity,
} from '@daisy/protocol';
import type { DiscoverActor } from '../account/username-discovery';
import { requireMemberActor } from '../access/actor';

/** How long an offer stands; the challenged member is online, or soon gone. */
export const CHALLENGE_TTL_MS = 120_000;

/** Sending or answering, per member per minute: generous for people, not scripts. */
export const challengeRateLimit = {
  key: (actorId: string) => `challenges:${actorId}`,
  rule: { windowSeconds: 60, max: 30 },
} as const;
/** Offers per member per hour, since anyone can now challenge anyone. */
export const challengeSendLimit = {
  key: (actorId: string) => `challenges-sent:${actorId}`,
  rule: { windowSeconds: 3_600, max: 30 },
} as const;

type Capability =
  | 'social.challenge.send'
  | 'social.challenge.accept'
  | 'social.challenge.decline'
  | 'social.challenge.cancel';

export type ChallengeDependencies = {
  readonly clock: Clock;
  readonly limit: (actorId: string) => Promise<void>;
  readonly limitSend: (actorId: string) => Promise<void>;
  /** Whether a season is active, which a ranked room needs. */
  readonly rankedOpen: () => Promise<boolean>;
  /** Whether the catalog offers this format, which Accept's room needs. */
  readonly formatOffered: (format: RatingLadder) => Promise<boolean>;
  /** The one username port: it spends discovery before each lookup. */
  readonly discover: DiscoverActor;
  readonly activity: (actorId: string) => Promise<PresenceActivity | null>;
  readonly store: (capability: Capability) => ChallengeStore;
  /** The actor an offer names on the other end, for its contact fence. */
  readonly counterpart: (
    actorId: string,
    challengeId: string,
  ) => Promise<string | null>;
};

/** A block or a closed account answers NOT_FOUND, never saying which. */
const unnamed = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (isAppError(error) && error.code === 'AUTHORIZATION')
      throw createAppError('NOT_FOUND');
    throw error;
  }
};

/**
 * Offers a debate to anyone available (ADR 0103), ranked or casual. No such
 * member, a block, no lease, Busy, appearing offline or already placed are one
 * answer, so a status code never tells a blocked member someone is online.
 * Nothing is created until the other member accepts.
 */
export async function sendChallenge(
  principal: AuthorizationPrincipal,
  input: {
    readonly commandId: string;
    readonly username: string;
    readonly mode: CompetitionType;
    readonly format: RatingLadder;
  },
  dependencies: ChallengeDependencies,
): Promise<Omit<ChallengeResult, 'version'>> {
  const { actorId, userId } = requireMemberActor(principal);
  await dependencies.limit(actorId);
  await dependencies.limitSend(actorId);
  // Refused here, not at Accept: a default offer must be able to open its room.
  if (input.mode === 'ranked' && !(await dependencies.rankedOpen()))
    throw createRefusal('INVARIANT', 'ranked-unavailable');
  if (!(await dependencies.formatOffered(input.format)))
    throw createAppError('VALIDATION');
  const otherActorId = await dependencies.discover(actorId, input.username);
  if (!otherActorId || otherActorId === actorId)
    throw createAppError('NOT_FOUND');
  if ((await dependencies.activity(otherActorId)) === null)
    throw createAppError('NOT_FOUND');
  const now = dependencies.clock.now();
  const { challengeId } = await unnamed(() =>
    dependencies
      .store('social.challenge.send')
      .withContacts(
        { actorId, userId, memberActorIds: [actorId, otherActorId] },
        (frame) =>
          frame.send({
            id: input.commandId,
            mode: input.mode,
            format: input.format,
            now,
            expiresAt: new Date(
              Date.parse(now) + CHALLENGE_TTL_MS,
            ).toISOString(),
          }),
      ),
  );
  return { challengeId, state: 'sent' };
}

/** Records the room the acceptor just opened; both sides' bells ring. */
export async function acceptChallenge(
  principal: AuthorizationPrincipal,
  input: { readonly challengeId: string; readonly roomId: string },
  dependencies: ChallengeDependencies,
): Promise<Omit<ChallengeResult, 'version'>> {
  const { actorId, userId } = requireMemberActor(principal);
  await dependencies.limit(actorId);
  const other = await dependencies.counterpart(actorId, input.challengeId);
  if (!other) throw createAppError('NOT_FOUND');
  const now = dependencies.clock.now();
  await unnamed(() =>
    dependencies
      .store('social.challenge.accept')
      .withContacts(
        { actorId, userId, memberActorIds: [actorId, other] },
        (frame) =>
          frame.accept({
            challengeId: input.challengeId,
            roomId: input.roomId,
            now,
            followUntil: new Date(
              Date.parse(now) + ROOM_SEAT_HOLD_MS,
            ).toISOString(),
          }),
      ),
  );
  return { challengeId: input.challengeId, state: 'accepted' };
}

/** Declining and cancelling are exits: open across a block, and idempotent. */
export async function endChallenge(
  principal: AuthorizationPrincipal,
  command: 'decline' | 'cancel',
  challengeId: string,
  dependencies: ChallengeDependencies,
): Promise<Omit<ChallengeResult, 'version'>> {
  const { actorId, userId } = requireMemberActor(principal);
  await dependencies.limit(actorId);
  const state = command === 'decline' ? 'declined' : 'cancelled';
  const other = await dependencies.counterpart(actorId, challengeId);
  if (!other) return { challengeId, state };
  await dependencies
    .store(
      command === 'decline'
        ? 'social.challenge.decline'
        : 'social.challenge.cancel',
    )
    .withContacts(
      { actorId, userId, memberActorIds: [actorId, other] },
      (frame) =>
        frame.remove({
          challengeId,
          role: command === 'decline' ? 'challenged' : 'challenger',
        }),
    );
  return { challengeId, state };
}

/** Splits one member's rows into what waits on them and what they await. */
export function challengeListOf(
  rows: readonly ChallengeListRow[],
): Omit<ChallengeList, 'version'> {
  const summary = ({
    id,
    username,
    mode,
    format,
    createdAt,
    expiresAt,
  }: ChallengeListRow) => ({
    id,
    username,
    mode,
    format,
    createdAt,
    expiresAt,
  });
  const open = rows.filter((row) => row.roomId === null);
  return {
    incoming: open
      .filter((row) => row.direction === 'incoming')
      .slice(0, 20)
      .map((row) => ({ ...summary(row), actorId: row.actorId })),
    outgoing: open
      .filter((row) => row.direction === 'outgoing')
      .slice(0, 20)
      .map(summary),
    // The acceptor already holds the room; only the challenger still has to go.
    accepted: rows
      .flatMap((row) =>
        row.roomId !== null && row.direction === 'outgoing'
          ? [{ ...summary(row), roomId: row.roomId }]
          : [],
      )
      .slice(0, 20),
  };
}

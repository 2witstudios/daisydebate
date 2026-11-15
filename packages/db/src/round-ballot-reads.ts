import { currentRoundParticipant } from './round-current-participant';
import { roundOutcomeForAudience } from './round-outcome-audience';
import type { RoundBallotAccess } from './round-ballot-audience';
import { ballotScreenings } from './schema/ballot-screenings';
import type { RoundRoomAuthority } from './round-room-authority';
import { withOpening, type ReadOpening } from './round-opening-read';
import type { RoundWaitingFacts, RoundWaitingOn } from '@daisy/protocol';
import { closedStreamGaps, streamKey } from './capture-gaps';
import type { CaptureRule } from '@daisy/protocol';
import { createAppError, isAppError } from '@daisy/errors';
import {
  ballotSubjectsFor,
  idSchema,
  feedbackSubjectOf,
  isJudgeSeat,
  roundBallotReadSchema,
  roundJudgeAssignmentsSchema,
  type LaunchedRound,
  type RoundBallotRead,
} from '@daisy/protocol';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { readLockedFrozenRoundTranscript } from './frozen-transcript';
import { sharedAccount, type Caller, type Account } from './room-command-facts';
import { readAuthorizedRound } from './round-read-authority';
import { ballotReadView, ownJudgeSeat } from './round-ballot-view';
import { roundViewFor } from './round-view-projection';
import { readWaitingOn } from './round-waiting-read';
import { ballots } from './schema/ballots';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';

/** The frozen transcript an authorized audience reads once the Round completes. */
export async function audienceTranscript(
  tx: Parameters<typeof readLockedFrozenRoundTranscript>[0],
  roundId: string,
  allowed: boolean,
  captureRule: CaptureRule,
) {
  if (!allowed) return null;
  const frozen = await readLockedFrozenRoundTranscript(tx, roundId);
  if (!frozen) return null;
  const partial = frozen.coverage.filter(
    (stream) => stream.state === 'partial',
  );
  const closed = frozen.coverage.filter((stream) => stream.state !== 'open');
  const found = await closedStreamGaps(tx, roundId, closed, captureRule);
  const gaps = closed.flatMap((stream) =>
    (found.get(streamKey(stream)) ?? []).map(({ edge: _edge, ...gap }) => ({
      segmentId: stream.segmentId,
      roundParticipantId: stream.roundParticipantId,
      ...gap,
    })),
  );
  return {
    completeness: frozen.completeness,
    utterances: frozen.utterances,
    gaps,
    partialStreams: partial.map((stream) => ({
      segmentId: stream.segmentId,
      roundParticipantId: stream.roundParticipantId,
      reasons: stream.partialReasons,
    })),
  };
}

export const roundBallotReads = ({
  database,
}: {
  readonly database: BunSQLDatabase;
}) => ({
  async listRoundJudgeAssignments(input: {
    readonly caller: Caller;
    readonly authorize: (
      round: LaunchedRound,
      account: Account,
      owner: RoundRoomAuthority,
    ) => boolean;
    readonly readEventDecision: (owner: RoundRoomAuthority) => boolean;
    readonly readOpening: ReadOpening;
  }) {
    const addresses = await database.transaction(async (tx) => {
      const account = await sharedAccount(tx, input.caller);
      if (!account?.member || account.erased)
        throw createAppError('AUTHORIZATION');
      return tx
        .select({ roundId: rounds.id })
        .from(roundParticipants)
        .innerJoin(rounds, eq(rounds.id, roundParticipants.roundId))
        .where(
          and(
            eq(roundParticipants.actorId, input.caller.actorId),
            eq(roundParticipants.seatKind, 'judge'),
            currentRoundParticipant(roundParticipants.id),
          ),
        )
        .orderBy(desc(rounds.createdAt));
    });
    const assignments = [];
    // Each addressed Round owns its parent-lock transaction; a collection never inverts unrelated parent chains.
    for (const address of addresses) {
      try {
        const assignment = await database.transaction(async (tx) => {
          const { round, account, owner } = await readAuthorizedRound(tx, {
            ...input,
            roundId: address.roundId,
          });
          const own = ownJudgeSeat(round.participants, input.caller.actorId);
          if (!own) return null;
          const [ballot] = await tx
            .select({ id: ballots.id })
            .from(ballots)
            .where(eq(ballots.judgeParticipantId, own.id));
          const [freeze] = await tx
            .select({ revision: roundTranscriptFreezes.revision })
            .from(roundTranscriptFreezes)
            .where(eq(roundTranscriptFreezes.roundId, round.id));
          const view = await withOpening(
            tx,
            round,
            {
              ...roundOutcomeForAudience(
                roundViewFor(round, input.caller.actorId),
                owner,
                input.readEventDecision(owner),
              ),
              waitingOn: null,
            },
            { actorId: input.caller.actorId, account },
            input.readOpening,
          );
          return {
            roundId: round.id,
            resolution: view.topic,
            status: view.status,
            outcome: view.outcome,
            ballotSubmitted: ballot !== undefined,
            freezeRevision: freeze?.revision ?? null,
          };
        });
        if (assignment) assignments.push(assignment);
      } catch (error) {
        if (!isAppError(error) || error.code !== 'NOT_FOUND') throw error;
      }
    }
    return roundJudgeAssignmentsSchema.parse(assignments);
  },
  async readRoundBallot(input: {
    readonly roundId: string;
    readonly caller: Caller;
    readonly authorize: (
      round: LaunchedRound,
      account: Account,
      owner: RoundRoomAuthority,
    ) => boolean;
    readonly authorizeTranscript: (
      round: LaunchedRound,
      account: Account,
      owner: RoundRoomAuthority,
    ) => boolean;
    readonly ballotAccess: (
      round: LaunchedRound,
      account: Account,
      owner: RoundRoomAuthority,
    ) => RoundBallotAccess;
    readonly readOpening: ReadOpening;
    /** The engine's decision, injected: an assigned judge's room shows it too. */
    readonly decideWaitingOn: (
      facts: RoundWaitingFacts,
    ) => RoundWaitingOn | null;
    readonly captureRule: CaptureRule;
  }): Promise<RoundBallotRead> {
    if (!idSchema.safeParse(input.roundId).success)
      throw createAppError('VALIDATION');
    return database.transaction(async (tx) => {
      const {
        round,
        account: currentAccount,
        owner,
      } = await readAuthorizedRound(tx, input);
      const access = input.ballotAccess(round, currentAccount, owner);
      const ownSeat = ownJudgeSeat(round.participants, input.caller.actorId);
      const [frozenJudging] = await tx
        .select({ judging: rounds.judging })
        .from(rounds)
        .where(eq(rounds.id, input.roundId));
      const rows = await tx
        .select()
        .from(ballots)
        .where(eq(ballots.roundId, input.roundId));
      const screenings =
        owner.kind === 'event' && owner.direction && rows.length > 0
          ? await tx
              .select()
              .from(ballotScreenings)
              .where(
                and(
                  eq(
                    ballotScreenings.lobbyId,
                    owner.direction.configuration.lobby.id,
                  ),
                  inArray(
                    ballotScreenings.ballotId,
                    rows.map((row) => row.id),
                  ),
                ),
              )
          : [];
      const frozen = ownSeat
        ? await readLockedFrozenRoundTranscript(tx, input.roundId)
        : null;
      const seat = round.participants.find(
        (p) => p.actorId === input.caller.actorId,
      );
      const completed = round.status === 'completed';
      const viewerSubject =
        (seat &&
          feedbackSubjectOf(frozenJudging?.judging?.ballot ?? null, seat)) ??
        undefined;
      const aiJudgeSeatIds = new Set(
        round.participants
          .filter((p) => isJudgeSeat(p.seat) && p.kind === 'bot')
          .map((p) => p.id),
      );
      const waitingOn = await readWaitingOn(tx, round, input.decideWaitingOn);
      return roundBallotReadSchema.parse({
        round: await withOpening(
          tx,
          round,
          {
            ...roundOutcomeForAudience(
              roundViewFor(round, input.caller.actorId),
              owner,
              access.parts.includes('decision'),
            ),
            waitingOn,
          },
          { actorId: input.caller.actorId, account: currentAccount },
          input.readOpening,
        ),
        judging: frozenJudging?.judging ?? null,
        ...ballotReadView({
          audience:
            owner.kind === 'ordinary'
              ? { kind: 'ordinary' }
              : {
                  kind: 'event',
                  access,
                  screenings: new Map(
                    screenings.map((row) => [row.ballotId, row]),
                  ),
                },
          status: round.status,
          ownSeatId: ownSeat?.id,
          viewerSubject,
          aiJudgeSeatIds,
          definition: frozenJudging?.judging?.ballot ?? null,
          source: frozenJudging?.judging?.source ?? null,
          subjects: ballotSubjectsFor(round.rules, round.participants),
          rows,
          frozen,
        }),
        // The shared transcript audience policy owns this private read.
        transcript: await audienceTranscript(
          tx,
          input.roundId,
          completed && input.authorizeTranscript(round, currentAccount, owner),
          input.captureRule,
        ),
      });
    });
  },
});

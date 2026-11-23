import { currentRoundParticipant } from './round-current-participant';
import { roundOutcomeForAudience } from '@daisy/protocol/round-outcome-audience';
import type { RoundBallotAccess } from '@daisy/protocol/ballot-audience';
import { ballotScreenings } from './schema/ballot-screenings';
import type { RoundRoomAuthority } from './round-room-authority';
import { withOpening, type ReadOpening } from './round-opening-read';
import type {
  RoundWaitingFacts,
  RoundWaitingOn,
} from '@daisy/protocol/round-view';
import { closedStreamGaps, streamKey } from './capture-gaps';
import type { CaptureRule } from '@daisy/protocol/capture-verdict';
import { createAppError, isAppError } from '@daisy/errors';
import {
  ballotSubjectsFor,
  feedbackSubjectOf,
  storedBallotSchemaFor,
  ballotSchemaFor,
  type Ballot,
} from '@daisy/protocol/ballot-schema';
import { idSchema } from '@daisy/protocol/primitives';
import { isJudgeSeat, type SeatRef } from '@daisy/protocol/seats';
import {
  roundBallotReadSchema,
  roundJudgeAssignmentsSchema,
  type RoundBallotRead,
} from '@daisy/protocol/round-ballot-read';
import { type LaunchedRound } from '@daisy/protocol/round-view';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { readLockedFrozenRoundTranscript } from './frozen-transcript';
import { sharedAccount, type Caller, type Account } from './room-command-facts';
import { readAuthorizedRound } from './round-read-authority';
import { roundViewFor } from '@daisy/protocol/round-viewer';
import { readWaitingOn } from './round-waiting-read';
import { ballots } from './schema/ballots';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';
import { inTransaction, type TxSource } from './tx';
import { run } from './raw-rows';
import {
  eventBallotForAudience,
  type BallotScreeningRead,
} from '@daisy/protocol/ballot-audience';
import {
  ballotDefinitionIdentity,
  type BallotDefinitionSource,
  type BallotDefinition,
  type BallotSubjects,
} from '@daisy/protocol/ballot-definition';
import type { FrozenRoundTranscript } from './frozen-transcript';

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
  readonly database: TxSource;
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
    return inTransaction(database, async (tx) => {
      const account = await sharedAccount(tx, input.caller);
      if (!account?.member || account.erased)
        throw createAppError('AUTHORIZATION');
      const addresses = await tx
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
      const assignments = [];
      for (const address of addresses) {
        // Roll back each read's locks before visiting another parent chain.
        // The account fence predates the savepoint and survives every rollback.
        await run(tx, sql`savepoint judge_assignment`);
        try {
          const { round, account, owner } = await readAuthorizedRound(tx, {
            ...input,
            roundId: address.roundId,
          });
          const own = ownJudgeSeat(round.participants, input.caller.actorId);
          if (!own) continue;
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
          assignments.push({
            roundId: round.id,
            resolution: view.topic,
            status: view.status,
            outcome: view.outcome,
            ballotSubmitted: ballot !== undefined,
            freezeRevision: freeze?.revision ?? null,
          });
        } catch (error) {
          if (!isAppError(error) || error.code !== 'NOT_FOUND') throw error;
        } finally {
          await run(tx, sql`rollback to savepoint judge_assignment`);
          await run(tx, sql`release savepoint judge_assignment`);
        }
      }
      return roundJudgeAssignmentsSchema.parse(assignments);
    });
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
    return inTransaction(database, async (tx) => {
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

type BallotRow = typeof ballots.$inferSelect;

/**
 * A stored ballot as the protocol Ballot, from its columns: a win names its
 * side, and the decision is spelled only where the definition admits more
 * than a win; a ranking carries its places.
 */
const ballotOfRow = (row: BallotRow, definition: BallotDefinition): Ballot => {
  const spellsDecision =
    definition.decision.kind === 'winner' &&
    (definition.decision.tie || definition.decision.doubleLoss);
  return {
    rubricVersion: row.rubricVersion,
    ...(row.decision === 'ranking'
      ? { ranking: row.ranking ?? [] }
      : {
          ...(spellsDecision ? { decision: row.decision } : {}),
          winner: row.winner,
        }),
    ...(row.scores ? { scores: row.scores } : {}),
    ...(row.reason === null ? {} : { reason: row.reason }),
    ...(definition.written.feedback ? { feedback: row.feedback ?? {} } : {}),
    ...(row.speakerRanks ? { speakerRanks: row.speakerRanks } : {}),
    ...(row.citations ? { citations: row.citations } : {}),
  };
};

/** A stored ballot on the definition revision it was written on. */
const ballotBody = (
  row: BallotRow,
  definition: BallotDefinition,
  source: BallotDefinitionSource,
  subjects: BallotSubjects,
): Ballot => {
  if (source.kind === 'stored') {
    if (
      row.ballotDefinitionId !== source.id ||
      row.ballotDefinitionVersion !== source.version ||
      row.rubricVersion !== ballotDefinitionIdentity(definition)
    )
      throw createAppError(
        'INVARIANT',
        'Stored ballot differs from its frozen source',
      );
    return ballotSchemaFor(definition, subjects).parse(
      ballotOfRow(row, definition),
    ) as Ballot;
  }
  if (row.ballotDefinitionId !== null || row.ballotDefinitionVersion !== null)
    throw createAppError(
      'INVARIANT',
      'Daisy ballot has a foreign stored source',
    );
  return storedBallotSchemaFor(definition, subjects).parse(
    ballotOfRow(row, definition),
  ) as Ballot;
};

/** Only a human judge seated in this Round reads its own ballot and the frozen input. */
export const ownJudgeSeat = <
  P extends {
    readonly actorId: string;
    readonly seat: SeatRef;
    readonly kind: string;
  },
>(
  participants: readonly P[],
  actorId: string,
) =>
  participants.find(
    (p) => p.actorId === actorId && isJudgeSeat(p.seat) && p.kind === 'human',
  );

/**
 * A ballot's feedback narrowed to the one subject this reader is (their side,
 * or themselves when the ballot ranks speakers), if any.
 */
const feedbackFor = (
  feedback: Ballot['feedback'],
  subject: string | undefined,
): NonNullable<Ballot['feedback']> => {
  const text = subject ? feedback?.[subject] : undefined;
  return subject && text ? { [subject]: text } : {};
};

/**
 * The caller's own ballot, the frozen transcript for their judging seat, and
 * every ballot only once the Round has completed: no judge reads another's
 * ballot while judging is still open. Released ballots say whether a human or
 * the AI judged, never who, and carry only the reader's own feedback
 * (ADR 0071).
 */
export function ballotReadView(input: {
  readonly audience:
    | { readonly kind: 'ordinary' }
    | {
        readonly kind: 'event';
        readonly access: RoundBallotAccess;
        readonly screenings: ReadonlyMap<string, BallotScreeningRead>;
      };
  readonly status: string;
  readonly ownSeatId: string | undefined;
  /** The subject the reader's feedback is written under (`feedbackSubjectOf`). */
  readonly viewerSubject: string | undefined;
  readonly aiJudgeSeatIds: ReadonlySet<string>;
  /** The Round's frozen ballot definition and who its ballots are about. */
  readonly definition: BallotDefinition | null;
  readonly source: BallotDefinitionSource | null;
  readonly subjects: BallotSubjects;
  readonly rows: readonly BallotRow[];
  readonly frozen: FrozenRoundTranscript | null;
}) {
  const own = input.rows.find((b) => b.judgeParticipantId === input.ownSeatId);
  const { frozen } = input;
  const body = (row: BallotRow) => {
    if (!input.definition || !input.source)
      throw createAppError('INVARIANT', 'A ballot on a Round judged by nobody');
    return ballotBody(row, input.definition, input.source, input.subjects);
  };
  return {
    own: input.ownSeatId
      ? {
          participantId: input.ownSeatId,
          ballot: own ? body(own) : null,
          freezeRevision: own?.freezeRevision ?? null,
        }
      : null,
    freeze: frozen
      ? {
          revision: frozen.revision,
          frontier: frozen.frontier,
          frozenAt: frozen.frozenAt,
          completeness: frozen.completeness,
          utterances: frozen.utterances,
        }
      : null,
    ballots:
      input.status === 'completed' ||
      (input.audience.kind === 'event' && input.audience.access.unreleased)
        ? input.rows.flatMap((row) => {
            const original = body(row);
            const ballot =
              input.audience.kind === 'ordinary'
                ? original
                : eventBallotForAudience(
                    original,
                    input.audience.access,
                    input.audience.screenings.get(row.id) ?? null,
                  );
            if (Object.keys(ballot).length === 1) return [];
            const own = feedbackFor(ballot.feedback, input.viewerSubject);
            return {
              judge: input.aiJudgeSeatIds.has(row.judgeParticipantId)
                ? ('ai' as const)
                : ('human' as const),
              ...(input.audience.kind === 'event' &&
              input.audience.access.unreleased
                ? {
                    review: {
                      ballotId: row.id,
                      screening:
                        input.audience.screenings.get(row.id)?.status ??
                        'pending',
                    },
                  }
                : {}),
              ballot: {
                ...ballot,
                ...(ballot.feedback !== undefined
                  ? {
                      feedback:
                        input.audience.kind === 'event' &&
                        input.audience.access.unreleased
                          ? ballot.feedback
                          : own,
                    }
                  : {}),
              },
              reportableFeedbackId: Object.keys(own).length > 0 ? row.id : null,
            };
          })
        : [],
  };
}

import { listedWord } from './lifecycle-sql';
import { roundJudgeAssignments } from './schema/round-judge-assignments';
import { roundFinalizationJudgeAssignments } from './schema/round-finalization-judge-assignments';
import { roundSourceVoided } from './round-source-state';
import { and, eq, sql } from 'drizzle-orm';
import { parsedColumn } from './raw-rows';
import { z } from 'zod';
import { alias } from 'drizzle-orm/pg-core';
import { createAppError } from '@daisy/errors';
import { roundStatus } from '@daisy/protocol/round';
import { idSchema } from '@daisy/protocol/primitives';
import { isJudgeSeat, seatOrder, seatKinds } from '@daisy/protocol/seats';
import {
  roundCompetitionSourceSchema,
  type RoundCompetitionSource,
} from '@daisy/protocol/round-competition-source';
import { roundJudgingSchema } from '@daisy/protocol/ballot-definition';
import { roundRulesSchema } from '@daisy/protocol/format';
import { recordedEnding } from './recorded-ending';
import { seatOfColumns } from './seat-columns';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import { ballots } from './schema/ballots';
import {
  roundFinalizations,
  roundFinalizationBallots,
} from './schema/round-finalizations';
import type { Tx } from './tx';

/** Whether a finalized ballot still carries the digest it was finalized with. */
const ballotDigestUnchanged = z.boolean();

/** Caller authorizes the addressed source and holds its owning aggregate fences; this export has no private words. */
export const readRoundCompetitionSource = async (
  tx: Tx,
  input: { readonly roundId: string; readonly roomId: string },
): Promise<RoundCompetitionSource | null> => {
  idSchema.parse(input.roundId);
  idSchema.parse(input.roomId);
  const r = alias(rounds, 'r'),
    z = alias(roundFinalizations, 'z');
  const [frame] = await tx
    .select({
      formatId: r.formatId,
      formatVersion: r.formatVersion,
      rules: r.rulesSnapshot,
      judging: r.judging,
      commandId: z.commandId,
      resultingVersion: z.resultingVersion,
      freezeRevision: z.freezeRevision,
      ending: recordedEnding,
    })
    .from(r)
    .innerJoin(z, eq(z.roundId, r.id))
    .where(
      and(
        eq(r.id, input.roundId),
        eq(r.roomId, input.roomId),
        eq(r.status, roundStatus.completed),
        sql`not ${roundSourceVoided(r.id)}`,
      ),
    )
    .for('share', { of: r });
  if (!frame || frame.ending !== 'judged' || frame.freezeRevision === null)
    return null;
  const rules = roundRulesSchema.parse(frame.rules);
  const judging = roundJudgingSchema.unwrap().parse(frame.judging);
  const lineageRows = await tx
    .select({
      slot: roundJudgeAssignments.slot,
      version: roundJudgeAssignments.version,
      participantId: roundJudgeAssignments.participantId,
      actorId: roundJudgeAssignments.actorId,
      source: roundJudgeAssignments.source,
      commandId: roundJudgeAssignments.commandId,
      recordedAt: roundJudgeAssignments.recordedAt,
    })
    .from(roundFinalizationJudgeAssignments)
    .innerJoin(
      roundJudgeAssignments,
      and(
        eq(
          roundJudgeAssignments.roundId,
          roundFinalizationJudgeAssignments.roundId,
        ),
        eq(roundJudgeAssignments.slot, roundFinalizationJudgeAssignments.slot),
        sql`${roundJudgeAssignments.version}<=${roundFinalizationJudgeAssignments.assignmentVersion}`,
      ),
    )
    .where(eq(roundFinalizationJudgeAssignments.roundId, input.roundId))
    .orderBy(roundJudgeAssignments.slot, roundJudgeAssignments.version);
  const judgeAssignments = Array.from(
    { length: rules.seats.judges },
    (_, slot) => ({
      slot,
      versions: lineageRows
        .filter((row) => row.slot === slot)
        .map(({ slot: _slot, recordedAt, ...row }) => ({
          ...row,
          recordedAt: recordedAt.toISOString(),
        })),
    }),
  );
  const castRows = await tx
    .select({
      participantId: roundParticipants.id,
      actorId: roundParticipants.actorId,
      seatKind: roundParticipants.seatKind,
      side: roundParticipants.side,
      slot: roundParticipants.slot,
    })
    .from(roundParticipants)
    .where(
      and(
        eq(roundParticipants.roundId, input.roundId),
        sql`(${roundParticipants.seatKind}<>${listedWord(seatKinds, 'judge')} or exists(select 1 from round_finalization_judge_assignments a where a.round_id=${roundParticipants.roundId} and a.participant_id=${roundParticipants.id}))`,
      ),
    );
  const cast = castRows
    .map((row) => ({
      participantId: row.participantId,
      actorId: row.actorId,
      seat: seatOfColumns(row),
    }))
    .sort((left, right) => seatOrder(rules.sides)(left.seat, right.seat));
  // Select competitive columns only. The database computes the consumed-content digest;
  // no reason, feedback, citation or transcript text crosses this published output.
  const consumed = await tx
    .select({
      ballotId: ballots.id,
      judgeParticipantId: ballots.judgeParticipantId,
      rubricVersion: ballots.rubricVersion,
      decision: ballots.decision,
      winner: ballots.winner,
      ranking: ballots.ranking,
      scores: ballots.scores,
      speakerRanks: ballots.speakerRanks,
      ballotDefinitionId: ballots.ballotDefinitionId,
      ballotDefinitionVersion: ballots.ballotDefinitionVersion,
      submittedAt: ballots.submittedAt,
      contentDigest: roundFinalizationBallots.ballotDigest,
      unchanged: parsedColumn(
        ballotDigestUnchanged,
        sql`${roundFinalizationBallots.ballotDigest} = daisy_ballot_content_digest(${ballots})`,
      ),
    })
    .from(roundFinalizationBallots)
    .innerJoin(
      ballots,
      and(
        eq(ballots.id, roundFinalizationBallots.ballotId),
        eq(ballots.roundId, roundFinalizationBallots.roundId),
        eq(ballots.freezeRevision, roundFinalizationBallots.freezeRevision),
      ),
    )
    .where(
      and(
        eq(roundFinalizationBallots.roundId, input.roundId),
        eq(roundFinalizationBallots.freezeRevision, frame.freezeRevision),
      ),
    );
  const judges = cast.filter((person) => isJudgeSeat(person.seat));
  const validSource = (ballot: (typeof consumed)[number]) =>
    judging.source.kind === 'stored'
      ? ballot.ballotDefinitionId === judging.source.id &&
        ballot.ballotDefinitionVersion === judging.source.version
      : ballot.ballotDefinitionId === null &&
        ballot.ballotDefinitionVersion === null;
  if (
    !consumed.length ||
    new Set(consumed.map((ballot) => ballot.ballotId)).size !==
      consumed.length ||
    new Set(consumed.map((ballot) => ballot.judgeParticipantId)).size !==
      consumed.length ||
    consumed.some(
      (ballot) =>
        !ballot.unchanged ||
        !validSource(ballot) ||
        !judges.some(
          (judge) => judge.participantId === ballot.judgeParticipantId,
        ),
    )
  )
    throw createAppError(
      'INVARIANT',
      'The consumed competition source does not match its immutable witnesses',
    );
  const spellsDecision =
    judging.ballot.decision.kind === 'winner' &&
    (judging.ballot.decision.tie || judging.ballot.decision.doubleLoss);
  const panel = judges.map((judge) => {
    const ballot = consumed.find(
      (row) => row.judgeParticipantId === judge.participantId,
    );
    return {
      participantId: judge.participantId,
      ballot: ballot
        ? {
            kind: 'submitted',
            ballotId: ballot.ballotId,
            contentDigest: ballot.contentDigest,
            submittedAt: ballot.submittedAt.toISOString(),
            contribution: {
              rubricVersion: ballot.rubricVersion,
              ...(ballot.decision === 'ranking'
                ? { ranking: ballot.ranking }
                : {
                    ...(spellsDecision ? { decision: ballot.decision } : {}),
                    winner: ballot.winner,
                  }),
              ...(ballot.scores === null ? {} : { scores: ballot.scores }),
              ...(ballot.speakerRanks === null
                ? {}
                : { speakerRanks: ballot.speakerRanks }),
            },
          }
        : { kind: 'no_ruling' },
    };
  });
  const parsed = roundCompetitionSourceSchema.safeParse({
    version: 1,
    format: { formatId: frame.formatId, formatVersion: frame.formatVersion },
    source: {
      roundId: input.roundId,
      freezeRevision: frame.freezeRevision,
      finalization: {
        commandId: frame.commandId,
        resultingVersion: frame.resultingVersion,
      },
      rules,
      judging,
      judgeAssignments,
    },
    cast,
    panel,
  });
  if (!parsed.success)
    throw createAppError(
      'INVARIANT',
      'The published Round competition source is invalid',
      parsed.error,
    );
  return parsed.data;
};

/** Room's published competitive progress, used only while creating a result. */
export const readRoomCompetitionProgress = async (tx: Tx, roomId: string) => {
  const [round] = await tx
    .select({ id: rounds.id, status: rounds.status })
    .from(rounds)
    .where(eq(rounds.roomId, roomId))
    .orderBy(sql`${rounds.createdAt} desc`)
    .limit(1)
    .for('share');
  return round
    ? {
        round,
        competition: await readRoundCompetitionSource(tx, {
          roomId,
          roundId: round.id,
        }),
      }
    : null;
};

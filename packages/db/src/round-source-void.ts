import { rounds } from './schema/rounds';
import { appendRoundPhaseChanged } from './round-projection-writer';
import { createAppError, createRefusal } from '@daisy/errors';
import {
  isRoundRunning,
  idSchema,
  type RoundProjection,
  type RoundCommandReceipt,
} from '@daisy/protocol';
import { eq, sql } from 'drizzle-orm';
import { hydrateRoundRows, type RoundHydration } from './round-hydration';
import {
  requireFencedParticipants,
  requireSameCommand,
} from './round-command-replay';
import {
  lockedRoundVersion,
  insertCommandRow,
} from './round-projection-writer';
import { commitRoundCommand } from './round-command-commit';
import { readDatabaseTime } from './database-clock';
import { endOpenJudgingJobs, type JudgingEndRule } from './round-judging-end';
import { roundCommands } from './schema/round-commands';
import type { Tx } from './tx';
import { run } from './raw-rows';

/**
 * Internal ordinary owner port. The caller owns canonical account, source-parent and Room fences.
 * A live source stops through the ordinary projection writer; a historical ending stays intact.
 * Authorization is evaluated again on replay from the protected current context.
 */
export async function voidLockedRoundSource(
  tx: Tx,
  input: {
    readonly roundId: string;
    readonly commandId: string;
    readonly actorId: string;
    readonly payloadDigest: string;
    readonly expectedVersion: number;
    readonly fencedActorIds: readonly string[];
    readonly authorize: (context: {
      readonly round: RoundHydration;
      readonly now: string;
    }) => void;
    readonly stopProjection: (context: {
      readonly round: RoundHydration;
      readonly now: string;
    }) => RoundProjection;
    readonly judgingEndReason: JudgingEndRule;
  },
): Promise<RoundCommandReceipt> {
  if (
    ![input.roundId, input.commandId, input.actorId].every(
      (id) => idSchema.safeParse(id).success,
    ) ||
    !/^[a-f0-9]{64}$/.test(input.payloadDigest)
  )
    throw createAppError('VALIDATION');
  const current = await lockedRoundVersion(tx, input.roundId);
  const round = await hydrateRoundRows(tx, input.roundId);
  if (!round) throw createAppError('NOT_FOUND');
  requireFencedParticipants(round.participants, input.fencedActorIds);
  if (!input.fencedActorIds.includes(input.actorId))
    throw createAppError('CONFLICT');
  const now = (await readDatabaseTime(tx)).toISOString();
  input.authorize({ round, now });
  const [previous] = await tx
    .select()
    .from(roundCommands)
    .where(eq(roundCommands.commandId, input.commandId));
  if (previous) {
    if (previous.type !== 'stop' && previous.type !== 'void_source')
      throw createRefusal('CONFLICT', 'command-conflict');
    requireSameCommand(previous, {
      roundId: input.roundId,
      actorId: input.actorId,
      serviceId: null,
      payloadDigest: input.payloadDigest,
      type: previous.type,
    });
    await run(
      tx,
      sql`select public.daisy_mark_round_source_void(${input.roundId},${input.commandId})`,
    );
    return {
      commandId: previous.commandId,
      roundId: previous.roundId,
      resultingVersion: previous.resultingVersion,
      replayed: true,
    };
  }
  if (current.version !== input.expectedVersion)
    throw createRefusal('CONFLICT', 'stale-version');
  let receipt: RoundCommandReceipt;
  if (isRoundRunning(current.status)) {
    const projection = input.stopProjection({ round, now });
    if (
      projection.round?.status !== 'abandoned' ||
      projection.round.outcome !== null
    )
      throw createAppError(
        'INVARIANT',
        'A source stop must abandon its live ordinary Round',
      );
    receipt = await commitRoundCommand(tx, {
      roundId: input.roundId,
      current,
      projection,
      now,
      command: {
        commandId: input.commandId,
        actorId: input.actorId,
        serviceId: null,
        payloadDigest: input.payloadDigest,
        type: 'stop',
      },
    });
    await endOpenJudgingJobs(tx, {
      roundId: input.roundId,
      ending: 'abandoned',
      now,
      judgingEndReason: input.judgingEndReason,
    });
  } else {
    await tx
      .update(rounds)
      .set({ version: current.version + 1, updatedAt: new Date(now) })
      .where(eq(rounds.id, input.roundId));
    receipt = {
      commandId: input.commandId,
      roundId: input.roundId,
      resultingVersion: current.version + 1,
      replayed: false,
    };
    await insertCommandRow(
      tx,
      input.roundId,
      {
        commandId: input.commandId,
        actorId: input.actorId,
        serviceId: null,
        payloadDigest: input.payloadDigest,
        type: 'void_source',
        result: { ...receipt, kind: 'round_source_void' },
      },
      current.version + 1,
    );
  }
  await run(
    tx,
    sql`select public.daisy_mark_round_source_void(${input.roundId},${input.commandId})`,
  );
  if (!isRoundRunning(current.status))
    await appendRoundPhaseChanged(tx, input.roundId, receipt.resultingVersion);
  return receipt;
}

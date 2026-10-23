import {
  fenceRoundWrite,
  readRoundWriteContext,
  roundPrincipalColumns,
  requireHumanRoundPrincipal,
} from './round-write-authority';
import {
  executeLockedRoundTick,
  type LockedRoundTickInput,
} from './round-clock-transaction';
import { writeSpeakingProjection } from './round-speaking-writer';
import { createAppError } from '@daisy/errors';
import {
  roundCommandEnvelopeSchema,
  idSchema,
  type RoundCommandEnvelope,
  type RoundCommandPrincipal,
  type RoundCommandReceipt,
  type RoundCommandAuthority,
  type RoundProjection,
} from '@daisy/protocol';
import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { RoundHydration } from './round-hydration';
import {
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
  insertCommandRow,
} from './round-projection-writer';
import { roundCommands } from './schema/round-commands';
import { instrumented, type DatabaseEventSink } from './instrumented';
import {
  requireCommandInput,
  requireFencedParticipants,
  requireSameCommand,
} from './round-command-replay';

type Tx = Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];
/** Facts read after authorization and Round fences; callbacks are pure and synchronous. */
export type LockedRoundCommandContext = {
  readonly round: RoundHydration;
  readonly authority: RoundCommandAuthority;
  readonly now: string;
};
type CommandInput = {
  readonly roundId: string;
  readonly envelope: RoundCommandEnvelope;
  readonly principal: RoundCommandPrincipal;
  readonly payloadDigest: string;
  /** Also runs on replay: a stored receipt is never an authorization grant. */
  readonly authorize: (context: LockedRoundCommandContext) => void;
  readonly buildProjection: (
    context: LockedRoundCommandContext,
  ) => RoundProjection;
};

async function replayCommand(
  tx: Tx,
  input: CommandInput,
): Promise<RoundCommandReceipt | null> {
  const { actorId, serviceId } = roundPrincipalColumns(input.principal);
  const [previous] = await tx
    .select()
    .from(roundCommands)
    .where(eq(roundCommands.commandId, input.envelope.commandId));
  if (previous) {
    requireSameCommand(previous, {
      roundId: input.roundId,
      actorId,
      serviceId,
      payloadDigest: input.payloadDigest,
      type: input.envelope.command.type,
    });
    return {
      commandId: previous.commandId,
      roundId: previous.roundId,
      resultingVersion: previous.resultingVersion,
      replayed: true,
    };
  }
  return null;
}

export const roundCommandOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** Internal time-only producer; no public route or read invokes this operation. */
  async executeRoundTick(input: LockedRoundTickInput) {
    if (!idSchema.safeParse(input.roundId).success)
      throw createAppError('VALIDATION');
    return instrumented(eventSink, 'executeRoundTick', () =>
      database.transaction((tx) => executeLockedRoundTick(tx, input)),
    );
  },
  async executeRoundCommand(input: CommandInput): Promise<RoundCommandReceipt> {
    requireCommandInput(input, roundCommandEnvelopeSchema);
    return instrumented(eventSink, 'executeRoundCommand', () =>
      database.transaction(async (tx) => {
        const fenced = await fenceRoundWrite(tx, {
          ...input,
          commandId: input.envelope.commandId,
        });
        const current = await lockedRoundVersion(tx, input.roundId);
        const context = await readRoundWriteContext(
          tx,
          { ...input, commandId: input.envelope.commandId },
          fenced.accounts,
        );
        requireFencedParticipants(context.round.participants, fenced.actorIds);
        requireHumanRoundPrincipal(input.principal, fenced.accounts);
        input.authorize(context);
        const { actorId, serviceId } = roundPrincipalColumns(input.principal);
        const replay = await replayCommand(tx, input);
        if (replay) return replay;
        if (current.version !== input.envelope.expectedVersion)
          throw createAppError('CONFLICT', 'stale-version');
        const projection = input.buildProjection(context);
        const changed = await writeProjectionWithPhaseSignal(
          tx,
          input.roundId,
          current,
          projection,
          context.now,
        );
        const resultingVersion = current.version + (changed ? 1 : 0);
        const receipt = {
          commandId: input.envelope.commandId,
          roundId: input.roundId,
          resultingVersion,
          replayed: false,
        };
        await insertCommandRow(
          tx,
          input.roundId,
          {
            commandId: input.envelope.commandId,
            actorId,
            serviceId,
            type: input.envelope.command.type,
            payloadDigest: input.payloadDigest,
            result: { ...receipt },
          },
          resultingVersion,
        );
        await writeSpeakingProjection(tx, {
          roundId: input.roundId,
          projection,
          resultingVersion,
          commandId: input.envelope.commandId,
        });
        return receipt;
      }),
    );
  },
});

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
import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { lockAuthorizationActors } from './authorization';
import { hydrateRoundRows, type RoundHydration } from './round-hydration';
import { actorFact } from './room-command-facts';
import {
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
  insertCommandRow,
} from './round-projection-writer';
import { rounds } from './schema/rounds';
import { roundCommands } from './schema/round-commands';
import { roundParticipants } from './schema/round-participants';
import { agentRuns } from './schema/agent-runs';
import { instrumented, type DatabaseEventSink } from './instrumented';

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

async function commandContext(
  tx: Tx,
  input: CommandInput,
  accounts: Awaited<ReturnType<typeof lockAuthorizationActors>>,
): Promise<LockedRoundCommandContext> {
  const round = await hydrateRoundRows(tx, input.roundId);
  if (!round) throw createAppError('NOT_FOUND');
  const [row] = await tx
    .select({ hostActorId: rounds.createdByActorId })
    .from(rounds)
    .where(eq(rounds.id, input.roundId));
  const participants = await Promise.all(
    round.participants.map(async (seat) => {
      const actor = await actorFact(tx, seat.actorId);
      if (!actor) throw createAppError('AUTHORIZATION');
      const account = accounts.find((a) => a?.actorId === seat.actorId);
      return {
        ...seat,
        kind: actor.kind,
        eligible:
          actor.kind === 'bot'
            ? actor.eligible
            : account?.member === true && !account.erased,
      };
    }),
  );
  let agentRun: LockedRoundCommandContext['authority']['agentRun'] = null;
  if (input.principal.kind === 'agent') {
    const [run] = await tx
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.id, input.principal.agentRunId),
          eq(agentRuns.roundParticipantId, input.principal.participantId),
        ),
      )
      .for('share');
    if (run)
      agentRun = {
        id: run.id,
        participantId: run.roundParticipantId,
        serviceId: `agent-run:${run.id}`,
        active: run.endedAt === null,
      };
  }
  // This separate statement follows every lock wait above.
  const [clock] = (await tx.execute(
    sql`select clock_timestamp() as now`,
  )) as unknown as { now: Date }[];
  if (!clock) throw createAppError('INFRASTRUCTURE');
  return {
    round,
    authority: {
      roundId: round.id,
      hostActorId: row?.hostActorId ?? null,
      participants,
      agentRun,
    },
    now: clock.now.toISOString(),
  };
}

const commandPrincipalColumns = (principal: RoundCommandPrincipal) => ({
  actorId: principal.kind === 'human' ? principal.actorId : null,
  serviceId: principal.kind === 'agent' ? principal.serviceId : null,
});
function requireHumanPrincipal(
  principal: RoundCommandPrincipal,
  accounts: Awaited<ReturnType<typeof lockAuthorizationActors>>,
) {
  if (principal.kind !== 'human') return;
  const account = accounts.find((a) => a?.actorId === principal.actorId);
  if (!account?.member || account.erased) throw createAppError('AUTHORIZATION');
}
async function fenceCommand(tx: Tx, input: CommandInput) {
  // Global command id lock serializes replays even when a reused id names another Round.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.envelope.commandId}, 59002))`,
  );
  const initialSeats = await tx
    .select({ actorId: roundParticipants.actorId })
    .from(roundParticipants)
    .where(eq(roundParticipants.roundId, input.roundId));
  const [initialRound] = await tx
    .select({ hostActorId: rounds.createdByActorId })
    .from(rounds)
    .where(eq(rounds.id, input.roundId));
  if (!initialRound) throw createAppError('NOT_FOUND');
  const principalActor =
    input.principal.kind === 'human' ? input.principal.actorId : null;
  const fenced = [
    ...new Set([
      ...initialSeats.map((p) => p.actorId),
      ...(initialRound.hostActorId ? [initialRound.hostActorId] : []),
      ...(principalActor ? [principalActor] : []),
    ]),
  ];
  const accounts = fenced.length
    ? await lockAuthorizationActors(tx, fenced, { maxActors: fenced.length })
    : [];
  return { actorIds: fenced, accounts };
}
async function replayCommand(
  tx: Tx,
  input: CommandInput,
): Promise<RoundCommandReceipt | null> {
  const { actorId, serviceId } = commandPrincipalColumns(input.principal);
  const [previous] = await tx
    .select()
    .from(roundCommands)
    .where(eq(roundCommands.commandId, input.envelope.commandId));
  if (previous) {
    if (
      previous.roundId !== input.roundId ||
      previous.actorId !== actorId ||
      previous.serviceId !== serviceId ||
      previous.payloadDigest !== input.payloadDigest ||
      previous.type !== input.envelope.command.type
    )
      throw createAppError('CONFLICT', 'command-conflict');
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
  async executeRoundCommand(input: CommandInput): Promise<RoundCommandReceipt> {
    if (
      !idSchema.safeParse(input.roundId).success ||
      !roundCommandEnvelopeSchema.safeParse(input.envelope).success ||
      !/^[0-9a-f]{64}$/.test(input.payloadDigest)
    )
      throw createAppError('VALIDATION');
    return instrumented(eventSink, 'executeRoundCommand', () =>
      database.transaction(async (tx) => {
        const fenced = await fenceCommand(tx, input);
        const current = await lockedRoundVersion(tx, input.roundId);
        const context = await commandContext(tx, input, fenced.accounts);
        if (
          context.round.participants.some(
            (p) => !fenced.actorIds.includes(p.actorId),
          )
        )
          throw createAppError('CONFLICT');
        requireHumanPrincipal(input.principal, fenced.accounts);
        input.authorize(context);
        const { actorId, serviceId } = commandPrincipalColumns(input.principal);
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

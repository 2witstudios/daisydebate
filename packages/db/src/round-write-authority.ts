import {
  lockRoundCommandWorker,
  roundCommandWorkerActive,
} from './round-command-worker';
import { createAppError } from '@daisy/errors';
import type {
  RoundCommandPrincipal,
  RoundCommandAuthority,
} from '@daisy/protocol';
import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { lockAuthorizationActors } from './authorization';
import { hydrateRoundRows } from './round-hydration';
import { actorFact } from './room-command-facts';
import { sampleRoundExecutionTime } from './round-execution-time';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import { agentRuns } from './schema/agent-runs';
import { fencedActorIds, seatEligibility } from './seat-eligibility';
export type RoundWriteTransaction = Pick<
  BunSQLDatabase,
  'select' | 'insert' | 'update' | 'execute'
>;
type Tx = RoundWriteTransaction;
export type RoundWriteScope = {
  readonly roundId: string;
  readonly principal: RoundCommandPrincipal;
  readonly commandId: string;
};
export async function readRoundWriteContext(
  tx: Tx,
  input: RoundWriteScope,
  accounts: Awaited<ReturnType<typeof lockAuthorizationActors>>,
  purpose: 'command' | 'ballot' = 'command',
) {
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
      return { ...seat, ...seatEligibility(actor, accounts, seat.actorId) };
    }),
  );
  let agentRun: RoundCommandAuthority['agentRun'] = null;
  let runKind: string | null = null;
  let runConfiguration: Record<string, unknown> | null = null;
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
    if (run) {
      runKind = run.kind;
      runConfiguration = run.configurationSnapshot;
      agentRun = {
        id: run.id,
        participantId: run.roundParticipantId,
        serviceId: `agent-run:${run.id}`,
        active: run.endedAt === null,
      };
    }
  }
  const claim =
    purpose === 'ballot'
      ? null
      : await lockRoundCommandWorker(tx, input.principal);
  const now = await sampleRoundExecutionTime(tx);
  return {
    round,
    runKind,
    runConfiguration,
    authority: {
      roundId: round.id,
      hostActorId: row?.hostActorId ?? null,
      principalAccess: principalAccessOf(input.principal, accounts),
      participants,
      agentRun: commandRunAuthority(agentRun, purpose, {
        principal: input.principal,
        claim,
        kind: runKind,
        configuration: runConfiguration,
        round,
        now,
      }),
    },
    now,
  };
}

/** The commanding human's own fenced access facts; the evaluator decides. */
function principalAccessOf(
  principal: RoundCommandPrincipal,
  accounts: Awaited<ReturnType<typeof lockAuthorizationActors>>,
): RoundCommandAuthority['principalAccess'] {
  if (principal.kind !== 'human') return null;
  const account = accounts.find((a) => a?.actorId === principal.actorId);
  return account
    ? { beta: account.beta?.state ?? null, ageBand: account.ageBand }
    : { beta: null, ageBand: null };
}

export const roundPrincipalColumns = (principal: RoundCommandPrincipal) => ({
  actorId: principal.kind === 'human' ? principal.actorId : null,
  serviceId: principal.kind === 'agent' ? principal.serviceId : null,
});
export function requireHumanRoundPrincipal(
  principal: RoundCommandPrincipal,
  accounts: Awaited<ReturnType<typeof lockAuthorizationActors>>,
) {
  if (principal.kind !== 'human') return;
  const account = accounts.find((a) => a?.actorId === principal.actorId);
  if (!account?.member || account.erased) throw createAppError('AUTHORIZATION');
}
export async function fenceRoundWrite(tx: Tx, input: RoundWriteScope) {
  // Global command id lock serializes replays even when a reused id names another Round.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.commandId}, 59002))`,
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
  const fenced = fencedActorIds(
    initialSeats,
    initialRound.hostActorId,
    principalActor,
  );
  const accounts = fenced.length
    ? await lockAuthorizationActors(tx, fenced, { maxActors: fenced.length })
    : [];
  return { actorIds: fenced, accounts };
}

/** A ballot keeps its run as read; a command run is active only while its worker is. */
export function commandRunAuthority(
  agentRun: RoundCommandAuthority['agentRun'],
  purpose: 'command' | 'ballot',
  context: Parameters<typeof roundCommandWorkerActive>[0],
) {
  if (!agentRun || purpose === 'ballot') return agentRun;
  return {
    ...agentRun,
    active: agentRun.active && roundCommandWorkerActive(context),
  };
}

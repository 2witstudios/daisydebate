import { and, eq, isNull, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { BoundedTransactionContext } from './transaction-context';
import { lockAuthorizationActors } from './authorization';
import { hydrateRoundRows } from './round-hydration';
import { actors } from './schema/actors';
import { agentRuns } from './schema/agent-runs';
import { botProfiles } from './schema/bot-profiles';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';

async function lockRoundAgentAccounts(
  tx: BoundedTransactionContext,
  roundId: string,
) {
  const seats = await tx
    .select({ actorId: actors.id, kind: actors.kind })
    .from(roundParticipants)
    .innerJoin(actors, eq(actors.id, roundParticipants.actorId))
    .where(eq(roundParticipants.roundId, roundId));
  const [initial] = await tx
    .select({ creator: rounds.createdByActorId })
    .from(rounds)
    .where(eq(rounds.id, roundId));
  if (!initial) throw createAppError('NOT_FOUND');
  const humans = [
    ...new Set([
      ...seats
        .filter((seat) => seat.kind === 'human')
        .map((seat) => seat.actorId),
      ...(initial.creator ? [initial.creator] : []),
    ]),
  ];
  if (humans.length) {
    const facts = await lockAuthorizationActors(tx, humans, { maxActors: 257 });
    if (facts.some((fact) => !fact?.member || fact.erased))
      throw createAppError('AUTHORIZATION');
  }
}

/** Account fences precede the Round; callers then lock run and job/claim in that order. */
export async function lockRoundAgentContext(
  tx: BoundedTransactionContext,
  roundId: string,
  participantId: string,
) {
  if (![roundId, participantId].every((id) => idSchema.safeParse(id).success))
    throw createAppError('VALIDATION');
  await lockRoundAgentAccounts(tx, roundId);
  const [locked] = await tx
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .for('update');
  if (!locked || locked.status === 'completed' || locked.status === 'abandoned')
    throw createAppError('CONFLICT');
  const round = await hydrateRoundRows(tx, roundId);
  const seat = round?.participants.find(
    (candidate) => candidate.id === participantId,
  );
  if (!round || !seat) throw createAppError('AUTHORIZATION');
  const [bot] = await tx
    .select({ id: actors.id })
    .from(actors)
    .innerJoin(botProfiles, eq(botProfiles.actorId, actors.id))
    .where(and(eq(actors.id, seat.actorId), eq(actors.kind, 'bot')))
    .for('share');
  if (!bot) throw createAppError('AUTHORIZATION');
  return { round, seat };
}
export async function roundAgentNow(
  tx: Pick<BoundedTransactionContext, 'execute'>,
) {
  const rows = await tx.execute(sql`select clock_timestamp() as now`);
  const now = (rows[0] as { now: Date } | undefined)?.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw createAppError('INFRASTRUCTURE');
  return now;
}
/** Called only within an already fenced Round transaction; no standalone authority bypass. */
export async function startLockedRoundAgentRun(
  tx: BoundedTransactionContext,
  input: {
    readonly id: string;
    readonly participantId: string;
    readonly kind: 'speech' | 'cross_ex' | 'judging';
    readonly model: string;
    readonly configuration: Record<string, string | number | boolean>;
  },
) {
  if (
    ![input.id, input.participantId].every(
      (id) => idSchema.safeParse(id).success,
    )
  )
    throw createAppError('VALIDATION');
  await tx.insert(agentRuns).values({
    id: input.id,
    roundParticipantId: input.participantId,
    kind: input.kind,
    model: input.model,
    provider: 'openrouter',
    configurationSnapshot: input.configuration,
    startedAt: sql`clock_timestamp()`,
  });
}
export async function endLockedRoundAgentRun(
  tx: BoundedTransactionContext,
  id: string,
  participantId: string,
) {
  await tx
    .update(agentRuns)
    .set({ endedAt: sql`clock_timestamp()` })
    .where(
      and(
        eq(agentRuns.id, id),
        eq(agentRuns.roundParticipantId, participantId),
        isNull(agentRuns.endedAt),
      ),
    );
}

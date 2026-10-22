import { and, eq, sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  requireBotControlSegment,
  requireClaimScope,
  requireRunScope,
} from './bot-publication-context';
import { roundAgentNow } from './round-agent-runs';
import { agentRuns } from './schema/agent-runs';
import { roundBotPublications } from './schema/round-bot-publications';

type Reader = Pick<BunSQLDatabase, 'select' | 'execute'>;
type WorkerPrincipal = {
  readonly kind: 'agent';
  readonly serviceId: string;
  readonly agentRunId: string;
  readonly participantId: string;
  readonly publicationEpoch: number;
};
/** Trusted server principal only; caller already holds canonical account/Round fences. No bearer comes from a public body. */
export async function verifyBotWorkerPrincipalLocked(
  tx: Reader,
  principal: WorkerPrincipal,
  roundId: string,
) {
  if (
    ![roundId, principal.agentRunId, principal.participantId].every(
      (id) => idSchema.safeParse(id).success,
    ) ||
    !Number.isSafeInteger(principal.publicationEpoch) ||
    principal.publicationEpoch < 1
  )
    throw createAppError('VALIDATION');
  if (principal.serviceId !== `agent-run:${principal.agentRunId}`)
    throw createAppError('AUTHORIZATION');
  const [run] = await tx
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.id, principal.agentRunId),
        eq(agentRuns.roundParticipantId, principal.participantId),
      ),
    )
    .for('share');
  const [claim] = await tx
    .select()
    .from(roundBotPublications)
    .where(
      and(
        eq(roundBotPublications.roundId, roundId),
        eq(roundBotPublications.roundParticipantId, principal.participantId),
      ),
    )
    .for('share');
  if (!claim) throw createAppError('CONFLICT', 'Worker claim missing');
  const scope = {
    roundId,
    roundParticipantId: principal.participantId,
    segmentId: claim.segmentId,
    agentRunId: principal.agentRunId,
    serviceId: principal.serviceId,
    publicationEpoch: principal.publicationEpoch,
  };
  requireClaimScope(claim, scope);
  requireRunScope(run, scope);
  const now = await roundAgentNow(tx);
  if (claim.leaseExpiresAt.getTime() <= now.getTime())
    throw createAppError('CONFLICT', 'Worker lease expired');
  await requireBotControlSegment(tx, scope);
}
/** Missing control evidence postpones attendance; it never establishes competitive absence. */
export async function readBotControlHealth(
  tx: Pick<Reader, 'execute'>,
  roundId?: string,
) {
  const rows =
    await tx.execute(sql`with observed as materialized (select clock_timestamp() as at), eligible as (
    select p.id as seat,r.id as round_id from round_participants p
    join actors a on a.id=p.actor_id and a.kind='bot'
    join bot_profiles b on b.actor_id=a.id
    join rounds r on r.id=p.round_id and r.status='active'
    where p.role in ('affirmative','negative') ${roundId === undefined ? sql`` : sql`and r.id=${roundId}`}
  ), health as (
    select e.seat,exists(select 1 from round_bot_publications c
      join agent_runs run on run.id=c.agent_run_id and run.round_participant_id=e.seat
      join round_segments s on s.id=c.segment_id and s.round_id=e.round_id
      cross join observed n
      where c.round_id=e.round_id and c.round_participant_id=e.seat
        and c.lease_expires_at>n.at and c.service_id='agent-run:'||run.id
        and run.ended_at is null and run.kind=s.type
        and s.started_at<=n.at and s.ended_at is null and n.at<s.started_at+s.duration_ms*interval '1 millisecond'
        and run.configuration_snapshot->>'roundId'=e.round_id
        and run.configuration_snapshot->>'roundParticipantId'=e.seat
        and run.configuration_snapshot->>'segmentId'=s.id
        and run.configuration_snapshot->>'serviceId'=c.service_id
        and run.configuration_snapshot->>'publicationEpoch'=c.publication_epoch::text
    ) as healthy from eligible e
  ) select (select at from observed) as observed_at,count(*)::int as eligible,
    count(*) filter(where healthy)::int as healthy from health`);
  const row = rows[0] as {
    observed_at: Date;
    eligible: number;
    healthy: number;
  };
  return {
    healthy: row.eligible === row.healthy,
    eligibleSeats: row.eligible,
    healthySeats: row.healthy,
    observedAt: row.observed_at.toISOString(),
  };
}

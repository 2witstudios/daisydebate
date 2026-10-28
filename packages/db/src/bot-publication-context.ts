import { and, eq, ne, sql, type SQL } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransactionContext } from './transaction-context';
import { lockRoundAgentContext, roundAgentNow } from './round-agent-runs';
import { requireAgentLeaseToken } from './round-agent-lease';
import { agentRuns } from './schema/agent-runs';
import { transcriptSegments } from './schema/transcript-segments';
import {
  roundBotPublicationWindows,
  roundBotPublications,
} from './schema/round-bot-publications';

export type BotPublicationScope = {
  readonly roundId: string;
  readonly roundParticipantId: string;
  readonly segmentId: string;
  readonly agentRunId: string;
  readonly serviceId: string;
  readonly publicationEpoch: number;
};
export type PublicationWindow = {
  readonly beforeMs: number;
  readonly afterMs: number;
};
/**
 * Segment `s` is in progress over [`before`, `after`]: started, not ended,
 * and within its duration. The one definition of a live segment, for
 * publication's speaking window and hearing alike.
 */
/** Speaking interval `i` is open over [`before`, `after`]. */
const intervalOpen = (before: SQL, after: SQL) =>
  sql`i.started_at<=${before} and (i.ended_at is null or ${after}<i.ended_at)`;
const segmentInProgress = (before: SQL, after: SQL) =>
  sql`s.started_at<=${before} and ${after}<least(coalesce(s.ended_at,'infinity'::timestamptz),s.started_at+s.duration_ms*interval '1 millisecond')`;
/** Latest actual played scope authenticates control, including unresolved historical attendance. */
export async function requireBotControlSegment(
  tx: Pick<BoundedTransactionContext, 'execute'>,
  target: Pick<BotPublicationScope, 'roundId' | 'segmentId'>,
) {
  const rows = await tx.execute(sql`select 1 from round_segments s
    where s.round_id=${target.roundId} and s.id=${target.segmentId}
      and s.started_at<=clock_timestamp()
      and not exists(select 1 from round_segments later where later.round_id=s.round_id
        and later.sequence>s.sequence and later.started_at is not null) limit 1`);
  if (rows.length !== 1)
    throw createAppError('CONFLICT', 'Worker segment changed');
}
export async function requireBotSpeakingWindow(
  tx: BoundedTransactionContext,
  target: Pick<
    BotPublicationScope,
    'roundId' | 'roundParticipantId' | 'segmentId'
  >,
  window?: PublicationWindow,
) {
  if (
    window &&
    (!Number.isFinite(window.beforeMs) ||
      !Number.isFinite(window.afterMs) ||
      window.afterMs < window.beforeMs)
  )
    throw createAppError('VALIDATION');
  const before = window
    ? sql`${new Date(Math.floor(window.beforeMs))}::timestamptz`
    : sql`clock_timestamp()`;
  const after = window
    ? sql`${new Date(Math.ceil(window.afterMs))}::timestamptz`
    : sql`clock_timestamp()`;
  const rows = await tx.execute(sql`select 1 from round_speaking_intervals i
    join round_segments s on s.id=i.segment_id and s.round_id=i.round_id
    where i.round_id=${target.roundId} and i.segment_id=${target.segmentId} and i.round_participant_id=${target.roundParticipantId}
      and ${intervalOpen(before, after)}
      and ${segmentInProgress(before, after)}
      and ${after}<=clock_timestamp() limit 1`);
  if (rows.length !== 1)
    throw createAppError('CONFLICT', 'Bot speaking authority changed');
}
/**
 * The claim's segment is in progress at the server's instant: a listen-only
 * hearing lives within its segment, as publication lives within a speaking
 * window.
 */
async function requireBotSegmentLive(
  tx: BoundedTransactionContext,
  target: Pick<BotPublicationScope, 'roundId' | 'segmentId'>,
) {
  const now = sql`clock_timestamp()`;
  const rows = await tx.execute(sql`select 1 from round_segments s
    where s.round_id=${target.roundId} and s.id=${target.segmentId}
      and ${segmentInProgress(now, now)} limit 1`);
  if (rows.length !== 1)
    throw createAppError('CONFLICT', 'Bot segment is not live');
}
/**
 * The claim's segment and floor in one read, for the media projection:
 * `null` when the segment is not live, else whether the seat holds an open
 * speaking interval in it now.
 */
export async function readBotSegmentFloor(
  tx: BoundedTransactionContext,
  target: Pick<
    BotPublicationScope,
    'roundId' | 'roundParticipantId' | 'segmentId'
  >,
) {
  const now = sql`clock_timestamp()`;
  const [row] =
    await tx.execute(sql`select exists(select 1 from round_speaking_intervals i
      where i.round_id=s.round_id and i.segment_id=s.id and i.round_participant_id=${target.roundParticipantId}
        and ${intervalOpen(now, now)}) as floor
    from round_segments s
    where s.round_id=${target.roundId} and s.id=${target.segmentId}
      and ${segmentInProgress(now, now)} limit 1`);
  return row ? { floor: (row as { floor: boolean }).floor === true } : null;
}
/** A bot seat asking for media: to publish, or (`hearing`) only to listen. */
export type BotMediaPrincipal = {
  readonly kind: 'bot';
  readonly scope: BotPublicationScope;
  readonly token: string;
  /**
   * The seat's own listen-only hearing (ISSUE-764): admitted on its live
   * claim within its live segment. Only publication needs the floor.
   */
  readonly hearing?: true;
};
/** The one bot media admission rule: the live claim, then the floor to publish or a live segment to hear. */
export async function verifyBotMediaPrincipal(
  tx: BoundedTransactionContext,
  principal: BotMediaPrincipal,
) {
  await verifyLockedBotWorker(tx, principal.scope, principal.token);
  if (principal.hearing) await requireBotSegmentLive(tx, principal.scope);
  else await requireBotSpeakingWindow(tx, principal.scope);
}
/**
 * Records an authorized window as server credit (DEC-212, DEC-218), extending
 * the seat's run it touches, so a phrase is one row however many windows
 * authorized it. Call only after requireBotSpeakingWindow accepted it. A
 * sealed stream never required a later window, so its credit is refused
 * (ISSUE-488-r1); the Round lock the caller holds orders it against the seal.
 */
export async function creditBotPublicationWindow(
  tx: BoundedTransactionContext,
  target: Pick<
    BotPublicationScope,
    'roundId' | 'roundParticipantId' | 'segmentId'
  >,
  window: PublicationWindow,
  nextId: () => string,
) {
  const from = new Date(Math.floor(window.beforeMs)),
    until = new Date(Math.ceil(window.afterMs));
  if (until <= from) return;
  const [sealed] = await tx
    .select({ state: transcriptSegments.state })
    .from(transcriptSegments)
    .where(
      and(
        eq(transcriptSegments.segmentId, target.segmentId),
        eq(transcriptSegments.roundParticipantId, target.roundParticipantId),
        ne(transcriptSegments.state, 'open'),
      ),
    );
  if (sealed)
    throw createAppError('CONFLICT', 'Bot publication stream is sealed');
  const extended = await tx
    .update(roundBotPublicationWindows)
    .set({
      creditedFrom: sql`least(${roundBotPublicationWindows.creditedFrom},${from})`,
      creditedUntil: sql`greatest(${roundBotPublicationWindows.creditedUntil},${until})`,
    })
    .where(
      and(
        eq(roundBotPublicationWindows.segmentId, target.segmentId),
        eq(roundBotPublicationWindows.roundId, target.roundId),
        eq(
          roundBotPublicationWindows.roundParticipantId,
          target.roundParticipantId,
        ),
        sql`${roundBotPublicationWindows.creditedUntil}>=${from}`,
        sql`${roundBotPublicationWindows.creditedFrom}<=${until}`,
      ),
    )
    .returning({ id: roundBotPublicationWindows.id });
  if (extended.length > 0) return;
  await tx.insert(roundBotPublicationWindows).values({
    id: nextId(),
    ...target,
    creditedFrom: from,
    creditedUntil: until,
  });
}
export function requireClaimScope(
  claim: typeof roundBotPublications.$inferSelect | undefined,
  scope: BotPublicationScope,
): asserts claim is typeof roundBotPublications.$inferSelect {
  if (
    !claim ||
    claim.publicationEpoch !== scope.publicationEpoch ||
    claim.agentRunId !== scope.agentRunId ||
    claim.segmentId !== scope.segmentId
  )
    throw createAppError('CONFLICT');
}
export function requireRunScope(
  run: typeof agentRuns.$inferSelect | undefined,
  scope: BotPublicationScope,
): asserts run is typeof agentRuns.$inferSelect {
  if (
    !run ||
    run.endedAt !== null ||
    !['speech', 'cross_ex'].includes(run.kind)
  )
    throw createAppError('AUTHORIZATION');
  const keys = [
    'roundId',
    'roundParticipantId',
    'segmentId',
    'serviceId',
    'publicationEpoch',
  ] as const;
  if (keys.some((key) => run.configurationSnapshot[key] !== scope[key]))
    throw createAppError('AUTHORIZATION');
}
export async function verifyLockedBotWorker(
  tx: BoundedTransactionContext,
  scope: BotPublicationScope,
  token: string,
) {
  if (scope.serviceId !== `agent-run:${scope.agentRunId}`)
    throw createAppError('AUTHORIZATION');
  const context = await lockRoundAgentContext(
    tx,
    scope.roundId,
    scope.roundParticipantId,
  );
  if (context.round.status !== 'active' || context.seat.role === 'judge')
    throw createAppError('AUTHORIZATION');
  const [run] = await tx
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.id, scope.agentRunId),
        eq(agentRuns.roundParticipantId, scope.roundParticipantId),
      ),
    )
    .for('update');
  const [claim] = await tx
    .select()
    .from(roundBotPublications)
    .where(
      and(
        eq(roundBotPublications.roundId, scope.roundId),
        eq(roundBotPublications.roundParticipantId, scope.roundParticipantId),
      ),
    )
    .for('update');
  requireClaimScope(claim, scope);
  requireAgentLeaseToken(token, claim.leaseTokenDigest);
  const now = await roundAgentNow(tx);
  if (claim.leaseExpiresAt.getTime() <= now.getTime())
    throw createAppError('CONFLICT', 'Publication lease expired');
  requireRunScope(run, scope);
  return { ...context, run, claim, now };
}

import { CryptoHasher } from 'bun';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { RoundProjection } from '@daisy/protocol';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { DatabaseEventSink } from './instrumented';
import { commitRoundCommand } from './round-command-commit';
import { sampleRoundExecutionTime } from './round-execution-time';
import { hydrateRoundRows, type RoundHydration } from './round-hydration';
import { lockedRoundVersion } from './round-projection-writer';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';

type Tx = Pick<
  BunSQLDatabase,
  'select' | 'selectDistinct' | 'update' | 'insert' | 'execute'
>;

/** The engine's forfeit, injected; null once the debate has nothing left to forfeit. */
export type RoundForfeitRule = (input: {
  readonly round: RoundHydration;
  readonly actorId: string;
  readonly now: string;
  readonly nextSegmentId: () => string;
}) => RoundProjection | null;

/** The service a restriction's forfeit records instead of a member's command. */
const RESTRICTION_SERVICE = 'moderation-restriction';

/**
 * The Round's forfeit, or null for none. A corrupt Round must not stop a safety
 * action: nothing is written yet, so the sanction commits and the Round is
 * reported for repair, its debater still seated. A database failure here aborts
 * the transaction, so the next statement still fails and nothing half commits.
 */
async function decideForfeit(
  tx: Tx,
  roundId: string,
  actorId: string,
  now: string,
  context: {
    readonly nextId: () => string;
    readonly forfeit: RoundForfeitRule;
    readonly eventSink: DatabaseEventSink | undefined;
  },
): Promise<RoundProjection | null> {
  try {
    const round = await hydrateRoundRows(tx, roundId);
    return round
      ? context.forfeit({
          round,
          actorId,
          now,
          nextSegmentId: context.nextId,
        })
      : null;
  } catch {
    context.eventSink?.(
      'round.restriction.forfeit_failed',
      { roundId },
      'A restriction could not forfeit a corrupt Round',
    );
    return null;
  }
}

/**
 * What a restriction does to a member's started Rounds (DEC-331): each one they
 * debate in ends as a forfeit, recorded as any forfeit is, so rating and the
 * record read it the same. The Round lock comes after the subject's account
 * fence, as in a command. A judge's seat stays: judges never forfeit, and the
 * ballot deadline covers a judge who cannot rule.
 */
export async function forfeitMemberRounds(
  tx: Tx,
  actorId: string,
  context: {
    readonly nextId: () => string;
    readonly forfeit: RoundForfeitRule;
    readonly eventSink: DatabaseEventSink | undefined;
  },
): Promise<void> {
  const debating = await tx
    .selectDistinct({ id: rounds.id })
    .from(roundParticipants)
    .innerJoin(rounds, eq(rounds.id, roundParticipants.roundId))
    .where(
      and(
        eq(roundParticipants.actorId, actorId),
        ne(roundParticipants.role, 'judge'),
        inArray(rounds.status, ['opening', 'active']),
      ),
    )
    .orderBy(rounds.id);
  for (const { id: roundId } of debating) {
    const current = await lockedRoundVersion(tx, roundId);
    if (current.status !== 'opening' && current.status !== 'active') continue;
    const now = await sampleRoundExecutionTime(tx);
    const projection = await decideForfeit(tx, roundId, actorId, now, context);
    if (!projection) continue;
    await commitRoundCommand(tx, {
      roundId,
      current,
      projection,
      now,
      command: {
        commandId: context.nextId(),
        actorId: null,
        serviceId: RESTRICTION_SERVICE,
        type: 'forfeit',
        payloadDigest: new CryptoHasher('sha3-256')
          .update(JSON.stringify({ roundId, actorId, RESTRICTION_SERVICE }))
          .digest('hex'),
      },
    });
  }
}

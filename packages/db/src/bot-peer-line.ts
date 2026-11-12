import {
  and,
  eq,
  inArray,
  isNotNull,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import type { BotPublicationScope } from './bot-publication-context';
import { roundSegments } from './schema/round-segments';
import { utterances } from './schema/utterances';

/**
 * The hearing and capture each time audio against PostgreSQL on their own
 * calibration: a line may sit this far from the instant and still hold it.
 */
const CLOCK_SKEW_MS = 100;
/**
 * An authored line ends when its audio does, with no closing pause, on its
 * publisher's clock; the hearing names the instant a subscriber received
 * the last of it, later by the media hop. Its end is allowed this much.
 */
const AUTHORED_END_ALLOWANCE_MS = 500;

/**
 * Whether the line holding what a peer said at `at` is in the transcript, as
 * a line a bot's answer may build on (`readOrderedRoundUtterances` 'spoken').
 * That line covers the instant: a person's captured clip (the segment's
 * start plus the clip's offset, for its length), or a bot peer's authored
 * line, closed (its audio start, for its length). Covering, not merely
 * ending after: a clip's length includes the pause that ended it, so the
 * clip before a peer's last words can end after an instant inside them, but
 * it cannot start before and end after it. A bot answers a peer's words only
 * once they are in the transcript; it reads them, and never writes or
 * transcribes them.
 */
export async function peerLineCovers(
  tx: BoundedTransactionContext,
  scope: Pick<BotPublicationScope, 'roundId' | 'segmentId'>,
  peers: readonly string[],
  at: Date,
): Promise<boolean> {
  if (peers.length === 0) return false;
  const instant = sql`${at.toISOString()}::timestamptz`;
  const skew = sql`${CLOCK_SKEW_MS} * interval '1 millisecond'`;
  /** A stretch from `start` lasting `durationMs` that holds the instant. */
  const covers = (start: SQL, durationMs: AnyColumn, endAllowanceMs: number) =>
    sql`${start} <= ${instant} + ${skew} and ${start} + (${durationMs} + ${endAllowanceMs}) * interval '1 millisecond' >= ${instant}`;
  const [line] = await tx
    .select({ id: utterances.id })
    .from(utterances)
    .innerJoin(
      roundSegments,
      and(
        eq(roundSegments.id, utterances.segmentId),
        eq(roundSegments.roundId, utterances.roundId),
      ),
    )
    .where(
      and(
        eq(utterances.roundId, scope.roundId),
        eq(utterances.segmentId, scope.segmentId),
        inArray(utterances.roundParticipantId, [...peers]),
        or(
          and(
            isNotNull(utterances.captureTrackId),
            covers(
              sql`${roundSegments.startedAt} + ${utterances.captureStartOffsetMs} * interval '1 millisecond'`,
              utterances.captureDurationMs,
              CLOCK_SKEW_MS,
            ),
          ),
          // An authored line is dated at its audio start, and is history once closed.
          and(
            isNotNull(utterances.botPhraseId),
            eq(utterances.complete, true),
            covers(
              sql`${utterances.createdAt}`,
              utterances.botDurationMs,
              AUTHORED_END_ALLOWANCE_MS,
            ),
          ),
        ),
      ),
    )
    .limit(1);
  return line !== undefined;
}

import { mediaWindowClosed } from '@daisy/debate-engine/media-window';
import type { RoundStatus } from '@daisy/protocol';
import { floorBoundaries, type FloorClock } from './floor-clock';

/**
 * How many Rounds one process recovers at once. A pass runs its transactions one
 * at a time, each two connections of the 10 on the competitive lane (ADR 0088), and
 * browser reads share that lane, so recovery must leave it room.
 */
const MEDIA_RECOVERY_CONCURRENCY = 4;
/**
 * The longest a Round goes with no pass when nothing is due. It bounds what the
 * tick's one read cannot see: a revoked seat, and a room that drifted (ADR 0075).
 */
export const MEDIA_RECOVERY_HEARTBEAT_MS = 2_000;
/**
 * Past this with no pass, a Round outranks every other need, so sustained floor
 * work cannot starve a revocation. Above the 4508 ms p99 gap measured between a
 * Round's tick passes on the CI runner, so ordinary heartbeats do not reach it.
 */
const MEDIA_RECOVERY_OVERDUE_MS = 5_000;

/** One active session as the tick's single read returns it, read at `now`. */
export type RecoverySession = {
  readonly roundId: string;
  readonly now: string;
  readonly lastPassAt: string | null;
  readonly roundChangedAt: string;
  readonly roundStatus: RoundStatus;
  readonly finalSegmentEndedAt: string | null;
  readonly unsafe: boolean;
  /** The last pass finished its work; a failed one leaves the Round due. */
  readonly lastPassClean: boolean;
  /** A claim would succeed now: no live lease and past the minimum interval. */
  readonly claimable: boolean;
  readonly clock: FloorClock;
};
type RecoveryNeed = 'overdue' | 'floor' | 'repair' | 'heartbeat';

const boundaryPassed = (session: RecoverySession, lastPassMs: number) => {
  const nowMs = Date.parse(session.now);
  const { lastSegment, countdownMs } = session.clock;
  // Time alone can pass a speech's end and then its countdown with nothing committed.
  const afterOpenSpeech =
    lastSegment?.endedAt === null
      ? [
          Date.parse(lastSegment.startedAt) +
            lastSegment.durationMs +
            countdownMs,
        ]
      : [];
  return [...floorBoundaries(session.clock), ...afterOpenSpeech].some(
    (at) => at > lastPassMs && at <= nowMs,
  );
};
/** Why this session needs a pass now, or null when it costs nothing this tick. */
export const recoveryNeed = (
  session: RecoverySession,
  heartbeatMs: number,
): RecoveryNeed | null => {
  // Starting now would only poll the lease with a transaction every 25 ms.
  if (!session.claimable) return null;
  if (session.lastPassAt === null) return 'repair';
  const lastPassMs = Date.parse(session.lastPassAt);
  const sinceLastPassMs = Date.parse(session.now) - lastPassMs;
  if (sinceLastPassMs >= MEDIA_RECOVERY_OVERDUE_MS) return 'overdue';
  if (
    Date.parse(session.roundChangedAt) >= lastPassMs ||
    boundaryPassed(session, lastPassMs)
  )
    return 'floor';
  if (
    session.unsafe ||
    !session.lastPassClean ||
    mediaWindowClosed(
      session.roundStatus,
      session.now,
      session.finalSegmentEndedAt,
    )
  )
    return 'repair';
  return sinceLastPassMs >= heartbeatMs ? 'heartbeat' : null;
};
/**
 * Which sessions this tick starts, up to the free capacity. A session qualifies
 * with a need and no recovery running here. The order is: the Round overdue the
 * longest, then floors that must move, then the other overdue Rounds, oldest
 * first, then repairs, then heartbeats. So at most one overdue Round goes ahead
 * of a floor each tick, which keeps floors moving and still gives every overdue
 * Round its turn. With exactly one free slot and an overdue Round, that Round
 * takes the slot and a floor waits for the next tick.
 */
export const recoveryDue = <S extends RecoverySession>(
  sessions: readonly S[],
  running: ReadonlySet<string>,
  heartbeatMs: number,
  capacity: number = MEDIA_RECOVERY_CONCURRENCY,
): readonly S[] => {
  const needing = (need: RecoveryNeed) =>
    sessions.filter(
      (session) =>
        !running.has(session.roundId) &&
        recoveryNeed(session, heartbeatMs) === need,
    );
  // `filter` made this array, so sorting it in place touches nothing shared.
  const [longestOverdue, ...otherOverdue] = needing('overdue').sort(
    (a, b) => Date.parse(a.lastPassAt!) - Date.parse(b.lastPassAt!),
  );
  return [
    ...(longestOverdue ? [longestOverdue] : []),
    ...needing('floor'),
    ...otherOverdue,
    ...needing('repair'),
    ...needing('heartbeat'),
  ].slice(0, Math.max(0, capacity - running.size));
};

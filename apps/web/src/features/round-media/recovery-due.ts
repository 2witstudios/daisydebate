/**
 * How many Rounds one process recovers at once. A pass runs its transactions one
 * at a time, each two connections of the 10 on the competitive lane (ADR 0088), and
 * browser reads share that lane, so recovery must leave it room.
 */
const MEDIA_RECOVERY_CONCURRENCY = 4;

/**
 * Which sessions this tick starts: those with no recovery running here, in the
 * order given, up to the free capacity. Pure, so a tick's choice can be read.
 */
export const recoveryDue = <S extends { readonly roundId: string }>(
  sessions: readonly S[],
  running: ReadonlySet<string>,
  capacity: number = MEDIA_RECOVERY_CONCURRENCY,
): readonly S[] =>
  sessions
    .filter((session) => !running.has(session.roundId))
    .slice(0, Math.max(0, capacity - running.size));

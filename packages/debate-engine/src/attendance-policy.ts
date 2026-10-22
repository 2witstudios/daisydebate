import { createInvariantError } from '@daisy/errors';
import type { RoundRules } from '@daisy/protocol';
import { attendancePolicy } from './attendance';
import { debateInvariantIds } from './invariant-ids';
type AttendanceTimingPolicy = {
  readonly heartbeatMs: number;
  readonly reconnectBudgetMs: number;
  readonly graceMs: number;
  readonly commitBudgetMs: number;
  readonly finalizationBufferMs: number;
};
/** The compiler refuses bad configuration; runtime hydration also refuses corrupt frozen rules. */
export function assertAttendanceRules(
  rules: RoundRules,
  policy: AttendanceTimingPolicy = attendancePolicy,
): void {
  if (policy.graceMs < policy.heartbeatMs * 2 + policy.reconnectBudgetMs)
    throw createInvariantError(
      debateInvariantIds.graceCoversReconnect,
      'Check-in grace must cover reconnect allowance',
    );
  if (
    rules.segments.some(
      (segment) =>
        segment.type === 'speech' && segment.durationMs < policy.graceMs,
    )
  )
    throw createInvariantError(
      debateInvariantIds.speechCoversGrace,
      'Every speech must cover attendance grace',
    );
  if (policy.finalizationBufferMs <= policy.commitBudgetMs)
    throw createInvariantError(
      debateInvariantIds.finalizationBufferCoversCommit,
      'Finalization buffer must exceed check-in commit budget',
    );
}

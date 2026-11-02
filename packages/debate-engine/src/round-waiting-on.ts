import type { RoundWaitingFacts, RoundWaitingOn } from '@daisy/protocol';

/**
 * The one thing a played Round is waiting on, for every viewer's room. The
 * deadline is always a persisted one; no client ever invents a competitive
 * window. Null while the speeches are still running.
 */
export function roundWaitingOn(input: RoundWaitingFacts): RoundWaitingOn | null {
  if (!input.finalSegmentEnded) return null;
  if (input.heldByWriter) return { state: 'held_by_writer', deadlineAt: null };
  if (!input.frozen) return { state: 'closing_transcript', deadlineAt: null };
  if (
    input.humanJudgeUnruled &&
    input.ballotDeadlineAt !== null &&
    input.nowMs < Date.parse(input.ballotDeadlineAt)
  )
    return { state: 'human_window', deadlineAt: input.ballotDeadlineAt };
  const generating = input.jobs.filter(
    (job) => job.canRule && !job.holdsBallot,
  );
  if (generating.length > 0)
    return {
      state: 'ai_processing',
      deadlineAt: generating
        .map((job) => job.generationDeadlineAt)
        .sort()
        .at(-1)!,
    };
  if (input.attendanceUnresolved)
    return {
      state: 'awaiting_attendance',
      deadlineAt: input.attendanceCutoffAt,
    };
  if (input.jobs.some((job) => job.canRule && job.holdsBallot))
    return { state: 'settling', deadlineAt: null };
  return input.jobs.some((job) => !job.canRule)
    ? { state: 'ai_failed', deadlineAt: null }
    : { state: 'settling', deadlineAt: null };
}

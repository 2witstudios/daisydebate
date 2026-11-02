import type { RoundJudgingStatus } from '@daisy/protocol';

/**
 * The one thing a played Round is waiting on, for every viewer's room. The
 * deadline is always a persisted one; no client ever invents a competitive
 * window. Null while the speeches are still running.
 */
export function roundJudgingStatus(input: {
  readonly nowMs: number;
  readonly finalSegmentEnded: boolean;
  readonly frozen: boolean;
  /** An uncertain check-in writer holds every attendance decision. */
  readonly heldByWriter: boolean;
  readonly attendanceUnresolved: boolean;
  readonly ballotDeadlineAt: string | null;
  readonly attendanceCutoffAt: string | null;
  /** A human judge seat has not ruled. */
  readonly humanJudgeUnruled: boolean;
  readonly jobs: readonly {
    readonly generationDeadlineAt: string;
    readonly running: boolean;
    readonly holdsBallot: boolean;
  }[];
}): RoundJudgingStatus | null {
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
    (job) => job.running && !job.holdsBallot,
  );
  if (generating.length > 0)
    return {
      state: 'ai_processing',
      deadlineAt: generating
        .map((job) => job.generationDeadlineAt)
        .sort()
        .at(-1)!,
    };
  if (
    input.attendanceUnresolved ||
    input.jobs.some((job) => job.running && job.holdsBallot)
  )
    return {
      state: 'awaiting_attendance',
      deadlineAt: input.attendanceCutoffAt,
    };
  return input.jobs.some((job) => !job.running)
    ? { state: 'ai_failed', deadlineAt: null }
    : { state: 'settling', deadlineAt: null };
}

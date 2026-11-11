import { attendanceSettled } from './attendance-order';
import type { RoundWaitingFacts, RoundWaitingOn } from '@daisy/protocol';
import {
  decidePanelCompletion,
  judgingPanelOf,
} from './round-panel-completion';

/**
 * The one thing a played Round is waiting on, for every viewer's room. It reads
 * the same panel decision completion acts on, so the two cannot disagree. A
 * deadline is always a persisted one; no client ever invents a competitive
 * window. Null while the speeches are still running.
 */
export function roundWaitingOn(
  input: RoundWaitingFacts,
): RoundWaitingOn | null {
  if (input.speeches === 'running') return null;
  if (input.attendance.pendingWriter) return { state: 'held_by_writer' };
  if (input.frozen === null) return { state: 'closing_transcript' };
  const facts = input.frozen;
  const panel = judgingPanelOf(facts, input.nowMs);
  if (panel === null) return { state: 'settling' };
  const decision = decidePanelCompletion({
    completeness: facts.completeness,
    panel,
    ballots: facts.ballots,
    nowMs: input.nowMs,
  });
  // A wait attendance still gates, or a finished panel, reads attendance first.
  const awaitingAttendance = (): RoundWaitingOn | null =>
    attendanceSettled(input.attendance, input.nowMs)
      ? null
      : {
          state: 'awaiting_attendance',
          deadlineAt: facts.held.attendanceCutoffAt,
        };
  if (decision.kind === 'complete')
    return (
      awaitingAttendance() ??
      (panel.aiSeats.some((seat) => seat.standing.state === 'ended')
        ? { state: 'ai_failed' }
        : { state: 'settling' })
    );
  const { waiting } = decision;
  switch (waiting.on) {
    case 'human_window':
      return { state: 'human_window', deadlineAt: waiting.deadlineAt };
    case 'ai_generating':
      return { state: 'ai_processing', deadlineAt: waiting.deadlineAt };
    case 'ai_recovering':
      return { state: 'ai_recovering' };
    case 'ai_blocked':
      return { state: 'ai_blocked' };
    // A validated ballot submits once attendance settles (DEC-370).
    case 'held_ballot':
      return awaitingAttendance() ?? { state: 'settling' };
  }
}

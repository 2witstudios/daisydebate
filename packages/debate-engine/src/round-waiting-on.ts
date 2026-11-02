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
  if (input.heldByWriter) return { state: 'held_by_writer' };
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
  if (decision.kind === 'pending' && decision.waiting.on === 'human_window')
    return { state: 'human_window', deadlineAt: decision.waiting.deadlineAt };
  if (decision.kind === 'pending' && decision.waiting.on === 'ai_generating')
    return { state: 'ai_processing', deadlineAt: decision.waiting.deadlineAt };
  if (input.attendanceUnresolved)
    return {
      state: 'awaiting_attendance',
      deadlineAt: facts.held.attendanceCutoffAt,
    };
  return decision.kind === 'complete' &&
    panel.aiSeats.some((seat) => seat.standing.state === 'ended')
    ? { state: 'ai_failed' }
    : { state: 'settling' };
}

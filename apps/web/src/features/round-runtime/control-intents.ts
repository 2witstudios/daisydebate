import {
  roundControlsAt,
  type RoundCommandOption,
} from '@daisy/debate-engine/position';
import { startSpeechLabel } from '../debate-room/vocabulary';
import {
  isNamedSeat,
  type RoundView,
  type RoundPosition,
  type RoundCommandEnvelope,
} from '@daisy/protocol';
export type RoundControlIntent = {
  readonly type: RoundCommandEnvelope['command']['type'];
  readonly label: string;
  readonly participantId?: string;
  readonly enabled: boolean;
  readonly confirm?: boolean;
};
/** "Start negative constructive": the speech by name, never its code. */
const startLabel = (next: RoundPosition['nextSegment']) =>
  next ? startSpeechLabel(next.label) : 'Start speech';
/** The words on each command; what is offered and legal is the engine's. */
const wording = (
  type: RoundCommandOption['type'],
  position: RoundPosition,
): Pick<RoundControlIntent, 'label' | 'confirm'> => {
  switch (type) {
    case 'start_prep':
      return { label: 'Take prep time', confirm: false };
    case 'start_speech':
      return { label: startLabel(position.nextSegment), confirm: false };
    case 'yield':
      return { label: 'End speech', confirm: true };
    case 'interrupt':
      return { label: 'Interrupt', confirm: false };
    case 'forfeit':
      return { label: 'Forfeit round', confirm: true };
  }
};
/** The engine's options for this seat in words; a post still meets locked authority and the engine. */
export function roundControlIntents(
  view: RoundView,
  actorId: string,
  nowMs: number,
): readonly RoundControlIntent[] {
  // The opening runs on its own; its only command is the strike on its own form.
  if (view.status === 'opening') return [];
  const seats = view.participants.filter(isNamedSeat);
  const self = seats.find(
    (p) => p.actorId === actorId && p.kind === 'human' && p.role !== 'judge',
  );
  if (!self) return [];
  if (view.status !== 'active' || view.checkpoint === null) return [];
  const { position, options } = roundControlsAt({
    round: view,
    rules: view.rules,
    segments: view.segments,
    checkpoint: view.checkpoint,
    nowMs,
    participants: seats,
    seat: self,
  });
  const current = persistedPhase(view, position);
  return options.map((option) => ({
    type: option.type,
    participantId: self.id,
    enabled: current && option.legal,
    ...wording(option.type, position),
  }));
}

/**
 * Whether the server has persisted the open segment the Round's clock shows.
 * The clock may display a transition the instant it is due, but a command
 * carries the version this view observed, so acting before the server's tick
 * reaches the view is refused as stale (ISSUE-838).
 */
function persistedPhase(view: RoundView, position: RoundPosition) {
  const persisted = view.segments.find((s) => s.endedAt === null);
  return (
    (persisted?.sequence ?? null) === (position.openSegment?.sequence ?? null)
  );
}

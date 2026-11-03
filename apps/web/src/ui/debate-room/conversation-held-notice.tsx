import { roundPositionAt } from '@daisy/debate-engine/position';
import { conversational, type RoundView } from '@daisy/protocol';

export const conversationHeldShown = (view: RoundView, nowMs: number) => {
  if (view.conversationHeld !== true || view.checkpoint === null) return false;
  if (view.status !== 'scheduled' && view.status !== 'active') return false;
  return conversational(
    roundPositionAt({
      round: view,
      segments: view.segments,
      checkpoint: view.checkpoint,
      rules: view.rules,
      nowMs,
    }),
  );
};

/** Says why the microphone is off rather than leaving it silently dead. */
export function ConversationHeldNotice(props: {
  readonly view: RoundView;
  readonly nowMs: number;
}) {
  return conversationHeldShown(props.view, props.nowMs) ? (
    <p role="status">
      Microphones stay off until the audience stream has switched away, so this
      conversation stays private. Speeches are not affected.
    </p>
  ) : null;
}

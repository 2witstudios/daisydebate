import { roundPositionAt } from '@daisy/debate-engine/position';
import { conversational, type RoundView } from '@daisy/protocol';

export const conversationHeldShown = (view: RoundView, nowMs: number) => {
  if (view.conversationHeld !== true || view.checkpoint === null) return false;
  if (view.status !== 'opening' && view.status !== 'active') return false;
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

/** Says why the conversation has not opened rather than leaving it silently dead. */
export function ConversationHeldNotice(props: {
  readonly view: RoundView;
  readonly nowMs: number;
}) {
  return conversationHeldShown(props.view, props.nowMs) ? (
    <p role="status">
      This conversation opens once the audience stream has switched away, so
      it stays private. Speeches are not affected.
    </p>
  ) : null;
}

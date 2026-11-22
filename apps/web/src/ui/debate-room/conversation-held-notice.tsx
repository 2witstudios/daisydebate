import { StatusRegion } from '../components/status-region/status-region';
import { roundPositionAt } from '@daisy/debate-engine/position';
import { conversational } from '@daisy/protocol/runtime';
import { isRoundRunning } from '@daisy/protocol/round';
import { type RoundView } from '@daisy/protocol/round-view';

const conversationHeldShown = (view: RoundView, nowMs: number) => {
  if (view.conversationHeld !== true || view.checkpoint === null) return false;
  if (!isRoundRunning(view.status)) return false;
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
    <StatusRegion as="p" role="status">
      This conversation opens once the audience stream has switched away, so it
      stays private. Speeches are not affected.
    </StatusRegion>
  ) : null;
}

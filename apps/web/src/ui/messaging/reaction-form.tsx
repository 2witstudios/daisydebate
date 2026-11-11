'use client';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { Button } from '../components/button/button';
import { DraftNotice } from './draft-notice';
import { destinationOf } from '../../features/forms/form-state';
import {
  reactionFields,
  reactionIdle,
  reactionUnavailable,
  type ReactionFormState,
} from '../../features/messaging/forms/reaction-form';
export function ReactionForm({
  action,
  requestId,
  reaction,
  active,
}: {
  readonly action: FormAction<ReactionFormState>;
  readonly requestId: string;
  readonly reaction: string;
  readonly active: boolean;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    reactionIdle(requestId),
    reactionUnavailable,
  );
  useMovedOn(destinationOf(answer));
  const fields = reactionFields(answer);
  useFocusAfterAnswer(
    answer,
    fields.notice ? `reaction-${fields.requestId}` : undefined,
    !pending,
  );
  return (
    <form action={post} className="flex items-center gap-3">
      <ReactionFields
        answer={answer}
        pending={pending}
        reaction={reaction}
        active={active}
      />
    </form>
  );
}
/** Native fields preserve the exact boolean cleanup intent even before hydration. */
export function ReactionFields({
  answer,
  pending,
  reaction,
  active,
}: {
  readonly answer: ReactionFormState;
  readonly pending: boolean;
  readonly reaction: string;
  readonly active: boolean;
}) {
  const { requestId, notice } = reactionFields(answer);
  return (
    <>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="reaction" value={reaction} />
      <input type="hidden" name="active" value={String(active)} />
      <Button
        type="submit"
        disabled={pending || destinationOf(answer) !== undefined}
      >
        {active ? `React ${reaction}` : `Remove ${reaction}`}
      </Button>
      <DraftNotice id={`reaction-${requestId}`} notice={notice} />
    </>
  );
}

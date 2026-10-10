'use client';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { Button } from '../components/button/button';
import { DraftNotice } from './draft-notice';
export type ReactionFormState = {
  readonly requestId: string;
  readonly notice?: string;
  readonly next?: string;
};
const unavailable = (form: FormData): ReactionFormState => ({
  requestId: String(form.get('requestId') ?? ''),
  notice: 'Reaction could not be changed. Try again.',
});
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
    { requestId },
    unavailable,
  );
  useMovedOn(answer.next);
  useFocusAfterAnswer(
    answer,
    answer.notice ? `reaction-${answer.requestId}` : undefined,
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
  return (
    <>
      <input type="hidden" name="requestId" value={answer.requestId} />
      <input type="hidden" name="reaction" value={reaction} />
      <input type="hidden" name="active" value={String(active)} />
      <Button type="submit" disabled={pending || answer.next !== undefined}>
        {active ? `React ${reaction}` : `Remove ${reaction}`}
      </Button>
      <DraftNotice id={`reaction-${answer.requestId}`} notice={answer.notice} />
    </>
  );
}

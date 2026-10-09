'use client';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { Button } from '../components/button/button';
import { Notice } from '../components/notice/notice';
import {
  dmDecisionUnavailable,
  type DmDecisionFormState,
} from '../../features/messaging/forms/decide-form';
export function RequestDecision({
  action,
  requestId,
  mode = 'recipient',
  subject = 'request',
}: {
  readonly action: FormAction<DmDecisionFormState>;
  readonly requestId: string;
  readonly mode?: 'recipient' | 'sender';
  readonly subject?: 'request' | 'invitation';
}) {
  const [answer, post, pending] = useFormAction<DmDecisionFormState>(
    action,
    { requestId },
    dmDecisionUnavailable,
  );
  useMovedOn(answer.next);
  useFocusAfterAnswer(
    answer,
    answer.notice ? 'request-notice' : 'request-primary',
    !pending,
  );
  return (
    <form action={post} className="flex flex-col gap-4">
      <input type="hidden" name="requestId" value={answer.requestId} />
      {answer.notice ? (
        <div id="request-notice" tabIndex={-1}>
          <Notice
            tone="neutral"
            icon="info"
            title={answer.notice}
            role="status"
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          id="request-primary"
          type="submit"
          name="decision"
          value={mode === 'sender' ? 'cancel' : 'accept'}
          disabled={pending || answer.next !== undefined}
        >
          {mode === 'sender' ? `Cancel ${subject}` : `Accept ${subject}`}
        </Button>
        {mode === 'recipient' ? (
          <Button
            type="submit"
            name="decision"
            value="decline"
            variant="secondary"
            disabled={pending || answer.next !== undefined}
          >
            Decline
          </Button>
        ) : null}
      </div>
    </form>
  );
}

'use client';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { Button } from '../components/button/button';
import { Notice } from '../components/notice/notice';
import { destinationOf } from '../../features/forms/form-state';
import {
  dmDecisionFields,
  dmDecisionIdle,
  dmDecisionUnavailable,
  type DmDecisionFormState,
} from '../../features/messaging/forms/decide-form';
export function RequestDecision({
  action,
  requestId,
  mode = 'recipient',
  subject = 'request',
  acceptable = true,
}: {
  readonly action: FormAction<DmDecisionFormState>;
  readonly requestId: string;
  readonly mode?: 'recipient' | 'sender';
  readonly subject?: 'request' | 'invitation';
  /** False offers only Decline (an invitation to a group while groups are off). */
  readonly acceptable?: boolean;
}) {
  const [answer, post, pending] = useFormAction<DmDecisionFormState>(
    action,
    dmDecisionIdle(requestId),
    dmDecisionUnavailable,
  );
  const next = destinationOf(answer);
  useMovedOn(next);
  const fields = dmDecisionFields(answer);
  useFocusAfterAnswer(
    answer,
    fields.notice ? 'request-notice' : 'request-primary',
    !pending,
  );
  return (
    <form action={post} className="flex flex-col gap-4">
      <input type="hidden" name="requestId" value={fields.requestId} />
      {fields.notice ? (
        <div id="request-notice" tabIndex={-1}>
          <Notice
            tone="neutral"
            icon="info"
            title={fields.notice}
            role="status"
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {acceptable || mode === 'sender' ? (
          <Button
            id="request-primary"
            type="submit"
            name="decision"
            value={mode === 'sender' ? 'cancel' : 'accept'}
            disabled={pending || next !== undefined}
          >
            {mode === 'sender' ? `Cancel ${subject}` : `Accept ${subject}`}
          </Button>
        ) : null}
        {mode === 'recipient' ? (
          <Button
            {...(acceptable ? {} : { id: 'request-primary' })}
            type="submit"
            name="decision"
            value="decline"
            variant="secondary"
            disabled={pending || next !== undefined}
          >
            Decline
          </Button>
        ) : null}
      </div>
    </form>
  );
}

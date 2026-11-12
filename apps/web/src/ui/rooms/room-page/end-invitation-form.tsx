'use client';

import {
  initialInvitationForm,
  invitationFields,
  invitationFormUnavailable,
  type InvitationFormState,
} from '../../../features/room-invitations/submit';
import { buttonClass } from '../../components/button/button-class';
import {
  useFocusAfterAnswer,
  useFormAction,
  type FormAction,
} from '../../form-action/form-action';

/**
 * Ends one invitation (ADR 0124): the host's Withdraw or the invitee's
 * Decline. The button is disabled while its answer is on the way, which
 * drops focus to `<body>`; `focusAfterAnswer` names where focus goes then.
 * It moves only if it is still lost, since the controls around this form
 * stay usable meanwhile, and also when room sync removes the form before
 * its own answer arrives.
 */
export function EndInvitationForm({
  action,
  intent,
  invitationId,
  label,
  focusAfterAnswer,
}: {
  readonly action: FormAction<InvitationFormState>;
  readonly intent: 'withdraw' | 'decline';
  readonly invitationId: string;
  readonly label: string;
  readonly focusAfterAnswer: string;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    initialInvitationForm,
    invitationFormUnavailable,
  );
  useFocusAfterAnswer(answer, focusAfterAnswer, !pending, {
    onlyWhenLost: true,
  });
  const fields = invitationFields(answer);
  return (
    <form action={post} className="flex items-center gap-2">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <button
        type="submit"
        className={buttonClass('secondary')}
        disabled={pending}
      >
        {label}
      </button>
      {fields.notice ? (
        <span role="status" className="text-sm text-ink-muted">
          {fields.notice}
        </span>
      ) : null}
    </form>
  );
}

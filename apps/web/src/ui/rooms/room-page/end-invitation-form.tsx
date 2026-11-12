'use client';

import { useEffect } from 'react';
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
 * Focus for a form that has just left the page. An invitation's row goes
 * when room sync says it ended, which may be before its own answer arrives;
 * the button that had focus goes with it and focus falls to `<body>`. It
 * moves to `targetId` only then, never away from wherever the member has
 * since put it.
 */
function useFocusWhenRemoved(targetId: string | undefined) {
  useEffect(
    () => () => {
      if (targetId !== undefined && document.activeElement === document.body)
        document.getElementById(targetId)?.focus();
    },
    [targetId],
  );
}

/**
 * Ends one invitation (ADR 0124): the host's Withdraw or the invitee's
 * Decline. `focusAfterAnswer` names where keyboard focus goes once the
 * answer is in, for a form inside a dialog, where the disabled button
 * would otherwise leave focus on `<body>`.
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
  readonly focusAfterAnswer?: string;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    initialInvitationForm,
    invitationFormUnavailable,
  );
  useFocusAfterAnswer(answer, focusAfterAnswer, !pending);
  useFocusWhenRemoved(focusAfterAnswer);
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

import type { SecurityOutcome } from '../../../features/account/security-client';
import { idle, type Idle } from '../../../features/forms/form-state';
import { OUTCOME_NOTICES } from './security-notices';

/** The address as posted, shown again whatever the answer. */
type EmailValues = { readonly values: { readonly newEmail: string } };
/** Why a change did not start. */
export type EmailChangeRefusal = Exclude<SecurityOutcome['kind'], 'ok'>;
/** The approval was emailed to the address on file. */
type EmailChangeSent = { readonly kind: 'sent' } & EmailValues;
/** Nothing started; `reason` says why, which the shared refusal's text alone could not. */
type EmailChangeUnsent = {
  readonly kind: 'unsent';
  readonly reason: EmailChangeRefusal;
} & EmailValues;

/** What the email-change form's action answers. */
export type EmailChangeState =
  (Idle & EmailValues) | EmailChangeSent | EmailChangeUnsent;

export const initialEmailChange: EmailChangeState = idle({ newEmail: '' });
export const emailChangeSent = (newEmail: string): EmailChangeSent => ({
  kind: 'sent',
  values: { newEmail },
});
export const emailChangeUnsent = (
  newEmail: string,
  reason: EmailChangeRefusal,
): EmailChangeUnsent => ({ kind: 'unsent', values: { newEmail }, reason });

export type ChangeEmail = (newEmail: string) => Promise<SecurityOutcome>;

const postedEmail = (form: FormData): string => {
  const field = form.get('newEmail');
  return typeof field === 'string' ? field.trim() : '';
};

/**
 * One posted email-change form. The form is untrusted: a missing or
 * non-text field is an empty address, which the route refuses. A change
 * that throws is unavailable, never ok.
 */
export async function submitEmailChange(
  change: ChangeEmail,
  form: FormData,
): Promise<EmailChangeState> {
  const newEmail = postedEmail(form);
  try {
    const outcome = (await change(newEmail)).kind;
    return outcome === 'ok'
      ? emailChangeSent(newEmail)
      : emailChangeUnsent(newEmail, outcome);
  } catch {
    return emailChangeUnsent(newEmail, 'unavailable');
  }
}

/**
 * A posted form whose change never reached the server, because the
 * browser's call to the action failed in transport.
 */
export const emailChangeUnavailable = (form: FormData): EmailChangeState =>
  emailChangeUnsent(postedEmail(form), 'unavailable');

export type EmailChangeNotice = {
  readonly tone: 'error' | 'info';
  readonly title: string;
};

/**
 * What the form renders from its answer: the address, what it says about
 * the answer, and whether that refuses the typed address itself, so the
 * field is marked invalid and points at the notice. When the address on
 * file is the one that cannot receive email, the typed address is not at
 * fault.
 */
export type EmailChangeFields = {
  readonly newEmail: string;
  readonly notice: EmailChangeNotice | undefined;
  readonly refusesNewAddress: boolean;
};

export function emailChangeFields(answer: EmailChangeState): EmailChangeFields {
  const { newEmail } = answer.values;
  switch (answer.kind) {
    case 'idle':
      return { newEmail, notice: undefined, refusesNewAddress: false };
    case 'sent':
      return {
        newEmail,
        notice: {
          tone: 'info',
          title:
            'Check the inbox for the address currently on file to approve this change.',
        },
        refusesNewAddress: false,
      };
    case 'unsent':
      return {
        newEmail,
        notice: { tone: 'error', title: OUTCOME_NOTICES[answer.reason] },
        refusesNewAddress: answer.reason === 'undeliverable',
      };
  }
}

'use server';

import { revalidatePath } from 'next/cache';
import {
  guardianCommandAnswerSchema,
  guardianCommandSchema,
  type GuardianCommand,
  type GuardianRefusal,
} from '@daisy/protocol/guardians';
import { POST } from '../../../api/parental-controls/command/route';
import {
  field,
  formUnavailable,
  refused,
  type FormState,
} from '../../../../features/forms/form-state';
import { post } from '../../form-post';

export type GuardianFormState =
  FormState | { readonly kind: 'sent'; readonly message: string };

const refusalWords: Readonly<Record<GuardianRefusal, string>> = {
  'not-an-adult': 'You need to be an adult to add a child.',
  'under-13': 'Daisy accounts are for ages 13 and older.',
  'not-a-minor': 'Parental controls are for children aged 13 to 17.',
  'own-email': 'Use your child’s own email address.',
  'no-such-child': 'We couldn’t find a child with that username.',
  'already-linked': 'You already have a link or a request for this child.',
  'notice-changed':
    'The notice changed. Reload the page and read it before continuing.',
  'not-waiting': 'This request is no longer waiting.',
  'not-active': 'This link is no longer active.',
  'not-found': 'This request is no longer available.',
};

export async function parentalControlsAction(
  command: Pick<GuardianCommand, 'type'> | GuardianCommand,
  _previous: GuardianFormState,
  form: FormData,
): Promise<GuardianFormState> {
  const { type } = command;
  const agreeing =
    type === 'create-child-account' ||
    type === 'request-link' ||
    type === 'confirm-parent';
  if (agreeing && field(form, 'agree') !== 'yes')
    return refused(form, 'Read and agree to the notice to continue.');
  const noticeVersion = field(form, 'noticeVersion');
  const input = guardianCommandSchema.safeParse({
    ...command,
    version: 1,
    ...(agreeing ? { noticeVersion } : {}),
    ...(type === 'create-child-account'
      ? {
          firstName: field(form, 'firstName'),
          birthMonth: field(form, 'birthMonth'),
          email: field(form, 'email'),
        }
      : type === 'request-link'
        ? { username: field(form, 'username').replace(/^@/, '') }
        : {}),
  });
  if (!input.success) return refused(form, 'Check the details and try again.');
  try {
    const response = await post(
      POST,
      '/api/parental-controls/command',
      input.data,
    );
    if (response.status === 429)
      return refused(form, 'Too many tries. Wait a little and try again.');
    if (!response.ok) return formUnavailable(form);
    const result = guardianCommandAnswerSchema.safeParse(await response.json());
    if (!result.success) return formUnavailable(form);
    if (result.data.kind === 'refused')
      return refused(form, refusalWords[result.data.refusal]);
    revalidatePath('/settings/parental-controls');
    revalidatePath('/settings/your-parents');
    const message =
      input.data.type === 'create-child-account'
        ? `We emailed ${input.data.email}.`
        : type === 'refuse-parent'
          ? 'Daisy’s safety team received your report.'
          : type === 'request-link'
            ? 'Request sent.'
            : 'Saved.';
    return { kind: 'sent', message };
  } catch {
    return formUnavailable(form);
  }
}

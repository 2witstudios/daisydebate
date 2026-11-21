'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { POST } from '../../../api/parental-controls/lobby-permission/route';
import {
  field,
  formUnavailable,
  refused,
} from '../../../../features/forms/form-state';
import type { GuardianFormState } from '../../../../features/parental-controls/form';
import { post } from '../../form-post';

const answer = z.object({
  accepted: z.boolean(),
  changed: z.boolean().optional(),
});

export async function lobbyPermissionAction(
  type: 'request' | 'sign',
  linkId: string,
  _previous: GuardianFormState,
  form: FormData,
): Promise<GuardianFormState> {
  const lobbyId = field(form, 'lobbyId');
  if (type === 'sign' && field(form, 'agree') !== 'yes')
    return refused(form, 'Read and agree to the waiver to continue.');
  try {
    const response = await post(
      POST,
      '/api/parental-controls/lobby-permission',
      type === 'request'
        ? { type, lobbyId, linkId }
        : {
            type,
            lobbyId,
            linkId,
            version: field(form, 'noticeVersion'),
            accepted: 'yes',
          },
    );
    if (response.status === 429)
      return refused(form, 'Too many tries. Wait a little and try again.');
    if (!response.ok) return formUnavailable(form);
    const result = answer.safeParse(await response.json());
    if (!result.success) return formUnavailable(form);
    if (!result.data.accepted)
      return refused(
        form,
        result.data.changed
          ? 'The waiver changed. Reload the page and read it before signing.'
          : 'This lobby permission is no longer available.',
      );
    revalidatePath('/settings/parental-controls');
    revalidatePath('/settings/your-parents');
    return {
      kind: 'sent',
      message: type === 'request' ? 'Request sent.' : 'Waiver signed.',
    };
  } catch {
    return formUnavailable(form);
  }
}

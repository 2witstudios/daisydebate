'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import {
  done,
  field,
  refused,
  unacknowledged,
  type FormState,
  type Unacknowledged,
} from '../../../../../features/forms/form-state';
import { moveOn } from '../../../../../server/form-action';
import { POST } from '../../../../api/parental-controls/more/route';
import { post } from '../../../form-post';

type State = FormState | Unacknowledged;

const answer = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('done') }),
  z.object({ kind: z.literal('refused'), reason: z.string() }),
]);

export async function guardianMoreAction(
  linkId: string,
  type: 'sign' | 'close',
  _previous: State,
  form: FormData,
): Promise<State> {
  const confirmed = field(form, 'confirm') === 'on';
  if (type === 'close' && !confirmed)
    return refused(form, 'Confirm that you want to close this account.');
  try {
    const response = await post(POST, '/api/parental-controls/more', {
      linkId,
      type,
      ...(type === 'close'
        ? { confirmed }
        : {
            wordingVersion: field(form, 'wordingVersion'),
            name: field(form, 'name'),
            relation: field(form, 'relation'),
            attests: field(form, 'attests') === 'on',
            paidAds: field(form, 'paidAds') === 'on',
          }),
    });
    if (response.status === 429)
      return refused(form, 'Too many tries. Wait a little and try again.');
    if (response.status >= 500) return unacknowledged(form);
    if (!response.ok)
      return refused(form, 'This parental control is unavailable.');
    const parsed = answer.safeParse(await response.json());
    if (!parsed.success) return unacknowledged(form);
    if (parsed.data.kind === 'refused') {
      if (parsed.data.reason === 'already_released')
        return refused(form, 'A media release is already on file.');
      return refused(
        form,
        'Check the release details and reload if the terms changed.',
      );
    }
  } catch {
    return unacknowledged(form);
  }
  if (type === 'sign') return done();
  revalidatePath('/settings/parental-controls');
  return moveOn(
    new Headers(await headers()),
    '/settings/parental-controls?childAccount=closed',
  );
}

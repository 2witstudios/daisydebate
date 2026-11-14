'use server';

import { createId } from '@paralleldrive/cuid2';
import { headers } from 'next/headers';
import { refusedWith, type FormState } from '../../features/forms/form-state';
import { requireTabRelease } from '../../features/tab/release';
import { isTabPath } from '../../features/tab/routes';
import { moveOn } from '../../server/form-action';
import { ANSWERED } from '../../ui/tab/sample-form/answered';
import { sampleActionHref } from '../../ui/components/sample-action/sample-action-href';

/**
 * The POST of a Tab form that has no operation behind it yet. It reads and
 * saves nothing from the form: it moves on to the page it was posted from
 * with the sample banner. `returnTo` and `label` were bound on the server
 * but round-trip through the page: `returnTo` is checked again here, and
 * `label` is trimmed and cut to length where the banner reads it.
 */
export async function sampleFormAction(
  returnTo: string,
  label: string,
  _state: FormState,
  _form: FormData,
): Promise<FormState> {
  await requireTabRelease();
  if (!isTabPath(returnTo))
    return refusedWith({}, 'That page is not part of Daisy Tab.');
  // Each answer is a new address: a form that was moved on to the address it
  // is already on would stay waiting, and a second submit would do nothing.
  const answered = `${ANSWERED}=${createId()}`;
  return moveOn(await headers(), sampleActionHref(returnTo, answered, label));
}

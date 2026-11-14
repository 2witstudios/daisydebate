'use server';

import { headers } from 'next/headers';
import { refusedWith, type FormState } from '../../features/forms/form-state';
import { requireTabRelease } from '../../features/tab/release';
import { isTabPath } from '../../features/tab/routes';
import { moveOn } from '../../server/form-action';
import { sampleActionHref } from '../../ui/components/sample-action/sample-action-href';

/**
 * The POST of a Tab form that has no operation behind it yet. It reads and
 * saves nothing from the form: it moves on to the page it was posted from
 * with the sample banner. `returnTo` and `label` were bound on the server
 * but round-trip through the page, so both are checked again here.
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
  return moveOn(await headers(), sampleActionHref(returnTo, '', label));
}

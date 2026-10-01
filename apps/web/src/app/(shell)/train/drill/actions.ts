'use server';

import {
  parseDrillForm,
  stepDrill,
  type DrillState,
} from '../../../../features/train/drill';
import { requireAccess } from '../../../../lib/access';

/**
 * The drill form's POST, as a server action: check, revise and save work
 * before hydration and without JavaScript. It rechecks the session, then
 * derives the next state from the posted form alone (nothing from the
 * previous state is trusted). The structure check is a pure function; saving
 * stores nothing yet, so the answer is action state, never a URL.
 */
export async function drillAction(
  _state: DrillState,
  form: unknown,
): Promise<DrillState> {
  await requireAccess('/train/drill', Promise.resolve({}));
  return stepDrill(parseDrillForm(form instanceof FormData ? form : new FormData()));
}

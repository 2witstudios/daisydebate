'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { presenceSettingResultSchema } from '@daisy/protocol/presence-setting';
import {
  presenceFormUnavailable,
  presenceSet,
  type PresenceFormState,
} from '../../../features/presence/form';
import { post, text } from '../form-post';
import { processRoute } from '../../../server/process-app';
import { presenceComposition } from '../../../features/presence/composition';
import {
  isPeopleRailChoice,
  PEOPLE_RAIL_COOKIE,
  RAIL_COOKIE_OPTIONS,
} from '../../../ui/layout/app-shell/rail-preference';

const routes = { status: processRoute(presenceComposition, (all) => all.set) };

/** The rail's open or collapsed choice; a native POST, remembered per member. */
export async function setPeopleRail(form: FormData): Promise<void> {
  const choice = form.get('rail');
  if (!isPeopleRailChoice(choice)) return;
  (await cookies()).set(PEOPLE_RAIL_COOKIE, choice, RAIL_COOKIE_OPTIONS);
}

/**
 * The member's own status, from their card. The card, the mini rail and the
 * phone's sheet each hold a status form, so a saved choice re-renders the
 * shell and every one of them shows it. Deliberately the whole layout: the
 * forms are seeded from the shell's one status read.
 */
export async function setStatusAction(
  _previous: PresenceFormState,
  form: FormData,
): Promise<PresenceFormState> {
  try {
    const response = await post(routes.status, '/api/presence', {
      version: 1,
      status: text(form, 'status'),
    });
    const result = presenceSettingResultSchema.safeParse(
      response.ok ? await response.json() : null,
    );
    if (!result.success) return presenceFormUnavailable();
    revalidatePath('/', 'layout');
    return presenceSet(result.data.status);
  } catch {
    return presenceFormUnavailable();
  }
}

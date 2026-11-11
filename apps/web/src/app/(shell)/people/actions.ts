'use server';

import { cookies } from 'next/headers';
import { presenceSettingResultSchema } from '@daisy/protocol';
import {
  presenceFormUnavailable,
  presenceSet,
  type PresenceFormState,
} from '../../../features/presence/form';
import { post, text } from '../form-post';
import { processRoute } from '../../../server/process-app';
import {
  isPeopleRailChoice,
  PEOPLE_RAIL_COOKIE,
  RAIL_COOKIE_OPTIONS,
} from '../../../ui/layout/app-shell/rail-preference';

const routes = { status: processRoute((all) => all.presence.set) };

/** The rail's open or collapsed choice; a native POST, remembered per member. */
export async function setPeopleRail(form: FormData): Promise<void> {
  const choice = form.get('rail');
  if (!isPeopleRailChoice(choice)) return;
  (await cookies()).set(PEOPLE_RAIL_COOKIE, choice, RAIL_COOKIE_OPTIONS);
}

/** The member's own status, from the account menu. */
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
    return result.success
      ? presenceSet(result.data.status)
      : presenceFormUnavailable();
  } catch {
    return presenceFormUnavailable();
  }
}

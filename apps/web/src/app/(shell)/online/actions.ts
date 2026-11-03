'use server';

import { cookies } from 'next/headers';
import { presenceSettingResultSchema } from '@daisy/protocol';
import {
  presenceFormUnavailable,
  type PresenceFormState,
} from '../../../features/presence/form';
import { post, text } from '../form-post';
import { processRoute } from '../../../server/process-app';
import {
  isOnlineRailChoice,
  ONLINE_RAIL_COOKIE,
  RAIL_COOKIE_OPTIONS,
} from '../../../ui/layout/app-shell/rail-preference';

const routes = { status: processRoute((all) => all.presence.set) };

/** The rail's open or collapsed choice; a native POST, remembered per member. */
export async function setOnlineRail(form: FormData): Promise<void> {
  const choice = form.get('rail');
  if (!isOnlineRailChoice(choice)) return;
  (await cookies()).set(ONLINE_RAIL_COOKIE, choice, RAIL_COOKIE_OPTIONS);
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
      ? { status: result.data.status }
      : presenceFormUnavailable();
  } catch {
    return presenceFormUnavailable();
  }
}

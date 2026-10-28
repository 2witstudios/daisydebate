'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { presenceSettingResultSchema } from '@daisy/protocol';
import {
  presenceFormUnavailable,
  presenceNotice,
  type PresenceFormState,
} from '../../../../features/presence/form';
import { processRoute } from '../../../../server/process-app';
import { inProcessFetch } from '../../../../server/in-process-fetch';

const presenceRoute = processRoute((all) => all.presence.set);

/**
 * The member's own online-status choice: Presence's route, the same one a
 * script would call, in process with this request's headers.
 */
export async function presenceAction(
  _previous: PresenceFormState,
  form: FormData,
): Promise<PresenceFormState> {
  const hidden = form.get('hidden') === 'true';
  try {
    const response = await inProcessFetch(
      presenceRoute,
      new Headers(await headers()),
    )('/api/presence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, hidden }),
    });
    const result = presenceSettingResultSchema.safeParse(
      response.ok ? await response.json() : null,
    );
    if (!result.success) return presenceFormUnavailable();
    revalidatePath('/friends');
    return { notice: presenceNotice(result.data.hidden) };
  } catch {
    return presenceFormUnavailable();
  }
}

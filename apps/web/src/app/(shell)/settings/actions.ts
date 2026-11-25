'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';
import { messagingComposition } from '../../../features/messaging/composition';
import { publicProfileComposition } from '../../../features/profile/public-profile-routes';
import { done } from '../../../features/forms/form-state';
import {
  saveRefused,
  type SaveFormState,
} from '../../../features/forms/save-form';
import { post } from '../form-post';
import {
  profileTextRefusalOf,
  profileTextRefused,
  profileTextUnavailable,
  type ProfileTextFormState,
} from '../../../features/profile/profile-text-form';

const publicProfileRoute = processRoute(
  publicProfileComposition,
  (all) => all.write,
);

/**
 * The member's display name and bio (ADR 0143), through the route's own gates.
 * An empty field clears it; the route normalizes and bounds both again.
 */
export async function savePublicProfileAction(
  _previous: ProfileTextFormState,
  form: FormData,
): Promise<ProfileTextFormState> {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  try {
    const response = await inProcessFetch(
      publicProfileRoute,
      new Headers(await headers()),
    )('/api/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        displayName: text('displayName'),
        bio: text('bio'),
      }),
    });
    if (!response.ok)
      return profileTextRefused(
        form,
        profileTextRefusalOf({
          status: response.status,
          refusal: (
            (await response.json().catch(() => null)) as {
              readonly refusal?: unknown;
            } | null
          )?.refusal,
        }),
      );
  } catch {
    return profileTextUnavailable(form);
  }
  // Your card in the shell shows the display name too.
  revalidatePath('/settings');
  return done();
}

const requestSettingRoute = processRoute(
  messagingComposition,
  (all) => all.requestSetting,
);

/** Who may send the member message requests (decision 90), through the route. */
export async function saveMessageRequestSettingAction(
  _previous: SaveFormState,
  form: FormData,
): Promise<SaveFormState> {
  try {
    const response = await post(
      requestSettingRoute,
      '/api/messaging/request-setting',
      { version: 1, setting: form.get('setting') },
    );
    if (!response.ok) return saveRefused(form);
  } catch {
    return saveRefused(form);
  }
  revalidatePath('/settings');
  return done();
}

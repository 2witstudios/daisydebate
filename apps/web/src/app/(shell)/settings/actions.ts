'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';
import { done } from '../../../features/forms/form-state';
import {
  saveRefused,
  type SaveFormState,
} from '../../../features/forms/save-form';
import {
  profileTextRefusalOf,
  profileTextRefused,
  profileTextUnavailable,
  type ProfileTextFormState,
} from '../../../features/profile/profile-text-form';

const ratingVisibilityRoute = processRoute((all) => all.ratingVisibility.write);
const publicProfileRoute = processRoute((all) => all.publicProfile.write);

/** Which ratings the member's card shows besides Freestyle (ADR 0103). */
export async function saveRatingVisibilityAction(
  _previous: SaveFormState,
  form: FormData,
): Promise<SaveFormState> {
  try {
    const response = await inProcessFetch(
      ratingVisibilityRoute,
      new Headers(await headers()),
    )('/api/ratings/visibility', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        showPolicy: form.get('showPolicy') === 'on',
        showValue: form.get('showValue') === 'on',
      }),
    });
    return response.ok ? done() : saveRefused(form);
  } catch {
    return saveRefused(form);
  }
}

/**
 * The member's display name and bio (ADR 0142), through the route's own gates.
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
      return profileTextRefused(form, profileTextRefusalOf(response.status));
  } catch {
    return profileTextUnavailable(form);
  }
  // The shell's account menu shows the display name too.
  revalidatePath('/settings');
  return done();
}

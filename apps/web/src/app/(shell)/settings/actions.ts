'use server';

import { headers } from 'next/headers';
import type { FormState } from '../../../features/forms/form-state';
import {
  parseNotificationsForm,
  parseProfileForm,
  savedHref,
} from '../../../features/settings/preferences';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { runMockForm } from '../../../server/mock-form-action';
import { processRoute } from '../../../server/process-app';
import type { RatingVisibilityState } from '../../../ui/settings/preferences/rating-visibility-form';

/**
 * Each settings form posts to its own server action: it works before
 * hydration and without JavaScript. A saved form returns to its section;
 * nothing is kept until an account stores preferences.
 */
export async function saveProfileAction(
  _state: FormState,
  form: unknown,
): Promise<FormState> {
  return runMockForm(form, parseProfileForm, () => savedHref('profile'));
}

export async function saveNotificationsAction(
  _state: FormState,
  form: unknown,
): Promise<FormState> {
  return runMockForm(form, parseNotificationsForm, () =>
    savedHref('notifications'),
  );
}

const ratingVisibilityRoute = processRoute((all) => all.ratingVisibility.write);

/** Which ratings the member's card shows besides Freestyle (ADR 0097). */
export async function saveRatingVisibilityAction(
  _previous: RatingVisibilityState,
  form: FormData,
): Promise<RatingVisibilityState> {
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
    return { notice: response.ok ? 'Saved.' : 'Could not save. Try again.' };
  } catch {
    return { notice: 'Could not save. Try again.' };
  }
}

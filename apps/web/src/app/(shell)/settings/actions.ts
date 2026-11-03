'use server';

import { headers } from 'next/headers';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';
import type { RatingVisibilityState } from '../../../ui/settings/preferences/rating-visibility-form';

const ratingVisibilityRoute = processRoute((all) => all.ratingVisibility.write);

/** Which ratings the member's card shows besides Freestyle (ADR 0103). */
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

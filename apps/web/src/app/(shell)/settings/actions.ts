'use server';

import { headers } from 'next/headers';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';
import { done } from '../../../features/forms/form-state';
import {
  saveRefused,
  type SaveFormState,
} from '../../../features/forms/save-form';

const ratingVisibilityRoute = processRoute((all) => all.ratingVisibility.write);

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

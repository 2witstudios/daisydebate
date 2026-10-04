'use server';

import type { MockFormState } from '../../../features/mock-form/form';
import {
  parseNotificationsForm,
  parsePrivacyForm,
  parseProfileForm,
  savedHref,
} from '../../../features/settings/preferences';
import { runMockForm } from '../../../server/mock-form-action';

/**
 * Each settings form posts to its own server action: it works before
 * hydration and without JavaScript. A saved form returns to its section;
 * nothing is kept until an account stores preferences.
 */
export async function saveProfileAction(
  _state: MockFormState,
  form: unknown,
): Promise<MockFormState> {
  return runMockForm(form, parseProfileForm, () => savedHref('profile'));
}

export async function saveNotificationsAction(
  _state: MockFormState,
  form: unknown,
): Promise<MockFormState> {
  return runMockForm(form, parseNotificationsForm, () =>
    savedHref('notifications'),
  );
}

export async function savePrivacyAction(
  _state: MockFormState,
  form: unknown,
): Promise<MockFormState> {
  return runMockForm(form, parsePrivacyForm, () => savedHref('privacy'));
}

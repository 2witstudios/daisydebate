'use server';

import { cookies, headers } from 'next/headers';
import {
  onboardingHref,
  usernameHref,
} from '../../../../features/access/decision';
import {
  initialAgeForm,
  readAgeForm,
  type AgeFormState,
} from '../../../../features/account/age-form';
import {
  AGE_HOLD_COOKIE,
  AGE_HOLD_SECONDS,
} from '../../../../features/account/age-step';
import { returnableDestination } from '../../../../features/auth/redirect';
import { moveOn } from '../../../../server/form-action';
import { inProcessFetch } from '../../../../server/in-process-fetch';
import { processRoute } from '../../../../server/process-app';

const ageRoute = processRoute((routes) => routes.age.POST);

const refusalOf = async (response: Response) => {
  const body: unknown = await response.json().catch(() => null);
  const refusal = (body as { error?: { refusal?: unknown } } | null)?.error
    ?.refusal;
  return refusal === 'under-13' || refusal === 'below-floor' ? refusal : null;
};

/**
 * The age form's POST, as a server action: it works before hydration and
 * without JavaScript. It runs POST /api/account/age in process with this
 * request's headers, so every gate of that route applies and the server
 * alone bands the answer. Accepted (now or by an earlier answer), it moves on to the username step; an
 * age below the floor carries the route's day-long hold to the browser and
 * returns to the age step, which then shows the refusal.
 */
export async function ageStepAction(
  next: unknown,
  _state: AgeFormState,
  form: unknown,
): Promise<AgeFormState> {
  const destination = returnableDestination(
    typeof next === 'string' ? next : undefined,
  );
  const read = readAgeForm(form instanceof FormData ? form : new FormData());
  if (!read.ok) return read.state;
  const incoming = new Headers(await headers());
  const response = await inProcessFetch(ageRoute, incoming)(
    '/api/account/age',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(read.body),
    },
  );
  // 409: this account answered already and that first answer stands.
  if (response.ok || response.status === 409)
    return {
      ...initialAgeForm,
      ...moveOn(incoming, usernameHref(destination)),
    };
  const refusal = response.status === 403 ? await refusalOf(response) : null;
  if (refusal === null)
    return {
      month: String(read.body.month),
      year: String(read.body.year),
      terms: true,
      missing: [],
      unavailable: true,
    };
  (await cookies()).set(AGE_HOLD_COOKIE, refusal, {
    path: '/',
    maxAge: AGE_HOLD_SECONDS,
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
  });
  return {
    ...initialAgeForm,
    ...moveOn(incoming, onboardingHref(destination)),
  };
}

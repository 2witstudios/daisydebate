import type { GuardianRelation } from '@daisy/protocol/media-release';
import {
  formValues,
  idle,
  type FormValues,
  type Idle,
} from '../forms/form-state';
import { parentRefusalWords, textOf, ticked } from './parent-pages';

/** A parent form's refusal: what to show again, and why. */
type Refused = {
  readonly kind: 'refused';
  readonly values: FormValues;
  readonly error: string;
};
type Unacknowledged = {
  readonly kind: 'unacknowledged';
  readonly values: FormValues;
};

/** What the sign form became: signed (with what was signed), declined, or not for them. */
export type SignState =
  | Idle
  | Refused
  | Unacknowledged
  | {
      readonly kind: 'signed';
      readonly name: string;
      readonly relation: GuardianRelation;
      readonly paidAds: boolean;
      readonly signedAt: string;
    }
  | { readonly kind: 'answered'; readonly outcome: 'declined' | 'not_me' };

/** What a manage form became: withdrawn, paid ads changed, or refused. */
export type ManageState =
  | Idle
  | Refused
  | Unacknowledged
  | { readonly kind: 'withdrawn'; readonly what: 'whole' | 'paid_ads' }
  | { readonly kind: 'paid_ads_allowed' };

/** A form whose only answer is "sent" or "stopped": the link mail and the opt-out. */
export type SentState =
  Idle | Refused | Unacknowledged | { readonly kind: 'sent' };

export const initialSignState: SignState = idle();
export const initialManageState: ManageState = idle();
export const initialSentState: SentState = idle();

export const parentUnacknowledged = (form: FormData): Unacknowledged => ({
  kind: 'unacknowledged',
  values: formValues(form),
});

const parentRefused = (form: FormData, error: string): Refused => ({
  kind: 'refused',
  values: formValues(form),
  error,
});

/**
 * How a parent route answered, read once for every parent form: the JSON
 * answer, a refusal in words, or unacknowledged when the answer was lost.
 */
export const readParentAnswer = async (
  response: Response,
  form: FormData,
): Promise<
  | {
      readonly ok: true;
      readonly body: { readonly kind?: unknown; readonly reason?: unknown };
    }
  | { readonly ok: false; readonly state: Refused | Unacknowledged }
> => {
  if (response.status === 429)
    return {
      ok: false,
      state: parentRefused(
        form,
        'Too many tries from here. Try again in an hour.',
      ),
    };
  if (response.status >= 500)
    return { ok: false, state: parentUnacknowledged(form) };
  if (!response.ok)
    return {
      ok: false,
      state: parentRefused(
        form,
        'This page is not open. Check the link in your email.',
      ),
    };
  const body = (await response.json().catch(() => null)) as {
    readonly kind?: unknown;
    readonly reason?: unknown;
  } | null;
  if (body === null) return { ok: false, state: parentUnacknowledged(form) };
  if (body.kind === 'refused')
    return {
      ok: false,
      state: parentRefused(form, parentRefusalWords(String(body.reason))),
    };
  return { ok: true, body };
};

/** The signed facts the confirmation shows, from the accepted form. */
export const signedFrom = (
  form: FormData,
  signedAt: string,
): Extract<SignState, { kind: 'signed' }> => ({
  kind: 'signed',
  name: textOf(form, 'name').trim(),
  relation:
    textOf(form, 'relation') === 'legal_guardian' ? 'legal_guardian' : 'parent',
  paidAds: ticked(form, 'paidAds'),
  signedAt,
});

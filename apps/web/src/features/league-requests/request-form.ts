import {
  leagueRequestLimits,
  leagueRequestSchema,
  type LeagueRequest,
} from '@daisy/protocol/league-request';
import {
  formValues,
  idle,
  refusedWith,
  type FormValues,
  type Idle,
  type Refused,
  type Unacknowledged,
} from '../forms/form-state';

/**
 * The League "Talk to us" form (PYL-17): its fields, the one pure rule that
 * reads them, and the answers its action gives.
 */
export const requestFieldNames = [
  'requestId',
  'leagueName',
  'schools',
  'seasons',
  'style',
  'divisions',
  'needs',
  'contactName',
  'contactRole',
  'contactEmail',
  'contactPhone',
] as const;
export type RequestField = (typeof requestFieldNames)[number];

/**
 * The spam trap: a field people never see or fill. A post that fills it gets
 * the ordinary confirmation, and nothing is stored or sent.
 */
export const honeypotField = 'website';

export type RequestValues = Readonly<Record<RequestField, string>>;
export type FieldErrors = Readonly<Partial<Record<RequestField, string>>>;

/** The canvas's defaults: Freestyle is the only style, Youth leads divisions. */
export const blankRequest = (requestId: string): RequestValues => ({
  requestId,
  leagueName: '',
  schools: '10-25',
  seasons: '2',
  style: 'freestyle',
  divisions: 'youth',
  needs: '',
  contactName: '',
  contactRole: '',
  contactEmail: '',
  contactPhone: '',
});

const fieldMessages: Readonly<Record<RequestField, string>> = {
  requestId: 'This form has expired. Reload the page and send it again.',
  leagueName: `Enter your league's name, up to ${leagueRequestLimits.leagueName} characters.`,
  schools: 'Choose how many schools.',
  seasons: 'Choose how many seasons a year.',
  style: 'Choose a style.',
  divisions: 'Choose the divisions.',
  needs: `Keep this to ${leagueRequestLimits.needs.toLocaleString('en-US')} characters.`,
  contactName: `Enter your name, up to ${leagueRequestLimits.contactName} characters.`,
  contactRole: `Enter your role, up to ${leagueRequestLimits.contactRole} characters.`,
  contactEmail: 'Enter an email address we can reply to.',
  contactPhone: 'Enter a phone number, or leave it empty.',
};

/** How one posted form reads: a request to send, a trap to ignore, or what to fix. */
export type RequestReading =
  | { readonly kind: 'accepted'; readonly request: LeagueRequest }
  | { readonly kind: 'trapped' }
  | { readonly kind: 'incomplete'; readonly errors: FieldErrors };

const isRequestField = (key: PropertyKey): key is RequestField =>
  (requestFieldNames as readonly PropertyKey[]).includes(key);

/** The form's own fields from whatever was posted; anything missing reads as empty. */
export const requestValuesOf = (values: FormValues): RequestValues =>
  Object.fromEntries(
    requestFieldNames.map((name) => [name, values[name] ?? '']),
  ) as RequestValues;

/**
 * The one rule for a League request: total and pure. A filled trap wins over
 * everything; otherwise each field the protocol refuses gets its own message.
 */
export function leagueRequestOf(values: FormValues): RequestReading {
  if ((values[honeypotField] ?? '').trim() !== '') return { kind: 'trapped' };
  const parsed = leagueRequestSchema.safeParse({
    v: 1,
    ...requestValuesOf(values),
  });
  if (parsed.success) return { kind: 'accepted', request: parsed.data };
  const errors: Partial<Record<RequestField, string>> = {};
  for (const issue of parsed.error.issues) {
    const [name] = issue.path;
    if (name !== undefined && isRequestField(name))
      errors[name] ??= fieldMessages[name];
  }
  return { kind: 'incomplete', errors };
}

type RequestIdle = Idle & { readonly values: RequestValues };
type RequestRefused = Refused & { readonly values: RequestValues };
/** Some fields need fixing; the typed values come back with a message each. */
export type RequestIncomplete = {
  readonly kind: 'incomplete';
  readonly values: RequestValues;
  readonly errors: FieldErrors;
};
/** The request was received; the form gives way to the confirmation. */
export type RequestReceived = { readonly kind: 'received' };
type RequestUnacknowledged = Unacknowledged & {
  readonly values: RequestValues;
};

/** What the League request form's action answers. */
export type RequestFormState =
  | RequestIdle
  | RequestIncomplete
  | RequestRefused
  | RequestUnacknowledged
  | RequestReceived;

/** The form as first shown, under a request id chosen for it. */
export const initialRequestForm = (requestId: string): RequestFormState =>
  idle(blankRequest(requestId));

export const requestIncomplete = (
  values: RequestValues,
  errors: FieldErrors,
): RequestIncomplete => ({ kind: 'incomplete', values, errors });

/** A new object each time: the form tells a new answer from the last by identity. */
export const requestReceived = (): RequestReceived => ({ kind: 'received' });

/** Too many requests from this network: the typed values stay for later. */
export const requestRateLimited = (values: RequestValues): RequestRefused =>
  refusedWith(values, 'Too many requests right now. Try again later.');

/** The server could not take the request; it was not received. */
export const requestUnavailable = (values: RequestValues): RequestRefused =>
  refusedWith(values, 'We could not send your request. Try again.');

/** The answer was lost: the request may have arrived. */
export const requestUnacknowledged = (
  values: RequestValues,
): RequestUnacknowledged => ({ kind: 'unacknowledged', values });

/** What the form renders from each answer: the fields, their messages and the notice. */
export type RequestFields = {
  readonly values: RequestValues;
  readonly errors: FieldErrors;
  readonly notice: string | undefined;
};

const noErrors: FieldErrors = {};

export function requestFields(
  answer: Exclude<RequestFormState, RequestReceived>,
): RequestFields {
  switch (answer.kind) {
    case 'idle':
      return { values: answer.values, errors: noErrors, notice: undefined };
    case 'incomplete':
      return {
        values: answer.values,
        errors: answer.errors,
        notice: undefined,
      };
    case 'refused':
      return { values: answer.values, errors: noErrors, notice: answer.error };
    case 'unacknowledged':
      return {
        values: answer.values,
        errors: noErrors,
        notice:
          'We may not have received your request. Send it again; it will only arrive once.',
      };
  }
}

/** The answer when the call itself failed: the typed values kept, the post maybe received. */
export const requestLost = (form: FormData): RequestFormState =>
  requestUnacknowledged(requestValuesOf(formValues(form)));

import { createAppError } from '@daisy/errors';
import { messagingPreferenceSchemas } from '@daisy/protocol';
import { parseValidated } from '../../../server/http';
import type { Idle, Refused } from '../../forms/form-state';

/** The three selections a preference form holds, each as its option's value. */
type PreferenceValues = {
  readonly values: {
    readonly following: string;
    readonly hidden: string;
    readonly notificationLevel: string;
  };
};
export type PreferenceRefused = Refused & PreferenceValues;
/**
 * Saved: the page it was posted from is where it leads, so the form stays
 * and shows what the server now holds.
 */
export type PreferenceSaved = {
  readonly kind: 'saved';
  readonly values: PreferenceValues['values'];
  readonly next: string;
};

/** A preference form's answer. */
export type PreferenceFormState =
  (Idle & PreferenceValues) | PreferenceRefused | PreferenceSaved;

export const preferenceSaved = (
  values: PreferenceValues['values'],
  next: string,
): PreferenceSaved => ({ kind: 'saved', values, next });

/** What a preference form renders: its selections, a refusal, and where a save leads. */
export type PreferenceFields = PreferenceValues['values'] & {
  readonly notice: string | undefined;
  readonly next: string | undefined;
};

export function preferenceFields(
  answer: PreferenceFormState,
): PreferenceFields {
  switch (answer.kind) {
    case 'idle':
      return { ...answer.values, notice: undefined, next: undefined };
    case 'refused':
      return { ...answer.values, notice: answer.error, next: undefined };
    case 'saved':
      return { ...answer.values, notice: undefined, next: answer.next };
  }
}
function choice(form: FormData, key: string) {
  const value = form.get(key);
  if (typeof value !== 'string' || form.getAll(key).length !== 1)
    throw createAppError('VALIDATION');
  return value;
}
export function parsePreferenceForm(
  channelId: unknown,
  input: unknown,
):
  | {
      readonly operation: 'clear';
      readonly command: ReturnType<
        typeof messagingPreferenceSchemas.scope.parse
      >;
    }
  | {
      readonly operation: 'update';
      readonly command: ReturnType<
        typeof messagingPreferenceSchemas.update.parse
      >;
    } {
  if (!(input instanceof FormData)) throw createAppError('VALIDATION');
  const operation = choice(input, 'operation');
  if (operation === 'clear')
    return {
      operation,
      command: parseValidated(messagingPreferenceSchemas.scope, {
        version: 1,
        channelId,
      }),
    };
  if (operation !== 'update') throw createAppError('VALIDATION');
  const boolean = (key: string) => {
    const value = choice(input, key);
    if (value !== 'yes' && value !== 'no') throw createAppError('VALIDATION');
    return value === 'yes';
  };
  return {
    operation,
    command: parseValidated(messagingPreferenceSchemas.update, {
      version: 1,
      channelId,
      following: boolean('following'),
      hidden: boolean('hidden'),
      notificationLevel: choice(input, 'notificationLevel'),
    }),
  };
}
export function preferenceUnavailable(form: FormData): PreferenceRefused {
  const value = (key: string) => {
    const stored = form.get(key);
    return typeof stored === 'string' ? stored : '';
  };
  return {
    kind: 'refused',
    values: {
      following: value('following'),
      hidden: value('hidden'),
      notificationLevel: value('notificationLevel'),
    },
    error:
      'Could not change these preferences. Your selections are kept; try again.',
  };
}

type StoredPreference = ReturnType<
  typeof messagingPreferenceSchemas.result.parse
>['state'];

/** The selections that show a stored preference; none stored shows no choice. */
export const preferenceSelections = (
  state: StoredPreference,
): PreferenceValues['values'] => ({
  following: state === null ? '' : state.following ? 'yes' : 'no',
  hidden: state === null ? '' : state.hidden ? 'yes' : 'no',
  notificationLevel: state?.notificationLevel ?? '',
});

/** The form a page starts with: what is stored, nothing posted yet. */
export const preferenceFormState = (
  state: StoredPreference,
): PreferenceFormState => ({
  kind: 'idle',
  values: preferenceSelections(state),
});

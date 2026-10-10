import { createAppError } from '@daisy/errors';
import { messagingPreferenceSchemas } from '@daisy/protocol';
import { parseValidated } from '../../../server/http';
export type PreferenceFormState = {
  readonly following: string;
  readonly hidden: string;
  readonly notificationLevel: string;
  readonly notice?: string;
  readonly next?: string;
};
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
export function preferenceUnavailable(form: FormData): PreferenceFormState {
  const value = (key: string) => {
    const stored = form.get(key);
    return typeof stored === 'string' ? stored : '';
  };
  return {
    following: value('following'),
    hidden: value('hidden'),
    notificationLevel: value('notificationLevel'),
    notice:
      'Could not change these preferences. Your selections are kept; try again.',
  };
}

export function preferenceFormState(
  state: ReturnType<typeof messagingPreferenceSchemas.result.parse>['state'],
): PreferenceFormState {
  return {
    following: state === null ? '' : state.following ? 'yes' : 'no',
    hidden: state === null ? '' : state.hidden ? 'yes' : 'no',
    notificationLevel: state?.notificationLevel ?? '',
  };
}

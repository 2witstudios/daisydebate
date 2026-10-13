import { messagingPreferenceSchemas } from '@daisy/protocol';
export type PreferenceFormState = {
  readonly following: string;
  readonly hidden: string;
  readonly notificationLevel: string;
  readonly notice?: string;
  readonly next?: string;
};
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

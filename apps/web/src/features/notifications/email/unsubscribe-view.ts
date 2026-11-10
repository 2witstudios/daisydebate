import {
  isEmailedNotificationKind,
  type EmailedNotificationKind,
} from '@daisy/protocol';
import type { SearchParams } from '../../access/decision';

/** What the unsubscribe page shows: a confirm form, a done note, or a bad link. */
export type UnsubscribeView =
  | {
      readonly kind: 'confirm';
      readonly subject: EmailedNotificationKind;
      readonly fields: { readonly u: string; readonly k: string; readonly t: string };
    }
  | { readonly kind: 'done'; readonly subject: EmailedNotificationKind }
  | { readonly kind: 'invalid' };

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/**
 * The unsubscribe page's view from its query. It never checks the token:
 * the POST does, so the page reveals nothing about whether a link is valid
 * until the member acts on it.
 */
export const unsubscribeViewOf = (params: SearchParams): UnsubscribeView => {
  const done = first(params['done']);
  if (done !== undefined)
    return isEmailedNotificationKind(done)
      ? { kind: 'done', subject: done }
      : { kind: 'invalid' };
  const [u, k, t] = [
    first(params['u']),
    first(params['k']),
    first(params['t']),
  ];
  if (first(params['invalid']) !== undefined || !u || !k || !t)
    return { kind: 'invalid' };
  return isEmailedNotificationKind(k)
    ? { kind: 'confirm', subject: k, fields: { u, k, t } }
    : { kind: 'invalid' };
};

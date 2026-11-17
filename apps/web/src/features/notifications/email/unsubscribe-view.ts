import type { SearchParams } from '../../access/decision';

/** What the unsubscribe page shows: a confirm form, a done note, or a bad link. */
export type UnsubscribeView =
  | {
      readonly kind: 'confirm';
      readonly fields: { readonly u: string; readonly t: string };
    }
  | { readonly kind: 'done' }
  | { readonly kind: 'invalid' };

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/**
 * The unsubscribe page's view from its query. It never checks the token:
 * the POST does, so the page reveals nothing about whether a link is valid
 * until the member acts on it.
 */
export const unsubscribeViewOf = (params: SearchParams): UnsubscribeView => {
  if (first(params['done']) !== undefined) return { kind: 'done' };
  const [u, t] = [first(params['u']), first(params['t'])];
  if (first(params['invalid']) !== undefined || !u || !t)
    return { kind: 'invalid' };
  return { kind: 'confirm', fields: { u, t } };
};

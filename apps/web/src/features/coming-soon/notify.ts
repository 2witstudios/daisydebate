import { signInHref } from '../access/decision';
import { explainerHref } from './launch';
import type { DestinationSlug } from './destinations';

export type NotifyAction =
  | { readonly kind: 'sign-in'; readonly href: string }
  | { readonly kind: 'sample' };

/**
 * "Get notified" on an explainer. A visitor is sent to sign in (the
 * explainer promises a notice to accounts) and a signed-in member answers on
 * the same page with the shell banner. There is no notification backend, so
 * nothing subscribes anyone; the real subscription replaces the sample
 * branch.
 */
export const notifyAction = (
  slug: DestinationSlug,
  signedIn: boolean,
): NotifyAction =>
  signedIn
    ? { kind: 'sample' }
    : { kind: 'sign-in', href: signInHref(explainerHref(slug)) };

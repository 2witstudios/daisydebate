import { signInHref } from '../access/decision';
import { explainerHref } from './launch';
import type { DestinationSlug } from './destinations';

export type NotifyAction =
  | { readonly kind: 'sign-in'; readonly href: string }
  | { readonly kind: 'inert'; readonly reason: string };

/**
 * "Get notified" on an explainer. There is no notification backend, so a
 * visitor is sent to sign in (the explainer promises a notice to accounts)
 * and a signed-in member gets an inert control that says why. Nothing here
 * pretends to subscribe anyone; the real subscription operation replaces the
 * inert branch.
 */
export const notifyAction = (
  slug: DestinationSlug,
  signedIn: boolean,
): NotifyAction =>
  signedIn
    ? {
        kind: 'inert',
        reason: 'Notifications are not built yet, so this does nothing.',
      }
    : { kind: 'sign-in', href: signInHref(explainerHref(slug)) };

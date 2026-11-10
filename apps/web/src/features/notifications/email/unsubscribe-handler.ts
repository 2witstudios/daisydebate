import type { Database } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import { readBytes } from '../../../server/http';
import { verifyUnsubscribe } from './unsubscribe-token';

const MAX_BODY_BYTES = 1024;

/** A relative 303: the request's own origin is not trusted behind the proxy. */
const seeOther = (location: string) =>
  new Response(null, { status: 303, headers: { location } });

/** The posted form, read through a bounded stream; null when it is too large. */
const boundedForm = async (request: Request) => {
  if (!request.body) return new URLSearchParams();
  try {
    const bytes = await readBytes(request, MAX_BODY_BYTES);
    return new URLSearchParams(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
};

/**
 * POST /api/notifications/unsubscribe (ADR 0124): turns off one kind's email
 * for the member a keyed token names, with no session. A mail client's
 * RFC 8058 one-click POST names the member in the URL; the unsubscribe
 * page's native form posts the same fields and is sent back to the page.
 * A wrong token changes nothing and says only that the link is not valid.
 */
export function createUnsubscribeRoute(deps: {
  readonly store: Pick<Database, 'unsubscribeNotificationEmail'>;
  readonly subkey: () => string;
  readonly logger: Logger;
}) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const form = await boundedForm(request);
    if (!form) return new Response('Too large', { status: 413 });
    const field = (name: string) =>
      form.get(name) ?? url.searchParams.get(name);
    const fromPage = form.get('from') === 'page';
    const unsubscribe = verifyUnsubscribe(deps.subkey(), {
      userId: field('u'),
      kind: field('k'),
      token: field('t'),
    });
    if (!unsubscribe) {
      deps.logger.log(
        'notifications.unsubscribe_refused',
        { operation: 'notifications.unsubscribe' },
        'Unsubscribe link not valid',
      );
      return fromPage
        ? seeOther('/unsubscribe?invalid=1')
        : new Response('This link is not valid.', { status: 400 });
    }
    await deps.store.unsubscribeNotificationEmail(unsubscribe);
    deps.logger.log(
      'notifications.unsubscribed',
      { operation: 'notifications.unsubscribe' },
      'Notification email turned off',
    );
    return fromPage
      ? seeOther(`/unsubscribe?done=${unsubscribe.kind}`)
      : new Response('Unsubscribed.', { status: 200 });
  };
}

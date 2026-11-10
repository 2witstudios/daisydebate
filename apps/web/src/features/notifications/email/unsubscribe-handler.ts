import type { Database } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import { verifyUnsubscribe } from './unsubscribe-token';

const MAX_BODY_BYTES = 1024;

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
    const length = Number(request.headers.get('content-length') ?? '0');
    if (!Number.isFinite(length) || length > MAX_BODY_BYTES)
      return new Response('Too large', { status: 413 });
    const form = await request.formData().catch(() => new FormData());
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
        ? Response.redirect(new URL('/unsubscribe?invalid=1', url), 303)
        : new Response('This link is not valid.', { status: 400 });
    }
    await deps.store.unsubscribeNotificationEmail(unsubscribe);
    deps.logger.log(
      'notifications.unsubscribed',
      { operation: 'notifications.unsubscribe' },
      'Notification email turned off',
    );
    return fromPage
      ? Response.redirect(
          new URL(`/unsubscribe?done=${unsubscribe.kind}`, url),
          303,
        )
      : new Response('Unsubscribed.', { status: 200 });
  };
}

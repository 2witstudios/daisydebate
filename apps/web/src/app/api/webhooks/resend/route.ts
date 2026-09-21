import { handleOperation } from '../../../../server/http';
import { getMailWebhook } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Provider-signed, server-to-server: authenticity replaces the browser origin check. */
export function POST(request: Request) {
  return handleOperation(request, 'auth.mail.webhook', () =>
    getMailWebhook().handle(request),
  );
}

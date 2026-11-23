import { guardianCommandSchema } from '@daisy/protocol/guardians';
import { createAppError } from '@daisy/errors';
import type { App } from '../../server/app';
import { parseValidated, readJson } from '../../server/http';
import { memberHttpBoundary, runMemberRoute } from '../auth/member-boundary';
import { submitGuardianCommand } from './commands';

type Handler = (request: Request) => Promise<Response>;
type Defer = (work: () => Promise<void>) => void;
const budget = { max: 8, windowSeconds: 60 };

export function guardianCommandRoute(
  app: App,
  released: (accountId: string) => Promise<boolean>,
  authPost: Handler,
  defer: Defer,
): Handler {
  const boundary = { ...memberHttpBoundary(app), limiter: () => app.limiter };
  return (request) =>
    runMemberRoute(
      boundary,
      request,
      {
        name: 'parental-controls.command',
        readOnly: false,
        evaluatorDecides: true,
        bucket: 'parental-controls',
        rule: budget,
      },
      async (caller, { logger }) => {
        if (!(await released(caller.userId))) throw createAppError('NOT_FOUND');
        const command = parseValidated(
          guardianCommandSchema,
          await readJson(request),
        );
        const result = await submitGuardianCommand(
          app.database.guardians,
          caller,
          app.clock.now(),
          command,
          app.contactsPolicy.requests,
        );
        if (result.kind === 'refused') return Response.json(result);
        if (result.mail) {
          const { email, kind } = result.mail;
          const incoming = new Headers(request.headers);
          defer(async () => {
            try {
              const origin = new URL(boundary.origin()).origin;
              if (kind === 'sign-in') {
                const outgoing = new Headers(incoming);
                for (const header of [
                  'authorization',
                  'cookie',
                  'content-length',
                ])
                  outgoing.delete(header);
                outgoing.set('origin', origin);
                outgoing.set('content-type', 'application/json');
                await authPost(
                  new Request(new URL('/api/auth/sign-in/magic-link', origin), {
                    method: 'POST',
                    headers: outgoing,
                    body: JSON.stringify({
                      email,
                      callbackURL: '/onboarding/age',
                    }),
                  }),
                );
                return;
              }
              const href = new URL('/settings/your-parents', origin).toString();
              const confirmation = kind === 'confirm-link';
              const subject = confirmation
                ? 'Confirm a parent on Daisy'
                : 'A parent request on Daisy';
              const words = confirmation
                ? 'Someone asked to link to your Daisy account as your parent or legal guardian. Sign in to Daisy to review the request in Settings.'
                : 'Someone entered your email in Parental controls on Daisy. Your account has not changed.';
              await app.deliverMail('notification')({
                to: email,
                subject,
                text: confirmation ? `${words}\n\n${href}` : words,
                html: confirmation
                  ? `<p>${words}</p><p><a href="${href}">Review request</a></p>`
                  : `<p>${words}</p>`,
              });
            } catch {
              logger.log(
                'notification.mail.failed',
                {},
                'Parental controls email could not be sent',
              );
            }
          });
        }
        return Response.json({ kind: 'accepted' });
      },
    );
}

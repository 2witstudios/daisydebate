import { systemClock } from '@daisy/clock';
import {
  composeAuthServer,
  memoryTables,
  capturingSender,
} from '../auth/auth-server.test-support';
/** Two operation factories consume a real memory-backed signed participant session. */
export async function signedMessagingAuth(actorId: string, email: string) {
  const tables = memoryTables(),
    sender = capturingSender();
  let id = 0;
  const auth = composeAuthServer(
    {
      emailSender: sender,
      ids: { next: () => 's' + String(++id).padStart(23, '0') },
      clock: systemClock,
      getActorByUserId: async (userId) => ({ id: actorId, userId }),
    },
    tables,
  );
  await auth.instance.api.signInMagicLink({
    body: { email },
    headers: new Headers({ origin: auth.config.PUBLIC_APP_URL }),
  });
  const url = sender.sent[0]?.html.match(/href="([^"]+)"/)?.[1];
  if (!url) throw new Error('Magic link missing');
  const token = new URL(url.replaceAll('&amp;', '&')).searchParams.get('token');
  const verified = await auth.instance.handler(
    new Request(
      auth.config.PUBLIC_APP_URL + '/api/auth/magic-link/verify?token=' + token,
    ),
  );
  const cookie = verified.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const user = tables.user[0];
  if (!cookie || !user) throw new Error('Verified member session missing');
  user.username = 'messagingmember';
  return { auth, cookie, user };
}

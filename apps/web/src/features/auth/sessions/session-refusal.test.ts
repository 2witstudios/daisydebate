import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { BetterAuthOptions } from 'better-auth';
import { memoryAdapter } from '@better-auth/memory-adapter';
import { isCapacityRefusal } from '@daisy/db/capacity';
import { refuseCapacity } from '@daisy/db/testing';
import { createAppError } from '@daisy/errors';
import { resolveSession } from '../../../lib/identity';
import {
  authTestEnv,
  composeAuthServer,
  memoryTables,
} from '../auth-server.test-support';

setupRitewayBun();

/** better-call's signed cookie, so the read reaches the session store. */
const signedCookie = async (name: string, value: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authTestEnv.BETTER_AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)),
  );
  const signed = `${value}.${btoa(String.fromCharCode(...signature))}`;
  return `${name}=${encodeURIComponent(signed)}`;
};

const resolveWithStoreFailing = async (failure: Error) => {
  const underlying = memoryAdapter(memoryTables());
  // Real Better Auth composition, with only the database edge replaced.
  const database: BetterAuthOptions['database'] = (options) =>
    new Proxy(underlying(options), {
      get: (target, property) =>
        String(property) === 'findOne' || String(property) === 'findMany'
          ? async () => {
              throw failure;
            }
          : Reflect.get(target, property),
    });
  const server = composeAuthServer({ database });
  const { authCookies } = await server.instance.$context;
  const cookie = await signedCookie(authCookies.sessionToken.name, 'the-token');
  return resolveSession(server, new Headers({ cookie }));
};

test('a session read keeps a refusal Better Auth would drop', async () => {
  const refused = await resolveWithStoreFailing(
    new Error('driver wrapper', { cause: refuseCapacity() }),
  );
  const failed = await resolveWithStoreFailing(
    createAppError('INFRASTRUCTURE'),
  );
  const causeOf = (identity: typeof refused.identity) =>
    identity.state === 'unavailable' ? identity.cause : 'not unavailable';
  assert({
    given: 'a session store that refuses, and one that really fails',
    should:
      'resolve both unavailable, and only the refusal be recognised as one',
    actual: [
      refused.identity.state,
      isCapacityRefusal(causeOf(refused.identity)),
      failed.identity.state,
      isCapacityRefusal(causeOf(failed.identity)),
    ],
    expected: ['unavailable', true, 'unavailable', false],
  });
});

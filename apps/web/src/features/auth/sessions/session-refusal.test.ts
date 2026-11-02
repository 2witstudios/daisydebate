import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { BetterAuthOptions } from 'better-auth';
import { memoryAdapter } from '@better-auth/memory-adapter';
import { refuseCapacity } from '@daisy/db/testing';
import { createAppError } from '@daisy/errors';
import { resolveSession } from '../../../lib/identity';
import { keepingSessionRefusal, noteSessionRefusal } from './session-refusal';
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
  assert({
    given: 'a session store that refuses, and one that really fails',
    should: 'mark only the refused identity temporary',
    actual: [refused.identity, failed.identity],
    expected: [
      {
        state: 'unavailable',
        principal: { kind: 'anonymous' },
        temporary: true,
      },
      { state: 'unavailable', principal: { kind: 'anonymous' } },
    ],
  });
});

test('a logged refusal never replaces a different failure', async () => {
  const refusal = new Error('refused');
  const other = new Error('plugin bug');
  const failing = (error: unknown) => () =>
    keepingSessionRefusal(async () => {
      noteSessionRefusal(refusal);
      throw error;
    }).catch((caught: unknown) => caught);
  assert({
    given: "a refusal logged, then Better Auth's bare failure or another error",
    should: 'swap in the refusal only for the bare failure',
    actual: [
      await failing({ body: { code: 'FAILED_TO_GET_SESSION' } })(),
      await failing(other)(),
    ],
    expected: [refusal, other],
  });
});

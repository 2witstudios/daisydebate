import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { resolveIdentity, type VerifiedSession } from './identity';

setupRitewayBun();

const now = () => '2026-01-01T12:00:00.000Z';
const pause = async () => undefined;
const session = (
  overrides: Partial<VerifiedSession> = {},
): VerifiedSession => ({
  userId: 'user1',
  emailVerified: true,
  username: 'ada',
  expiresAt: '2026-01-02T00:00:00.000Z',
  ...overrides,
});
const resolveWith = (found: VerifiedSession | null, cookie = 'c=1') =>
  resolveIdentity({
    cookie,
    readSession: async () => found,
    readActor: async (userId) => ({ id: 'actor1', userId }),
    now,
    pause,
  });

describe('resolveIdentity', () => {
  test('a verified, unexpired session with a username is a member', async () => {
    assert({
      given: 'a live session whose user completed onboarding',
      should: 'grant debate:create only',
      actual: await resolveWith(session()),
      expected: {
        state: 'member',
        username: 'ada',
        principal: {
          kind: 'user',
          userId: 'user1',
          actorId: 'actor1',
        },
      },
    });
  });

  test('a session without a username is provisional and holds no permission', async () => {
    assert({
      given: 'a verified user who has not claimed a username',
      should: 'resolve to a user principal with no permissions',
      actual: await resolveWith(session({ username: null })),
      expected: {
        state: 'provisional',
        principal: { kind: 'user', userId: 'user1', actorId: null },
      },
    });
  });

  test('member identity is the durable actor mapping', async () => {
    assert({
      given: 'a verified username with a missing or foreign actor row',
      should: 'resolve unavailable instead of inventing an actor',
      actual: await resolveIdentity({
        cookie: 'c=1',
        readSession: async () => session(),
        readActor: async () => ({ id: 'actor1', userId: 'foreign' }),
        now,
        pause,
      }),
      expected: { state: 'unavailable', principal: { kind: 'anonymous' } },
    });
  });
  test('absent, unverified and expired sessions are anonymous', async () => {
    const anonymous = { state: 'anonymous', principal: { kind: 'anonymous' } };
    assert({
      given: 'no session, an unverified email and an expired session',
      should: 'all resolve anonymous',
      actual: [
        await resolveWith(null),
        await resolveWith(session({ emailVerified: false })),
        await resolveWith(session({ expiresAt: '2026-01-01T12:00:00.000Z' })),
        await resolveWith(session({ expiresAt: 'not a date' })),
      ],
      expected: [anonymous, anonymous, anonymous, anonymous],
    });
  });

  test('a missing cookie skips the lookup', async () => {
    let looked = false;
    const result = await resolveIdentity({
      readActor: async (userId) => ({ id: 'actor1', userId }),
      cookie: null,
      readSession: async () => {
        looked = true;
        return session();
      },
      now,
      pause,
    });
    assert({
      given: 'a request with no cookie header',
      should: 'resolve anonymous without reading a session',
      actual: [result.state, looked],
      expected: ['anonymous', false],
    });
  });

  test('a failing lookup resolves unavailable with no permissions, never a guess', async () => {
    const result = await resolveIdentity({
      readActor: async (userId) => ({ id: 'actor1', userId }),
      cookie: 'c=1',
      readSession: async () => {
        throw new Error('database down');
      },
      now,
      pause,
    });
    assert({
      given: 'a session store that throws',
      should: 'fail closed as unavailable, holding no principal permissions',
      actual: result,
      expected: { state: 'unavailable', principal: { kind: 'anonymous' } },
    });
  });

  test('request-supplied roles and identity fields are ignored', async () => {
    const forged = {
      ...session({ username: null }),
      permissions: ['debate:manage'],
      role: 'admin',
      kind: 'service',
    } as VerifiedSession;
    assert({
      given: 'a lookup result carrying extra role and permission fields',
      should: 'derive the principal only from the verified facts',
      actual: (await resolveWith(forged)).principal,
      expected: { kind: 'user', userId: 'user1', actorId: null },
    });
  });
  test('an actor-store outage cannot establish a member identity', async () => {
    assert({
      given: 'a valid session followed by an unavailable durable actor mapping',
      should:
        'fail closed without exposing the store exception or guessing identity',
      actual: await resolveIdentity({
        cookie: 'c=1',
        readSession: async () => session(),
        readActor: async () => {
          throw new Error('private store failure');
        },
        now,
        pause,
      }),
      expected: { state: 'unavailable', principal: { kind: 'anonymous' } },
    });
  });

  test('a store read that throws once is retried after the pause', async () => {
    const steps: string[] = [];
    let sessionReads = 0;
    let actorReads = 0;
    const result = await resolveIdentity({
      cookie: 'c=1',
      readSession: async () => {
        sessionReads += 1;
        steps.push(`session${sessionReads}`);
        if (sessionReads === 1) throw new Error('connection reset');
        return session();
      },
      readActor: async (userId) => {
        actorReads += 1;
        steps.push(`actor${actorReads}`);
        if (actorReads === 1) throw new Error('connection reset');
        return { id: 'actor1', userId };
      },
      now,
      pause: async () => {
        steps.push('pause');
      },
    });
    assert({
      given: 'a session read and an actor read that each fail once',
      should: 'pause, read again, and resolve the member',
      actual: { state: result.state, steps },
      expected: {
        state: 'member',
        steps: ['session1', 'pause', 'session2', 'actor1', 'pause', 'actor2'],
      },
    });
  });

  test('a store that keeps throwing is tried twice, then fails closed', async () => {
    let reads = 0;
    let pauses = 0;
    const result = await resolveIdentity({
      cookie: 'c=1',
      readSession: async () => {
        reads += 1;
        throw new Error('database down');
      },
      readActor: async (userId) => ({ id: 'actor1', userId }),
      now,
      pause: async () => {
        pauses += 1;
      },
    });
    assert({
      given: 'a session store that throws on every read',
      should: 'read twice with one pause between, then resolve unavailable',
      actual: { result, reads, pauses },
      expected: {
        result: { state: 'unavailable', principal: { kind: 'anonymous' } },
        reads: 2,
        pauses: 1,
      },
    });
  });

  test('a refusal the store returns is not retried', async () => {
    let reads = 0;
    let pauses = 0;
    const result = await resolveIdentity({
      cookie: 'c=1',
      readSession: async () => {
        reads += 1;
        return session();
      },
      readActor: async () => ({ id: 'actor1', userId: 'foreign' }),
      now,
      pause: async () => {
        pauses += 1;
      },
    });
    assert({
      given: 'a foreign actor row returned without an error',
      should: 'resolve unavailable at once, without pausing or rereading',
      actual: { state: result.state, reads, pauses },
      expected: { state: 'unavailable', reads: 1, pauses: 0 },
    });
  });
});

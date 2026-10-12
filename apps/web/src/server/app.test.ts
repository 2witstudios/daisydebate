import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock, sequentialId } from '@daisy/clock';
import { rejectionOf } from '@daisy/errors/testing';
import { authTestEnv } from '../features/auth/auth-server.test-support';
import { createApp } from './app';
import { createRoutes } from './routes';

setupRitewayBun();

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
  REDIS_URL: 'redis://localhost:6379',
  REDIS_NAMESPACE: 'unit-a',
  PUBLIC_APP_URL: 'http://localhost:3000',
  LOG_LEVEL: 'silent',
};

type Sent = { readonly url: string; readonly to: string };

/** A fetch that records Resend calls and answers them, touching no network. */
function recordingFetch() {
  const sent: Sent[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { to: string[] };
    sent.push({ url: String(input), to: body.to[0] ?? '' });
    return Response.json({ id: `msg_${sent.length}` });
  };
  return { sent, fetch };
}

const build = (env: Record<string, string>, fetch = recordingFetch().fetch) =>
  createApp({
    env,
    fetch,
    clock: fixedClock('2026-09-23T00:00:00.000Z'),
    ids: sequentialId('app'),
  });

const errorOf = (run: () => unknown) => {
  try {
    run();
    return '';
  } catch (error) {
    return String(error);
  }
};

describe('createApp', () => {
  test('builds independent instances from their own environments', async () => {
    const first = build({ ...baseEnv, FOUNDATION_PROOF_ENABLED: 'true' });
    const second = build({
      ...baseEnv,
      REDIS_NAMESPACE: 'unit-b',
      PUBLIC_APP_URL: 'https://second.example',
    });
    first.drain();
    const observed = {
      first: [
        first.config.FOUNDATION_PROOF_ENABLED,
        first.config.REDIS_NAMESPACE,
        first.isDraining(),
      ],
      second: [
        second.config.FOUNDATION_PROOF_ENABLED,
        second.config.REDIS_NAMESPACE,
        second.isDraining(),
      ],
    };
    await Promise.all([first.close(), second.close()]);
    assert({
      given: 'two apps built in one process from different environments',
      should: 'keep each validated config and drain state to its own instance',
      actual: observed,
      expected: {
        first: [true, 'unit-a', true],
        second: [false, 'unit-b', false],
      },
    });
  });

  test('refuses an invalid environment naming fields, never values', () => {
    const message = errorOf(() =>
      build({
        ...baseEnv,
        DATABASE_URL: 'mysql://unit:SECRET@localhost:3306/unit',
      }),
    );
    assert({
      given: 'an environment whose database URL fails validation',
      should: 'throw naming the field without echoing its value',
      actual: {
        names: message.includes('DATABASE_URL'),
        leaks: message.includes('SECRET'),
      },
      expected: { names: true, leaks: false },
    });
  });

  test('validates auth configuration only when auth is first used', async () => {
    const app = build({
      ...baseEnv,
      ...authTestEnv,
      BETTER_AUTH_SECRET: 'too-short',
    });
    const message = errorOf(() => app.auth());
    await app.close();
    assert({
      given: 'a baseline-valid environment with an invalid auth secret',
      should:
        'build the app, then refuse auth naming the field without its value',
      actual: {
        names: message.includes('BETTER_AUTH_SECRET'),
        leaks: message.includes('too-short'),
      },
      expected: { names: true, leaks: false },
    });
  });

  test('composes auth once per instance', async () => {
    const app = build({ ...baseEnv, ...authTestEnv });
    const same = app.auth() === app.auth();
    await app.close();
    assert({
      given: 'two reads of one app instance auth',
      should: 'return the same composed server',
      actual: same,
      expected: true,
    });
  });

  test('exposes attachment operations as unavailable until an explicit runtime is supplied', async () => {
    const app = build({ ...baseEnv, ...authTestEnv });
    const unavailable = app.messagingFiles;
    await app.close();
    assert({
      given:
        'an app created without file storage, scanning and sanitizing ports',
      should: 'expose no implicit attachment runtime',
      actual: unavailable,
      expected: null,
    });
  });

  test('refuses the delivery webhook without a signing secret', async () => {
    const app = build({ ...baseEnv, ...authTestEnv });
    const refusal = await rejectionOf(() => app.mailWebhook());
    await app.close();
    assert({
      given: 'auth configuration without RESEND_WEBHOOK_SECRET',
      should: 'refuse to compose the webhook as an infrastructure error',
      actual: refusal,
      expected: { code: 'INFRASTRUCTURE' },
    });
  });
});

test('ordinary app configuration activates canonical Room authentication and origin gates', async () => {
  const policy = JSON.stringify({
    consentTtlMs: 34567,
    maxOpenRooms: 9,
    maxBodyBytes: 98765,
    limits: Object.fromEntries(
      ['create', 'read', 'command'].map((operation) => [
        operation,
        { max: 11, windowSeconds: 37 },
      ]),
    ),
  });
  const inert = build(baseEnv);
  const configured = build({
    ...baseEnv,
    ...authTestEnv,
    ROOM_POLICY: policy,
  });
  const routes = createRoutes(configured);
  const request = () => new Request(`${authTestEnv.PUBLIC_APP_URL}/api/rooms`);
  const unavailable = await createRoutes(inert).rooms.list(request());
  const anonymous = await routes.rooms.list(request());
  const foreign = await routes.rooms.create(
    new Request(`${authTestEnv.PUBLIC_APP_URL}/api/rooms`, {
      method: 'POST',
      headers: { origin: 'https://foreign.invalid' },
    }),
  );
  await Promise.all([inert.close(), configured.close()]);
  assert({
    given:
      'real createApp called as the ordinary process edge calls it, with only env policy',
    should:
      'preserve absent-policy 404 and use canonical 401/403 gates when configured',
    actual: [
      unavailable.status,
      anonymous.status,
      foreign.status,
      configured.roomPolicy?.maxOpenRooms,
    ],
    expected: [404, 401, 403, 9],
  });
});
test('refuses a reaction policy whose own overlay could exceed its contract', () => {
  const policy = (choices: number, reactionUnits = 8) =>
    ({
      reactions: {
        reactionUnits,
        choices: Array.from({ length: choices }, (_, index) => `r${index}`),
      },
    }) as unknown as NonNullable<
      Parameters<typeof createApp>[0]['messagingPolicy']
    >;
  const compose = (messagingPolicy: ReturnType<typeof policy>) => () =>
    createApp({
      env: baseEnv,
      messagingPolicy,
      fetch: recordingFetch().fetch,
      clock: fixedClock('2026-09-23T00:00:00.000Z'),
      ids: sequentialId('app'),
    });
  assert({
    given: 'eight choices, nine choices and 17-unit reactions',
    should: 'compose only a policy every own overlay can represent',
    actual: [
      errorOf(compose(policy(8))),
      errorOf(compose(policy(9))).includes('overlay contract'),
      errorOf(compose(policy(2, 17))).includes('overlay contract'),
    ],
    expected: ['', true, true],
  });
});

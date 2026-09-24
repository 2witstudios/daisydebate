import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock, sequentialId } from '@daisy/clock';
import { isAppError } from '@daisy/errors';
import { createApp } from './app';

setupRitewayBun();

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
  REDIS_URL: 'redis://localhost:6379',
  REDIS_NAMESPACE: 'unit-a',
  PUBLIC_APP_URL: 'http://localhost:3000',
  LOG_LEVEL: 'silent',
};
const authEnv = {
  BETTER_AUTH_SECRET:
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  RESEND_API_KEY: 're_test_000000000000000000000000',
  AUTH_EMAIL_FROM: 'Daisy <no-reply@daisy.example.com>',
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
      ...authEnv,
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
    const app = build({ ...baseEnv, ...authEnv });
    const same = app.auth() === app.auth();
    await app.close();
    assert({
      given: 'two reads of one app instance auth',
      should: 'return the same composed server',
      actual: same,
      expected: true,
    });
  });

  test('refuses the delivery webhook without a signing secret', async () => {
    const app = build({ ...baseEnv, ...authEnv });
    let code = '';
    try {
      app.mailWebhook();
    } catch (error) {
      code = isAppError(error) ? error.code : 'not-an-app-error';
    }
    await app.close();
    assert({
      given: 'auth configuration without RESEND_WEBHOOK_SECRET',
      should: 'refuse to compose the webhook as an infrastructure error',
      actual: code,
      expected: 'INFRASTRUCTURE',
    });
  });
});

import type { Identity } from '@daisy/auth';
import { noopErrorReporter } from '@daisy/observability';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createMessageRequestSettingRoute } from './request-setting-route';

setupRitewayBun();

const origin = 'https://daisy.invalid';
const principal = {
  kind: 'user',
  userId: 'abcdefghijklmnopqrstuvwx',
  actorId: 'bcdefghijklmnopqrstuvwxy',
} as const;

const routeFor = (identity: Identity | null) => {
  const writes: unknown[] = [];
  const route = createMessageRequestSettingRoute({
    logger: silentLogger,
    reporter: noopErrorReporter,
    origin: () => origin,
    identify: async () =>
      identity ?? ({ state: 'anonymous' } as unknown as Identity),
    limiter: () =>
      ({
        consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
      }) as never,
    store: {
      writeMessageRequestSetting: async (input) => {
        writes.push(input);
      },
    },
  });
  const post = (body: unknown) =>
    route(
      new Request(`${origin}/api/messaging/request-setting`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify(body),
      }),
    );
  return { writes, post };
};

test('the request setting route stores the member’s own choice only', async () => {
  const member = routeFor({ state: 'member', username: 'sam', principal });
  const statuses = [
    (await member.post({ version: 1, setting: 'friends' })).status,
    (await member.post({ version: 1, setting: 'none' })).status,
    (await member.post({ version: 1, setting: 'strangers' })).status,
    (await member.post({ version: 2, setting: 'none' })).status,
  ];
  const visitor = routeFor(null);
  const refused = (await visitor.post({ version: 1, setting: 'none' })).status;
  assert({
    given:
      'a member choosing Friends only and No one, an unknown value, a wrong version and a visitor',
    should:
      'store both choices for the member’s own account and refuse the rest without writing',
    actual: {
      statuses,
      writes: member.writes,
      refused: refused >= 400,
      visitorWrites: visitor.writes,
    },
    expected: {
      statuses: [200, 200, 400, 400],
      writes: [
        { userId: principal.userId, setting: 'friends' },
        { userId: principal.userId, setting: 'none' },
      ],
      refused: true,
      visitorWrites: [],
    },
  });
});

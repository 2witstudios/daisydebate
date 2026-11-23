import type { Identity } from '@daisy/auth';
import { CLIENT_IP_HEADER } from '@daisy/ingress/client-ip';
import { noopErrorReporter } from '@daisy/observability';
import type { SupportMessage } from '@daisy/protocol/support-message';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RateRule } from '../../server/rate-limit';
import { allowEvery } from '../../server/rate-limit.test-support';
import { silentLogger } from '../../server/test-loggers.test-support';
import {
  createSupportHandlers,
  senderOf,
  supportClientRules,
  supportEveryoneRule,
  supportProbeRule,
} from './handlers';

setupRitewayBun();

const origin = 'https://daisy.example';
const userId = 'u5e7r1d2w8e7r6t5y4u3i2o1';
const body: SupportMessage = {
  v: 1,
  messageId: 'k3v9q2w8e7r6t5y4u3i2o1pa',
  topic: 'problem',
  message: 'The timer froze in my round.',
  about: '',
  replyEmail: 'sam@example.test',
};

const visitor: Identity = {
  state: 'anonymous',
  principal: { kind: 'anonymous' },
};
const member: Identity = {
  state: 'member',
  username: 'sam',
  principal: { kind: 'user', userId, actorId: 'a5e7r1d2w8e7r6t5y4u3i2o1' },
};

const post = (payload: unknown, headers: Record<string, string> = {}) =>
  new Request(`${origin}/api/support`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      [CLIENT_IP_HEADER]: '198.18.0.7',
      ...headers,
    },
    body: JSON.stringify(payload),
  });

type Stored = Parameters<
  Parameters<typeof createSupportHandlers>[0]['store']['recordSupportMessage']
>[0];

const routeWith = (input: {
  readonly identity?: Identity;
  readonly unchanged?: boolean;
  readonly consume?: (
    key: string,
    rule: RateRule,
  ) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}) => {
  const stored: Stored[] = [];
  const consumed: Array<{ key: string; rule: RateRule }> = [];
  const lookedUp: Array<string | null> = [];
  const route = createSupportHandlers({
    logger: silentLogger,
    reporter: noopErrorReporter,
    origin: () => origin,
    identify: async () => input.identity ?? visitor,
    limiter: () => ({
      consume: async (key, rule) => {
        consumed.push({ key, rule });
        return (input.consume ?? allowEvery)(key, rule);
      },
    }),
    newId: () => 'n3w1d2w8e7r6t5y4u3i2o1pa',
    store: {
      supportMessageUnchanged: async (_message, memberUserId) => {
        lookedUp.push(memberUserId);
        return input.unchanged ?? false;
      },
      recordSupportMessage: async (record) => {
        stored.push(record);
      },
    },
  });
  return { route, stored, consumed, lookedUp };
};

test('senderOf', () => {
  assert({
    given: 'a visitor, a restricted account and an unreadable session store',
    should: 'record the restricted account, and nobody for the other two',
    actual: [
      senderOf(visitor),
      senderOf({
        state: 'restricted',
        username: 'sam',
        principal: { kind: 'user', userId, actorId: 'a'.repeat(24) },
      }),
      senderOf({ state: 'unavailable', principal: { kind: 'anonymous' } }),
    ],
    expected: [null, userId, null],
  });
});

test('POST /api/support', async () => {
  {
    const { route, stored, consumed } = routeWith({});
    const response = await route.POST(post(body));
    assert({
      given: 'a valid message from a visitor',
      should:
        'limit by that client and for everyone, then store it under nobody',
      actual: {
        status: response.status,
        answer: await response.json(),
        stored,
        consumed,
      },
      expected: {
        status: 200,
        answer: { received: true },
        stored: [
          {
            message: body,
            memberUserId: null,
            newId: 'n3w1d2w8e7r6t5y4u3i2o1pa',
          },
        ],
        consumed: [
          { key: 'support:probe:198.18.0.7', rule: supportProbeRule },
          ...supportClientRules.map((rule) => ({
            key: `support:client:198.18.0.7:${rule.windowSeconds}`,
            rule,
          })),
          { key: 'support:everyone', rule: supportEveryoneRule },
        ],
      },
    });
  }

  {
    const { route, stored, lookedUp } = routeWith({ identity: member });
    await route.POST(post(body));
    assert({
      given: 'a valid message from a signed-in member',
      should: 'record it against their account, read from the session',
      actual: {
        lookedUp,
        member: stored.map((record) => record.memberUserId),
      },
      expected: { lookedUp: [userId], member: [userId] },
    });
  }

  {
    const { route, stored, consumed } = routeWith({ unchanged: true });
    const response = await route.POST(post(body));
    assert({
      given: 'a resend of a message already stored unchanged',
      should:
        'answer received after the probe, without spending message allowance or writing',
      actual: {
        status: response.status,
        answer: await response.json(),
        stored,
        consumed: consumed.map(({ key }) => key),
      },
      expected: {
        status: 200,
        answer: { received: true },
        stored: [],
        consumed: ['support:probe:198.18.0.7'],
      },
    });
  }

  {
    const { route, stored } = routeWith({
      consume: async (key) => ({
        allowed: !key.startsWith('support:client:'),
        retryAfterSeconds: 60,
      }),
    });
    const response = await route.POST(post(body));
    assert({
      given: 'a client over its limit',
      should: 'refuse with 429 and store nothing',
      actual: { status: response.status, stored },
      expected: { status: 429, stored: [] },
    });
  }

  {
    const { route, stored } = routeWith({
      consume: async (key) => ({
        allowed: key !== 'support:everyone',
        retryAfterSeconds: 60,
      }),
    });
    const response = await route.POST(post(body));
    assert({
      given: 'everyone over the daily ceiling',
      should: 'refuse with 429 and store nothing',
      actual: { status: response.status, stored },
      expected: { status: 429, stored: [] },
    });
  }

  {
    const { route, stored } = routeWith({
      consume: async () => {
        throw new Error('redis down');
      },
    });
    const response = await route.POST(post(body));
    assert({
      given: 'the limiter unavailable',
      should: 'fail closed and store nothing',
      actual: { status: response.status, stored },
      expected: { status: 503, stored: [] },
    });
  }

  {
    const { route, consumed } = routeWith({});
    await route.POST(
      new Request(`${origin}/api/support`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify(body),
      }),
    );
    assert({
      given: 'a request the ingress stamped no client for',
      should: 'share one bucket rather than go unlimited',
      actual: consumed.map(({ key }) => key).slice(0, 2),
      expected: ['support:probe:unresolved', 'support:client:unresolved:3600'],
    });
  }

  {
    const { route, stored, consumed } = routeWith({ identity: member });
    const answers = await Promise.all([
      route.POST(post({ ...body, memberUserId: 'a'.repeat(24) })),
      route.POST(post({ ...body, topic: 'billing' })),
      route.POST(post(body, { origin: 'https://elsewhere.example' })),
    ]);
    assert({
      given:
        'a body naming its own member, a topic outside the vocabulary, and another origin',
      should: 'refuse each before limiting or storing anything',
      actual: {
        statuses: answers.map((answer) => answer.status),
        stored,
        consumed,
      },
      expected: { statuses: [400, 400, 403], stored: [], consumed: [] },
    });
  }
});

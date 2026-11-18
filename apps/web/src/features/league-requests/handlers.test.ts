import { CLIENT_IP_HEADER } from '@daisy/ingress/client-ip';
import { noopErrorReporter } from '@daisy/observability';
import type { LeagueRequest } from '@daisy/protocol/league-request';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RateRule } from '../../server/rate-limit';
import { allowEvery } from '../../server/rate-limit.test-support';
import { silentLogger } from '../../server/test-loggers.test-support';
import {
  createLeagueRequestHandlers,
  leagueRequestClientRules,
  leagueRequestEveryoneRule,
  leagueRequestProbeRule,
} from './handlers';

setupRitewayBun();

const origin = 'https://daisy.example';
const body: LeagueRequest = {
  v: 1,
  requestId: 'k3v9q2w8e7r6t5y4u3i2o1pa',
  leagueName: 'Gulf Coast Speech League',
  schools: '10-25',
  seasons: '2',
  style: 'freestyle',
  divisions: 'youth',
  needs: '',
  contactName: 'Dana Whitfield',
  contactRole: 'League director',
  contactEmail: 'dana@gulfcoastspeech.org',
  contactPhone: '',
};

const post = (payload: unknown, headers: Record<string, string> = {}) =>
  new Request(`${origin}/api/league-requests`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      [CLIENT_IP_HEADER]: '198.18.0.7',
      ...headers,
    },
    body: JSON.stringify(payload),
  });

const routeWith = (input: {
  readonly released?: boolean;
  readonly unchanged?: boolean;
  readonly consume?: (
    key: string,
    rule: RateRule,
  ) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}) => {
  const stored: LeagueRequest[] = [];
  const consumed: Array<{ key: string; rule: RateRule }> = [];
  const route = createLeagueRequestHandlers({
    logger: silentLogger,
    reporter: noopErrorReporter,
    origin: () => origin,
    limiter: () => ({
      consume: async (key, rule) => {
        consumed.push({ key, rule });
        return (input.consume ?? allowEvery)(key, rule);
      },
    }),
    newId: () => 'n3w1d2w8e7r6t5y4u3i2o1pa',
    store: {
      leagueRequestUnchanged: async () => input.unchanged ?? false,
      recordLeagueRequest: async (request) => {
        stored.push(request);
      },
    },
  });
  return {
    route: { POST: route.POST(async () => input.released ?? true) },
    stored,
    consumed,
  };
};

test('POST /api/league-requests', async () => {
  {
    const { route, stored, consumed } = routeWith({});
    const response = await route.POST(post(body));
    assert({
      given: 'a valid request from a client, the release open',
      should: 'limit by that client and for everyone, then store it',
      actual: {
        status: response.status,
        answer: await response.json(),
        stored,
        consumed,
      },
      expected: {
        status: 200,
        answer: { received: true },
        stored: [body],
        consumed: [
          {
            key: 'league-request:probe:198.18.0.7',
            rule: leagueRequestProbeRule,
          },
          ...leagueRequestClientRules.map((rule) => ({
            key: `league-request:client:198.18.0.7:${rule.windowSeconds}`,
            rule,
          })),
          { key: 'league-request:everyone', rule: leagueRequestEveryoneRule },
        ],
      },
    });
  }

  {
    const { route, stored, consumed } = routeWith({ unchanged: true });
    const response = await route.POST(post(body));
    assert({
      given: 'a resend of a request already stored unchanged',
      should:
        'answer received after the probe, without spending request allowance or writing',
      actual: {
        status: response.status,
        answer: await response.json(),
        stored,
        consumed,
      },
      expected: {
        status: 200,
        answer: { received: true },
        stored: [],
        consumed: [
          {
            key: 'league-request:probe:198.18.0.7',
            rule: leagueRequestProbeRule,
          },
        ],
      },
    });
  }

  {
    const { route, stored, consumed } = routeWith({ released: false });
    const response = await route.POST(post(body));
    assert({
      given: 'the release closed',
      should: 'answer not found before limiting or storing anything',
      actual: { status: response.status, stored, consumed },
      expected: { status: 404, stored: [], consumed: [] },
    });
  }

  {
    const { route, stored } = routeWith({
      consume: async (key) => ({
        allowed: !key.startsWith('league-request:client:'),
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
        allowed: key !== 'league-request:everyone',
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
      new Request(`${origin}/api/league-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify(body),
      }),
    );
    assert({
      given: 'a request the ingress stamped no client for',
      should: 'share one bucket rather than go unlimited',
      actual: consumed.map(({ key }) => key).slice(0, 2),
      expected: [
        'league-request:probe:unresolved',
        'league-request:client:unresolved:3600',
      ],
    });
  }

  {
    const { route, stored } = routeWith({});
    const answers = await Promise.all([
      route.POST(post({ ...body, extra: 'field' })),
      route.POST(post({ ...body, schools: 'lots' })),
      route.POST(post(body, { origin: 'https://elsewhere.example' })),
    ]);
    assert({
      given:
        'an unknown field, a value outside the vocabulary, and another origin',
      should: 'refuse each and store nothing',
      actual: {
        statuses: answers.map((answer) => answer.status),
        stored,
      },
      expected: { statuses: [400, 400, 403], stored: [] },
    });
  }
});

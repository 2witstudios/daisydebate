import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { memoryAdapter } from '@better-auth/memory-adapter';
import { fixedClock, sequentialId, systemClock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import { CLIENT_IP_HEADER } from './client-ip';
import { createAuthServer, type AuthEmailMessage } from './server';

setupRitewayBun();

const env = {
  BETTER_AUTH_SECRET:
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  PUBLIC_APP_URL: 'http://localhost:3000',
  RESEND_API_KEY: 're_test_000000000000000000000000',
  AUTH_EMAIL_FROM: 'Daisy <no-reply@daisy.example.com>',
};
const silentLogger: Logger = { log: () => {}, child: () => silentLogger };

type Consumed = { key: string; rule: { windowSeconds: number; max: number } };
const create = (
  options: {
    suppressed?: boolean;
    limiter?: (consumed: Consumed[]) => (
      key: string,
      rule: Consumed['rule'],
    ) => Promise<{
      allowed: boolean;
      retryAfterSeconds: number;
    }>;
  } = {},
) => {
  const db = {
    user: [],
    session: [],
    account: [],
    verification: [] as Array<Record<string, unknown>>,
    passkey: [],
  };
  const consumed: Consumed[] = [];
  const sent: AuthEmailMessage[] = [];
  const recorded: Array<{ providerMessageId: string; recipientHash: string }> =
    [];
  const server = createAuthServer({
    env,
    database: memoryAdapter(db),
    emailSender: {
      send: async (message) => {
        sent.push(message);
        return { providerMessageId: `msg_${sent.length}` };
      },
    },
    limiter: {
      consume: options.limiter
        ? options.limiter(consumed)
        : async (key, rule) => {
            consumed.push({ key, rule });
            return { allowed: true, retryAfterSeconds: 0 };
          },
    },
    ledger: {
      isSuppressed: async () => options.suppressed ?? false,
      record: async (input) => {
        recorded.push(input);
      },
    },
    logger: silentLogger,
    clock: fixedClock('2026-09-20T00:00:00.000Z'),
    ids: sequentialId('auth'),
  });
  return { server, db, consumed, sent, recorded };
};
const magicLinkRequest = (
  headers: Record<string, string> = {},
  email = 'player@daisy.example.com',
) =>
  new Request('http://localhost:3000/api/auth/sign-in/magic-link', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      ...headers,
    },
    body: JSON.stringify({ email }),
  });

describe('AUTH-3.1 composed Better Auth options', () => {
  test('sessions, cookie cache, rate limiting and passwords are configured as specified', () => {
    const { options } = create().server.instance;
    assert({
      given: 'the composed auth instance',
      should:
        'enable Redis-backed limiting, seven-day sessions, no cookie cache and no passwords',
      actual: {
        rate: {
          enabled: options.rateLimit?.enabled,
          window: options.rateLimit?.window,
          max: options.rateLimit?.max,
          custom: typeof options.rateLimit?.customStorage?.consume,
        },
        session: options.session,
        password: options.emailAndPassword?.enabled,
        ipHeaders: options.advanced?.ipAddress?.ipAddressHeaders,
        plugins: (options.plugins ?? []).map((plugin) => plugin.id).sort(),
      },
      expected: {
        rate: { enabled: true, window: 60, max: 100, custom: 'function' },
        session: {
          expiresIn: 604800,
          updateAge: 86400,
          freshAge: 3600,
          cookieCache: { enabled: false },
        },
        password: false,
        ipHeaders: [CLIENT_IP_HEADER],
        plugins: ['magic-link', 'passkey'],
      },
    });
  });
});

describe('AUTH-3.3 magic-link issuance', () => {
  test('stores only a hash of the token and emails an /auth/confirm link that expires in five minutes', async () => {
    const { server, db, sent, recorded } = create();
    const response = await server.instance.handler(magicLinkRequest());
    const token = new URL(sent[0]?.text.match(/https?:\/\/\S+/)?.[0] ?? '')
      .searchParams;
    const record = db.verification[0] as {
      identifier: string;
      expiresAt: Date;
    };
    // Better Auth stamps expiry from its own (ambient) clock.
    const ttlSeconds =
      (record.expiresAt.getTime() - Date.parse(systemClock.now())) / 1000;
    assert({
      given: 'a magic-link request',
      should:
        'persist a hashed identifier, send the confirm link once and record the provider receipt',
      actual: {
        status: response.status,
        stored: record.identifier !== token.get('token'),
        storedHasNoToken: JSON.stringify(db.verification).includes(
          token.get('token') ?? 'missing',
        ),
        window: ttlSeconds > 240 && ttlSeconds <= 300,
        sent: sent.length,
        confirm: sent[0]?.text.includes('http://localhost:3000/auth/confirm?'),
        receipt: recorded.map(({ providerMessageId }) => providerMessageId),
        hashedRecipient: /^[0-9a-f]{64}$/.test(
          recorded[0]?.recipientHash ?? '',
        ),
        htmlHasNoExternalAssets: !/(src|href)="https?:\/\/(?!localhost)/.test(
          sent[0]?.html ?? '',
        ),
      },
      expected: {
        status: 200,
        stored: true,
        storedHasNoToken: false,
        window: true,
        sent: 1,
        confirm: true,
        receipt: ['msg_1'],
        hashedRecipient: true,
        htmlHasNoExternalAssets: true,
      },
    });
  });

  test('a suppressed recipient gets safe guidance and no mail or token', async () => {
    const { server, db, sent } = create({ suppressed: true });
    const response = await server.instance.handler(magicLinkRequest());
    const body = (await response.json()) as { code?: string; message?: string };
    assert({
      given: 'an address with a prior hard bounce',
      should:
        'refuse with 422 guidance, sending nothing and persisting no token',
      actual: {
        status: response.status,
        code: body.code,
        guidance: /passkey/i.test(body.message ?? ''),
        sent: sent.length,
        tokens: db.verification.length,
      },
      expected: {
        status: 422,
        code: 'EMAIL_UNDELIVERABLE',
        guidance: true,
        sent: 0,
        tokens: 0,
      },
    });
  });
});

describe('AUTH-3.4 limiter wiring', () => {
  test('per-recipient and per-client counters use one consume each with hashed-safe inputs', async () => {
    const { server, consumed } = create();
    await server.instance.handler(magicLinkRequest());
    assert({
      given: 'one magic-link request',
      should:
        'consume the client path key (3/60) and the recipient key (3/60) exactly once each',
      actual: consumed.map(({ key, rule }) => ({
        kind: key.startsWith('magic-link-recipient|') ? 'recipient' : 'client',
        rule,
        leaksAddress: key.includes('player@'),
      })),
      expected: [
        {
          kind: 'client',
          rule: { windowSeconds: 60, max: 3 },
          leaksAddress: false,
        },
        {
          kind: 'recipient',
          rule: { windowSeconds: 60, max: 3 },
          leaksAddress: false,
        },
      ],
    });
  });

  test('only the ingress-stamped identity selects the client bucket; forwarding headers are ignored', async () => {
    const { server, consumed } = create();
    await server.instance.handler(
      magicLinkRequest({
        'x-forwarded-for': '203.0.113.99',
        'x-real-ip': '203.0.113.98',
        [CLIENT_IP_HEADER]: '198.51.100.7',
      }),
    );
    await server.instance.handler(
      magicLinkRequest({ 'x-forwarded-for': '203.0.113.99' }),
    );
    const clientKeys = consumed
      .map(({ key }) => key)
      .filter((key) => !key.startsWith('magic-link-recipient|'));
    assert({
      given: 'requests with and without the ingress identity, both forging XFF',
      should:
        'key the first by the stamped identity and never by the forged headers',
      actual: {
        stamped: clientKeys[0],
        forgedLeaks: clientKeys.some((key) => key.includes('203.0.113')),
      },
      expected: {
        stamped: '198.51.100.7|/sign-in/magic-link',
        forgedLeaks: false,
      },
    });
  });

  test('a denied consume answers 429 with retry information and sends nothing', async () => {
    const { server, sent } = create({
      limiter: () => async () => ({ allowed: false, retryAfterSeconds: 37 }),
    });
    const response = await server.instance.handler(magicLinkRequest());
    assert({
      given: 'a limiter that denies with 37 seconds remaining',
      should: 'return 429 with the retry seconds and deliver nothing',
      actual: {
        status: response.status,
        retry: response.headers.get('x-retry-after'),
        sent: sent.length,
      },
      expected: { status: 429, retry: '37', sent: 0 },
    });
  });

  test('a recipient-counter denial answers 429 with Retry-After', async () => {
    const { server, sent } = create({
      limiter: () => async (key) =>
        key.startsWith('magic-link-recipient|')
          ? { allowed: false, retryAfterSeconds: 12 }
          : { allowed: true, retryAfterSeconds: 0 },
    });
    const response = await server.instance.handler(magicLinkRequest());
    assert({
      given: 'the recipient counter exhausted',
      should: 'return 429 with Retry-After and deliver nothing',
      actual: [
        response.status,
        response.headers.get('retry-after'),
        sent.length,
      ],
      expected: [429, '12', 0],
    });
  });

  test('a limiter failure rejects the request instead of allowing it', async () => {
    const { server, sent } = create({
      limiter: () => async () => {
        throw new Error('redis down');
      },
    });
    let rejected = false;
    try {
      await server.instance.handler(magicLinkRequest());
    } catch {
      rejected = true;
    }
    assert({
      given: 'a limiter that throws (Redis outage)',
      should:
        'reject (mapped to 503 by the route boundary) and deliver nothing',
      actual: { rejected, sent: sent.length },
      expected: { rejected: true, sent: 0 },
    });
  });
});

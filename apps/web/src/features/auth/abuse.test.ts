import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { systemClock } from '@daisy/clock';
import { CLIENT_IP_HEADER } from './client-ip';
import { emailedLinkIdentifier } from './emailed-link-token';
import { create, magicLinkRequest, tokenIn } from './abuse.test-support';

setupRitewayBun();

describe('AUTH-3.1 composed Better Auth options', () => {
  test('sessions, cookie cache, rate limiting and passwords are configured as specified', () => {
    const { options } = create().server.instance;
    assert({
      given: 'the composed auth instance',
      should:
        'replace the built-in limiter with the injected gate, seven-day sessions, no cookie cache and no passwords',
      actual: {
        rate: options.rateLimit,
        session: options.session,
        password: options.emailAndPassword?.enabled,
        ipHeaders: options.advanced?.ipAddress?.ipAddressHeaders,
        plugins: (options.plugins ?? []).map((plugin) => plugin.id).sort(),
        lastPlugin: options.plugins?.at(-1)?.id,
        listSessionsDisabled: options.disabledPaths?.includes('/list-sessions'),
      },
      expected: {
        rate: { enabled: false },
        session: {
          expiresIn: 604800,
          updateAge: 86400,
          freshAge: 3600,
          cookieCache: { enabled: false },
        },
        password: false,
        ipHeaders: [CLIENT_IP_HEADER],
        plugins: [
          'daisy-browser-session-shape',
          'daisy-email-change',
          'daisy-fresh-session-gate',
          'daisy-magic-link-gate',
          'daisy-passkey-device-hint',
          'daisy-passkey-notifications',
          'daisy-revoke-others-on-email-change',
          'daisy-revoke-sessions',
          'daisy-session-revoked-outbox',
          'magic-link',
          'passkey',
        ],
        // Last, so every other after hook sees the full result first.
        lastPlugin: 'daisy-browser-session-shape',
        listSessionsDisabled: true,
      },
    });
  });
});

describe('AUTH-3.3 magic-link issuance', () => {
  test('stores only the SHA3-256 digest of a 256-bit token, expiring in five minutes (ISSUE-2)', async () => {
    const { server, db, sent } = create();
    const response = await server.instance.handler(magicLinkRequest());
    const token = tokenIn(sent[0]);
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
        'persist the sign-in purpose and SHA3-256 digest of an opaque 256-bit token, expiring within five minutes',
      actual: {
        status: response.status,
        opaque256: /^[A-Za-z0-9_-]{43}$/.test(token),
        identifier: record.identifier,
        tokenAbsent: JSON.stringify(db.verification).includes(token),
        fiveMinutes: ttlSeconds > 240 && ttlSeconds <= 300,
      },
      expected: {
        status: 200,
        opaque256: true,
        identifier: emailedLinkIdentifier('sign-in', token),
        tokenAbsent: false,
        fiveMinutes: true,
      },
    });
  });

  test('emails one /auth/confirm link without external assets and records only the provider receipt', async () => {
    const { server, sent, recorded } = create();
    await server.instance.handler(magicLinkRequest());
    assert({
      given: 'a magic-link request',
      should:
        'send the confirm link once and record the receipt with a hashed recipient',
      actual: {
        sent: sent.length,
        confirm: sent[0]?.text.includes('http://localhost:3000/auth/confirm?'),
        receipt: recorded.map(({ providerMessageId }) => providerMessageId),
        hashedRecipient: /^[0-9a-f]{64}$/.test(
          recorded[0]?.recipientHash ?? '',
        ),
        noExternalAssets: !/(src|href)="https?:\/\/(?!localhost)/.test(
          sent[0]?.html ?? '',
        ),
      },
      expected: {
        sent: 1,
        confirm: true,
        receipt: ['msg_1'],
        hashedRecipient: true,
        noExternalAssets: true,
      },
    });
  });

  test('a ledger outage fails closed with a retryable 503 and sends nothing', async () => {
    const { server, sent, db } = create({ ledgerFailure: true });
    const response = await server.instance.handler(magicLinkRequest());
    const body = (await response.json()) as { code?: string };
    assert({
      given: 'the suppression lookup failing',
      should:
        'answer 503 AUTH_TEMPORARILY_UNAVAILABLE with Retry-After, no mail, no token',
      actual: {
        status: response.status,
        code: body.code,
        retryAfter: response.headers.get('retry-after'),
        sent: sent.length,
        tokens: db.verification.length,
      },
      expected: {
        status: 503,
        code: 'AUTH_TEMPORARILY_UNAVAILABLE',
        retryAfter: '5',
        sent: 0,
        tokens: 0,
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

describe('auth mail receipt recording', () => {
  test('receipt failure after provider acceptance', async () => {
    const { server, logs, sent } = create({ recordFailure: true });
    const response = await server.instance.handler(magicLinkRequest());
    const token = tokenIn(sent[0]);
    const serialized = JSON.stringify(logs);
    assert({
      given: 'the provider accepted a message but recording its receipt fails',
      should:
        'report success and log a receipt_failed event whose only addition is the provider message id',
      actual: {
        status: response.status,
        events: logs.map((entry) => entry[0]),
        receiptFields: logs[0]?.[1],
        tokenSent: token !== '',
        leaks: ['player@daisy', token, 'record down'].some((s) =>
          serialized.includes(s),
        ),
      },
      expected: {
        status: 200,
        tokenSent: true,
        events: ['auth.mail.receipt_failed', 'auth.mail.sent'],
        receiptFields: {
          operation: 'auth.mail.send',
          errorCode: 'INFRASTRUCTURE',
          providerMessageId: 'msg_1',
        },
        leaks: false,
      },
    });
  });
});

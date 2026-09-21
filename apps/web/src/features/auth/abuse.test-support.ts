import { memoryAdapter } from '@better-auth/memory-adapter';
import { fixedClock, sequentialId } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import { CLIENT_IP_HEADER } from './client-ip';
import { createAuthServer, type AuthEmailMessage } from './server';

const env = {
  BETTER_AUTH_SECRET:
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  PUBLIC_APP_URL: 'http://localhost:3000',
  RESEND_API_KEY: 're_test_000000000000000000000000',
  AUTH_EMAIL_FROM: 'Daisy <no-reply@daisy.example.com>',
};
const silentLogger: Logger = { log: () => {}, child: () => silentLogger };

export type Consumed = {
  key: string;
  rule: { windowSeconds: number; max: number };
};
export const create = (
  options: {
    suppressed?: boolean;
    ledgerFailure?: boolean;
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
  const lookups = { count: 0 };
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
      isSuppressed: async () => {
        lookups.count += 1;
        if (options.ledgerFailure) throw new Error('ledger down');
        return options.suppressed ?? false;
      },
      record: async (input) => {
        recorded.push(input);
      },
    },
    clientIp: { trustedHeaders: [CLIENT_IP_HEADER] },
    logger: silentLogger,
    clock: fixedClock('2026-09-20T00:00:00.000Z'),
    ids: sequentialId('auth'),
  });
  return { server, db, consumed, sent, recorded, lookups };
};
export const tokenIn = (message: AuthEmailMessage | undefined) =>
  new URL(
    message?.text.match(/https?:\/\/\S+/)?.[0] ?? 'http://x.invalid',
  ).searchParams.get('token') ?? '';
export const magicLinkRequest = (
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

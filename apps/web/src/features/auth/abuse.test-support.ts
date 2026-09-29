import { memoryAdapter } from '@better-auth/memory-adapter';
import type { Logger } from '@daisy/logger';
import { composeAuthServer, memoryTables } from './auth-server.test-support';
import type { AuthEmailMessage } from './server';

export type Consumed = {
  key: string;
  rule: { windowSeconds: number; max: number };
};
export const create = (
  options: {
    suppressed?: boolean;
    ledgerFailure?: boolean;
    recordFailure?: boolean;
    /** The mail transport rejects every send (a provider outage). */
    sendFailure?: boolean;
    limiter?: (consumed: Consumed[]) => (
      key: string,
      rule: Consumed['rule'],
    ) => Promise<{
      allowed: boolean;
      retryAfterSeconds: number;
    }>;
  } = {},
) => {
  const db = memoryTables();
  const consumed: Consumed[] = [];
  const lookups = { count: 0 };
  const sent: AuthEmailMessage[] = [];
  const logs: unknown[][] = [];
  const logger: Logger = {
    log: (...entry) => void logs.push(entry),
    child: () => logger,
  };
  const recorded: Array<{ providerMessageId: string; recipientHash: string }> =
    [];
  const server = composeAuthServer({
    database: memoryAdapter(db),
    emailSender: {
      send: async (message) => {
        if (options.sendFailure) throw new Error('transport down');
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
        if (options.recordFailure) throw new Error('record down');
        recorded.push(input);
      },
    },
    logger,
  });
  return { server, db, consumed, sent, recorded, lookups, logs };
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

/** An account holding the address `magicLinkRequest` asks for. */
export const existingAccount = {
  id: 'user-1',
  email: 'player@daisy.example.com',
  emailVerified: true,
  name: '',
  createdAt: new Date('2026-09-20T00:00:00.000Z'),
  updatedAt: new Date('2026-09-20T00:00:00.000Z'),
};

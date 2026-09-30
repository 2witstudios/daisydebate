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
    /** The mail transport answers nothing until `release()` is called. */
    heldTransport?: boolean;
    /** How long each send takes on the injected clock (default 0). */
    providerRoundTripMs?: number;
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
  /** Every seam call in order: each limiter key, suppression, send, record. */
  const trace: string[] = [];
  let release = () => {};
  const held = options.heldTransport
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : undefined;
  let reached = () => {};
  /** Resolves when the transport is first asked to send. */
  const transportReached = new Promise<void>((resolve) => {
    reached = resolve;
  });
  // One injected clock: a send advances it by the provider's round trip,
  // and a paced wait is traced (`wait:<ms>`) and advances it by its length.
  let now = 0;
  const pacing = {
    elapsedMs: () => now,
    delay: async (ms: number) => {
      trace.push(`wait:${ms}`);
      now += ms;
    },
    pick: () => 0,
  };
  const limit = options.limiter
    ? options.limiter(consumed)
    : async (key: string, rule: Consumed['rule']) => {
        consumed.push({ key, rule });
        return { allowed: true, retryAfterSeconds: 0 };
      };
  const server = composeAuthServer({
    database: memoryAdapter(db),
    pacing,
    emailSender: {
      send: async (message) => {
        trace.push('send');
        reached();
        await held;
        now += options.providerRoundTripMs ?? 0;
        if (options.sendFailure) throw new Error('transport down');
        sent.push(message);
        return { providerMessageId: `msg_${sent.length}` };
      },
    },
    limiter: {
      consume: (key, rule) => {
        trace.push(key);
        return limit(key, rule);
      },
    },
    ledger: {
      isSuppressed: async () => {
        trace.push('suppression');
        lookups.count += 1;
        if (options.ledgerFailure) throw new Error('ledger down');
        return options.suppressed ?? false;
      },
      record: async (input) => {
        trace.push('record');
        if (options.recordFailure) throw new Error('record down');
        recorded.push(input);
      },
    },
    logger,
  });
  return {
    server,
    db,
    consumed,
    sent,
    recorded,
    lookups,
    logs,
    trace,
    transportReached,
    release: () => release(),
  };
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

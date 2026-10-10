import type { OutboxPosition, OutboxRow } from '@daisy/db';
import type { RealtimeApp } from './app';
import { noopLogger } from './outbox-drain.test-support';

/**
 * A minimal `RealtimeApp` stand-in: only the fields `serveRealtime` and
 * `createRealtimeServer` actually read. Cast at the boundary, the same
 * pattern `server.test.ts`'s `fakeServer` uses for a Bun `Server`.
 */
export function fakeApp(overrides: {
  readonly listenOutbox: () => Promise<{ unlisten: () => Promise<void> }>;
  readonly readOutboxHighWaterMark: () => Promise<OutboxPosition>;
  readonly listenRealtimeHints?: RealtimeApp['database']['listenRealtimeHints'];
  readonly NODE_ENV?: string;
  readonly runtimeRoleProblems?: () => Promise<readonly string[]>;
}): RealtimeApp {
  return {
    config: { NODE_ENV: overrides.NODE_ENV ?? 'test' },
    isDraining: () => false,
    logger: noopLogger,
    database: {
      runtimeRoleProblems: overrides.runtimeRoleProblems ?? (async () => []),
      health: async () => true,
      checkListen: async () => true,
      listenOutbox: overrides.listenOutbox,
      listenRealtimeHints:
        overrides.listenRealtimeHints ??
        (async () => ({ unlisten: async () => {} })),
      readOutboxHighWaterMark: overrides.readOutboxHighWaterMark,
      drainOutbox: async (): Promise<readonly OutboxRow[]> => [],
    },
    redis: { health: async () => true },
  } as unknown as RealtimeApp;
}

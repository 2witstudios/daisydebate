import { messagingMemberReading } from '@daisy/auth/group-policy';
import type { Waits } from '@daisy/clock';
import type { RealtimeApp } from './app';
import type { serveRealtime } from './serve';

/**
 * The production composition `start.ts` serves: everything the process edge
 * passes to `serveRealtime`, as a pure function so tests drive the exact
 * same value. The reading policy is DEC-251's member reading, the one web's
 * messaging commands evaluate; channel authorization requires it.
 */
export function productionServeOptions({
  resources,
  port,
  hostname,
  trustedProxies,
  instanceId,
  nextId,
  waits,
}: {
  readonly resources: RealtimeApp;
  readonly port: number;
  readonly hostname: string;
  readonly trustedProxies: readonly string[];
  readonly instanceId: string;
  readonly nextId: () => string;
  /** The process's time: `hostWaits` from the entry. */
  readonly waits: Waits;
}) {
  return {
    resources,
    port,
    hostname,
    trustedProxies,
    waits,
    presence: { instanceId, nextId },
    readingPolicy: messagingMemberReading(
      resources.config.MESSAGING_PRIVATE_GROUPS === 'staging',
    ),
    // Conversations observe channel messages (ADR 0089).
    observation: { nextId },
  } satisfies Parameters<typeof serveRealtime>[0];
}

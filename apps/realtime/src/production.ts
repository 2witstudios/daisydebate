import { socialMemberReading } from '@daisy/auth/social-reading';
import { betaDmPolicy } from '@daisy/auth/social-policy';
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
}: {
  readonly resources: RealtimeApp;
  readonly port: number;
  readonly hostname: string;
  readonly trustedProxies: readonly string[];
  readonly instanceId: string;
  readonly nextId: () => string;
}) {
  return {
    resources,
    port,
    hostname,
    trustedProxies,
    presence: { instanceId, nextId },
    readingPolicy: socialMemberReading(betaDmPolicy),
  } satisfies Parameters<typeof serveRealtime>[0];
}

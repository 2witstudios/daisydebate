import { AsyncLocalStorage } from 'node:async_hooks';
import { fairnessNetwork } from '@daisy/ingress/client-networks';

/**
 * The client network each request's database work queues under (ADR 0088):
 * the ingress runs a request inside its resolved client's network, and the
 * database lanes read it as their fairness key, so one network's flood waits
 * its turn behind every other network instead of ahead of them. One per app
 * instance; work outside a request (timers, workers) has no network.
 */
export function createRequestNetwork() {
  const store = new AsyncLocalStorage<string | undefined>();
  return {
    within: <T>(client: string | null, work: () => T): T =>
      store.run(fairnessNetwork(client), work),
    current: (): string | undefined => store.getStore(),
  };
}

export type RequestNetwork = ReturnType<typeof createRequestNetwork>;

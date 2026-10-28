'use client';

import { systemId } from '@daisy/clock';
import { systemScheduler, tabConnection } from './browser-adapters';
import {
  createObservationProvider,
  type ObservationProvider,
} from './observation-provider';

const providers = new Map<string, ObservationProvider>();
/**
 * This tab's one observation provider per realtime URL, on the tab's shared
 * socket. It lives as long as the document: the provider and its interests
 * are released by their references, the socket by its holders.
 */
export function tabObservations(socketUrl: string): ObservationProvider {
  let provider = providers.get(socketUrl);
  if (!provider) {
    const connection = tabConnection(socketUrl);
    provider = createObservationProvider({
      connection,
      scheduler: systemScheduler,
      nextId: () => systemId.next(),
    });
    providers.set(socketUrl, provider);
    connection.connect();
  }
  return provider;
}

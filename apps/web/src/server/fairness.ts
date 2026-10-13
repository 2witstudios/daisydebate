import { AsyncLocalStorage } from 'node:async_hooks';
import { CLIENT_IP_HEADER } from '@daisy/ingress/client-ip';
import { clientNetworks } from '@daisy/ingress/client-networks';

const current = new AsyncLocalStorage<string>();

/**
 * The client's widest network (an IPv6 /48 or IPv4 /24), so one flooding
 * network takes turns with every other caller for queued database work.
 */
export function fairnessKeyOf(request: Request): string {
  const networks = clientNetworks(request.headers.get(CLIENT_IP_HEADER));
  return networks.at(-1)?.network ?? '';
}
/** Run request work, and everything it hands off, under its client's fairness key. */
export const withFairnessKey = <T>(request: Request, work: () => Promise<T>) =>
  current.run(fairnessKeyOf(request), work);
/** The fairness key of the request whose work is executing, if any. */
export const currentFairnessKey = (): string | undefined => current.getStore();

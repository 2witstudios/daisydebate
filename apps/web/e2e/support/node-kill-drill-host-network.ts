import { readdir, readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import {
  changesIn,
  heldStillMs,
  hostNetworkShape,
  type HostNetworkRead,
} from '../../scripts/node-kill-drill/host-network';
import { nowMs } from './node-kill-drill-nodes';

const READ_EVERY_MS = 250;
/** Beyond IPv6 duplicate address detection on a new link (about 1 s, plus up to 1 s of delay). */
const STILL_MS = 5000;
const SETTLE_LIMIT_MS = 60_000;

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Each link's operational state on Linux; elsewhere the browser is not on the host network. */
const readLinks = async () => {
  const names = await readdir('/sys/class/net').catch(() => []);
  const states = await Promise.all(
    names.map(async (name) => [
      name,
      (
        await readFile(`/sys/class/net/${name}/operstate`, 'utf8').catch(
          () => 'gone',
        )
      ).trim(),
    ]),
  );
  return Object.fromEntries(states) as Record<string, string>;
};

const readShape = async () => {
  const addresses = Object.fromEntries(
    Object.entries(networkInterfaces()).map(([name, list]) => [
      name,
      (list ?? []).map(({ family, address }) => ({ family, address })),
    ]),
  );
  return hostNetworkShape({ links: await readLinks(), addresses });
};

/**
 * Waits until the host's links and addresses have held still for 5 s: the
 * node the last kill restarted is still adding its interface, and a page
 * opened meanwhile fails with ERR_NETWORK_CHANGED.
 */
export async function untilHostNetworkSettled() {
  const startMs = nowMs();
  const reads: HostNetworkRead[] = [];
  while (heldStillMs(reads) < STILL_MS) {
    if (nowMs() - startMs > SETTLE_LIMIT_MS)
      throw new Error(
        `the host network did not hold still for 5 s within 60 s (${changesIn(reads)} changes)`,
      );
    reads.push({ atMs: nowMs(), shape: await readShape() });
    await pause(READ_EVERY_MS);
  }
  return { waitedMs: nowMs() - startMs, changes: changesIn(reads) };
}

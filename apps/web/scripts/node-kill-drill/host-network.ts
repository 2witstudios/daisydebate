/**
 * The host's network as a browser on the host network sees it. Restarting a
 * Docker node adds a host interface, and its addresses arrive over the next
 * seconds; Chromium fails a request in flight at such a change with
 * ERR_NETWORK_CHANGED. A kill's setup starts only once the host has held still.
 */
export type HostNetworkRead = { readonly atMs: number; readonly shape: string };

/** One comparable string: each link's state and each interface's addresses. */
export function hostNetworkShape(input: {
  readonly links: Readonly<Record<string, string>>;
  readonly addresses: Readonly<
    Record<
      string,
      readonly { readonly family: string; readonly address: string }[]
    >
  >;
}) {
  const links = Object.entries(input.links).map(
    ([name, state]) => `link ${name} ${state}`,
  );
  const addresses = Object.entries(input.addresses).flatMap(([name, list]) =>
    list.map((entry) => `addr ${name} ${entry.family} ${entry.address}`),
  );
  return [...links, ...addresses].sort().join('\n');
}

/** How long the latest shape has held, from its first read to the last read; 0 with no reads. */
export function heldStillMs(reads: readonly HostNetworkRead[]) {
  const last = reads.at(-1);
  if (!last) return 0;
  let since = last.atMs;
  for (let index = reads.length - 1; index >= 0; index--) {
    if (reads[index]!.shape !== last.shape) break;
    since = reads[index]!.atMs;
  }
  return last.atMs - since;
}

/** Each time the shape changed between reads. */
export const changesIn = (reads: readonly HostNetworkRead[]) =>
  reads.filter(
    (read, index) => index > 0 && read.shape !== reads[index - 1]!.shape,
  ).length;

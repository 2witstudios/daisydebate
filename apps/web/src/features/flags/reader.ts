import type { FlagSnapshot } from '@daisy/protocol/flags';
import { flagCatalogue, type ReleaseFlagReader } from './catalogue';
import { resolveFlag } from './resolver';

/** Construct once per display request; never retain across requests or use for admission. */
export function createRequestFlagReader(deps: {
  readonly read: (
    accountId: string | null,
    keys: readonly string[],
  ) => Promise<{ readonly snapshot: FlagSnapshot; readonly now: number }>;
  readonly now: () => number;
  readonly diagnostic: () => void;
}): ReleaseFlagReader {
  const snapshots = new Map<
    string | null,
    Promise<{ readonly snapshot: FlagSnapshot; readonly now: number }>
  >();
  let reported = false;
  const read = async (accountId: string | null) => {
    try {
      return await deps.read(
        accountId,
        flagCatalogue.map((entry) => entry.key),
      );
    } catch {
      if (!reported) {
        reported = true;
        deps.diagnostic();
      }
      return { snapshot: { kind: 'unavailable' } as const, now: deps.now() };
    }
  };
  return async (key, accountId) => {
    let pending = snapshots.get(accountId);
    if (!pending) {
      pending = read(accountId);
      snapshots.set(accountId, pending);
    }
    const { snapshot, now } = await pending;
    return resolveFlag({ catalogue: flagCatalogue, snapshot, key, now })
      .enabled;
  };
}

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
  /** The deployment's release default: `releaseFlagDefault(app.config)`. */
  readonly releaseDefault: boolean;
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
      const snapshot = { kind: 'unavailable' } as const;
      try {
        return { snapshot, now: deps.now() };
      } catch {
        return { snapshot, now: Number.NaN };
      }
    }
  };
  return async (key, accountId) => {
    let pending = snapshots.get(accountId);
    if (!pending) {
      pending = read(accountId);
      snapshots.set(accountId, pending);
    }
    const { snapshot, now } = await pending;
    return resolveFlag({
      catalogue: flagCatalogue,
      snapshot,
      key,
      now,
      releaseDefault: deps.releaseDefault,
    }).enabled;
  };
}

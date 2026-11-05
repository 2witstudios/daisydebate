import { requestReleaseEnabled } from '../../lib/request-session';
import type { ReleaseFlagKey, ReleaseFlagReader } from './catalogue';
export type { ReleaseFlagKey, ReleaseFlagReader } from './catalogue';

/** Next supplies its request-scoped reader; other server compositions inject theirs. */
export const isReleaseEnabled = (
  key: ReleaseFlagKey,
  accountId: string | null,
  read: ReleaseFlagReader = requestReleaseEnabled,
): Promise<boolean> => read(key, accountId);

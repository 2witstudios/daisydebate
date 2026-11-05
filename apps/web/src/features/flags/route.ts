import { notFound } from 'next/navigation';
import type { ReleaseFlagKey, ReleaseFlagReader } from './server';

/** NEW-feature route only; already admitted recovery has its own account-bound route. */
export async function requireReleaseRoute(
  read: ReleaseFlagReader,
  key: ReleaseFlagKey,
  accountId: string | null,
): Promise<void> {
  if (!(await read(key, accountId))) notFound();
}

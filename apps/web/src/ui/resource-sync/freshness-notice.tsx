import Link from 'next/link';
import type { Freshness } from '../../features/resource-sync/resource-sync';

/** Says when what is on screen may not be how the resource is now. */
export function FreshnessNotice({
  freshness,
  noun,
}: {
  readonly freshness: Freshness;
  /** What the page shows, as in "Reconnecting to the room". */
  readonly noun: 'room' | 'round';
}) {
  if (freshness === 'current') return null;
  return freshness === 'stale' ? (
    <p
      role="status"
      className="rounded-xl bg-surface-sunken p-4 text-sm text-ink-muted"
    >
      Reconnecting to the {noun}. What you see may be out of date.
    </p>
  ) : (
    <p role="alert" className="rounded-xl bg-surface-sunken p-4 text-sm">
      This {noun} is no longer available.{' '}
      <Link href="/lobby">Back to the lobby</Link>
    </p>
  );
}

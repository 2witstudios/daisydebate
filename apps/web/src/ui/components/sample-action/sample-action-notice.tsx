'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Icon } from '../icon/icon';
import { dismissedHref, sampleActionMessage } from './sample-action-href';

/**
 * The banner a sample action answers with. It reads `did` from the query, so
 * it needs no state and survives a reload, and it clears with its own link.
 */
export function SampleActionNotice() {
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const message = sampleActionMessage(params?.get('did') ?? null);
  if (message === null) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-lg bg-accent-soft px-4 py-3"
    >
      <Icon name="check" size={18} className="text-accent" />
      <p className="min-w-0 flex-1 text-base text-ink">{message}</p>
      <Link
        href={dismissedHref(pathname, params?.toString() ?? '')}
        className="text-sm font-strong text-ink"
        scroll={false}
      >
        Dismiss
      </Link>
    </div>
  );
}

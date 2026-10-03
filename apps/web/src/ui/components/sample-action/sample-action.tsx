'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '../../cn';
import { sampleActionHref } from './sample-action-href';

export type SampleActionProps = {
  /** What the control does, in the words on its face ("Save card"). */
  readonly label: string;
  readonly className?: string;
  /** The accessible name of an icon-only control. */
  readonly ariaLabel?: string;
  readonly children: ReactNode;
};

/**
 * A control with no backend behind it. It is a link back to the same page
 * with the label in the query, and the shell banner says it worked on sample
 * data. It saves nothing, and it is never a dead button.
 */
export function SampleAction({
  label,
  className,
  ariaLabel,
  children,
}: SampleActionProps) {
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  return (
    <Link
      href={sampleActionHref(pathname, search, label)}
      className={cn('no-underline hover:no-underline', className)}
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
      scroll={false}
    >
      {children}
    </Link>
  );
}

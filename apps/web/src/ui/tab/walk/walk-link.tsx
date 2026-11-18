'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentProps } from 'react';
import { walkHref } from '../../../features/tab/walk-href';
export function WalkLink({ href, ...props }: ComponentProps<typeof Link>) {
  const pathname = usePathname();
  return (
    <Link
      {...props}
      href={
        typeof href === 'string' && pathname?.startsWith('/tournaments/walk')
          ? walkHref(href)
          : href
      }
    />
  );
}

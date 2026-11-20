'use client';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { walkHref } from '../../../features/tab/walk-href';
import { useRoutedPathname } from '../../components/sample-action/router-location';
export function WalkLink({ href, ...props }: ComponentProps<typeof Link>) {
  const pathname = useRoutedPathname();
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

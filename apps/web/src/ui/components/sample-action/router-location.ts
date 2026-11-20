'use client';
import {
  usePathname,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from 'next/navigation';

/*
 * Next types these for the App Router alone, where they always answer. A
 * sample control also renders on its own, outside any router (as its tests
 * render it), and there both answer null: Next's own pages-router typing.
 */
/** The current pathname, or null outside an App Router. */
export const useRoutedPathname: () => string | null = usePathname;
/** The current query, or null outside an App Router. */
export const useRoutedSearchParams: () => ReadonlyURLSearchParams | null =
  useSearchParams;

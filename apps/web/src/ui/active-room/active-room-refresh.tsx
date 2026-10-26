'use client';

import { useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { activeRoomNavigation } from './refresh-navigation';

/** Layouts survive client navigation; membership must be read again after it. */
export function ActiveRoomRefresh() {
  const pathname = usePathname();
  const router = useRouter();
  const navigate = useMemo(
    () => activeRoomNavigation(router.refresh),
    [router],
  );
  useEffect(() => {
    navigate(pathname);
    return () => navigate(null);
  }, [navigate, pathname]);
  return null;
}

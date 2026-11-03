'use client';
import { useEffect } from 'react';

/**
 * Reloads once the wait ends, unless the member moved on first. A meta refresh
 * cannot do this on a page with shell links: leaving by client navigation does
 * not cancel it.
 */
export function ReloadAfter({ seconds }: { readonly seconds: number }) {
  useEffect(() => {
    const timer = window.setTimeout(
      () => window.location.reload(),
      seconds * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [seconds]);
  return null;
}

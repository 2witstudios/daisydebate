'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const REFRESH_EVERY_MS = 15_000;

/** Keeps a server-rendered Recording page moving while its video is prepared. */
export function RefreshWhilePreparing() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), REFRESH_EVERY_MS);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}

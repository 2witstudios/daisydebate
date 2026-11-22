'use client';
import { useTick } from '../../edge/use-tick';
import { useRouter } from 'next/navigation';

const REFRESH_EVERY_MS = 15_000;

/** Keeps a server-rendered Recording page moving while its video is prepared. */
export function RefreshWhilePreparing() {
  const router = useRouter();
  useTick(() => router.refresh(), REFRESH_EVERY_MS);
  return null;
}

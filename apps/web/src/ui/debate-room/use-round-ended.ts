'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { browserDocument } from '../round-media/browser-document';
import { replaceRoute } from '../round-media/replace-route';
import { roundEnded } from './round-ended';

/**
 * A watching view (judge or spectator) moves to the Round's result page once
 * the Round ends; true from then on, so the view can show the ended notice.
 */
export function useRoundEndedRoute(round: {
  readonly id: string;
  readonly status: string;
}): boolean {
  const router = useRouter();
  const ended = roundEnded(round.status);
  useEffect(() => {
    if (ended) replaceRoute(router, browserDocument(), `/rounds/${round.id}`);
  }, [ended, router, round.id]);
  return ended;
}

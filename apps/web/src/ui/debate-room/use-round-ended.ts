'use client';
import { useNavigation } from '../edge/use-navigation';
import { isRoundOver, type RoundStatus } from '@daisy/protocol/round';
import { useRouter } from 'next/navigation';

import { browserDocument } from '../round-media/browser-document';
import { replaceRoute } from '../round-media/replace-route';

/**
 * A watching view (judge or spectator) moves to the Round's result page once
 * the Round ends; true from then on, so the view can show the ended notice.
 */
export function useRoundEndedRoute(
  round: {
    readonly id: string;
    readonly status: RoundStatus;
  },
  /** The post-round call keeps this view in its room until it ends (ADR 0127). */
  onCall = false,
): boolean {
  const router = useRouter();
  const ended = isRoundOver(round.status) && !onCall;
  useNavigation(router, ended ? `/rounds/${round.id}` : undefined, (to, href) =>
    replaceRoute(to, browserDocument(), href),
  );
  return ended;
}

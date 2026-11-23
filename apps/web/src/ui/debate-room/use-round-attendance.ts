'use client';
import { useDeliver } from '../edge/use-answer';
import { openBrowserAttendance } from './browser-attendance';
import { browserTransport } from '../edge/browser-request';
import { browserScheduler } from '../edge/browser-time';
import { useResource } from '../edge/use-driver';
import { useMemo, useState } from 'react';
import { isDebatingSeat } from '@daisy/protocol/seats';
import { type RoundView } from '@daisy/protocol/round-view';

/**
 * HTTP receipt production is independent of realtime, visibility and
 * microphone permission. Returns whether check-in stopped because the
 * session is gone, so the Round can say sign in again.
 */
export function useRoundAttendance({
  view,
  actorId,
  reconnect: reconnectSource,
}: {
  readonly view: RoundView;
  readonly actorId: string;
  readonly reconnect?: {
    readonly subscribe: (listener: () => void) => () => void;
  };
}): { readonly signedOut: boolean } {
  const eligible = view.participants.some(
    (seat) =>
      'actorId' in seat &&
      seat.actorId === actorId &&
      seat.kind === 'human' &&
      isDebatingSeat(seat.seat),
  );
  // Keyed by the client that hit the 401 (its Round and eligibility): a new
  // client, such as the Room's next Round, shows no stale signed-out state.
  const clientKey = `${view.id}:${eligible}`;
  const [signedOutKey, setSignedOutKey] = useState<string | null>(null);
  const attending = useMemo(
    () =>
      eligible ? { roundId: view.id, key: clientKey, reconnectSource } : null,
    [eligible, view.id, clientKey, reconnectSource],
  );
  const client = useResource(attending, (asked) =>
    asked === null
      ? null
      : openBrowserAttendance({
          roundId: asked.roundId,
          signedOut: () => setSignedOutKey(asked.key),
          transport: browserTransport,
          every: browserScheduler.every,
          ...(asked.reconnectSource
            ? { reconnect: asked.reconnectSource }
            : {}),
        }),
  );
  // Every view, the first included, reaches the client checking in for it.
  const reported = useMemo(() => ({ client, view }), [client, view]);
  useDeliver(reported, ({ client: checkingIn, view: shown }) => {
    void checkingIn?.update(shown);
  });
  return { signedOut: signedOutKey === clientKey };
}

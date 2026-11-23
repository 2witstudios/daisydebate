'use client';
import {
  browserTransport,
  type BrowserTransport,
} from '../edge/browser-request';
import { useResource } from '../edge/use-driver';
import { useTick } from '../edge/use-tick';
import { createId } from '@paralleldrive/cuid2';
import { tabPulses, VIEWER_PULSE_MS } from '@daisy/protocol/audience-state';
import { usePublishedAudience } from '../spectating/published-state';

type Watching = {
  readonly roundId: string;
  readonly unlisted: boolean;
};

/** This tab's one watching identity: a random token and its kept draw. */
const openPulse = ({ roundId, unlisted }: Watching) => ({
  roundId,
  unlisted,
  token: createId(),
  draw: crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32,
  dispose: () => undefined,
});

const sendPulse = (
  fetch: BrowserTransport,
  { roundId, unlisted, token }: ReturnType<typeof openPulse>,
) =>
  void fetch(`/api/rounds/${encodeURIComponent(roundId)}/viewers`, {
    method: 'POST',
    credentials: unlisted ? 'same-origin' : 'omit',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, token }),
  }).catch(() => undefined);

/**
 * Says this tab is watching, so the count can gather. The published state says what
 * share of tabs should, and this tab draws once and keeps its draw, so a large
 * audience stays a small load on web and the count can be scaled back up (DEC-350).
 * The token is random and lives only as long as the mounted page: no account, nothing
 * stored, and no cookie except an unlisted Round's link, which names the Round and
 * no one.
 */
export function ViewerPulse({
  roundId,
  unlisted,
}: {
  readonly roundId: string;
  readonly unlisted: boolean;
}) {
  // Unknown until the state arrives, and a tab sends nothing until it knows.
  const rate = usePublishedAudience()?.pulseRate ?? null;
  const key = `${unlisted ? 'unlisted' : 'listed'} ${roundId}`;
  const pulse = useResource(key, () => openPulse({ roundId, unlisted }));
  useTick(
    () => {
      if (pulse === null || rate === null || !tabPulses(pulse.draw, rate))
        return;
      sendPulse(browserTransport, pulse);
    },
    VIEWER_PULSE_MS,
    key,
  );
  return null;
}

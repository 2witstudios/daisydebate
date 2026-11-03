'use client';
import '../../lib/zod-jitless';
import { audienceSnapshotSchema, type AudienceSnapshot } from '@daisy/protocol';
import { useEffect, useState } from 'react';

const POLL_MS = 2000;

/**
 * The released audience activity, refreshed from the same cached read everyone
 * gets. Off, it makes no request. Without script the server's render stands.
 */
export function useAudienceSnapshot(
  initial: AudienceSnapshot,
  polling: boolean,
) {
  const [snapshot, setSnapshot] = useState(initial);
  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/rounds/${encodeURIComponent(initial.roundId)}/audience`,
          { credentials: 'omit' },
        );
        const parsed = audienceSnapshotSchema.safeParse(
          response.ok ? await response.json() : null,
        );
        if (parsed.success && !stopped) setSnapshot(parsed.data);
      } catch {
        // The last released view stands until a read succeeds again.
      }
    };
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [initial.roundId, polling]);
  return snapshot;
}

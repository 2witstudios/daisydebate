'use client';

// First: protocol schemas built after this load without Zod's eval probe.
import '../../lib/zod-jitless';
import {
  browserTransport,
  type BrowserTransport,
} from '../edge/browser-request';
import {
  challengeListSchema,
  type ChallengeList,
} from '@daisy/protocol/challenges';
import { type RatingDivision } from '@daisy/protocol/ladder';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  createChallengeSyncDriver,
  seedChallengeSync,
} from '../../features/challenges/challenge-sync-driver';
import {
  challengeListOf,
  endedOffersOf,
  type EndedOffer,
} from '../../features/challenges/challenges-held';
import { browserSyncEdges } from '../resource-sync/browser';
import type { ResourceRead } from '../../features/resource-sync/driver';
import { useDriver } from '../edge/use-driver';

type ChallengeView = {
  readonly challenges: ChallengeList;
  /** Offers from this member that ended without the member ending them. */
  readonly endedOffers: readonly EndedOffer[];
  readonly dismissEnded: (id: string) => void;
  /** The member is withdrawing this offer, so its end needs no notice. */
  readonly noteCancelled: (id: string) => void;
  /** That withdrawal failed, so the offer's end needs a notice after all. */
  readonly forgetCancelled: (id: string) => void;
  /** Re-reads at once, after the member's own action. */
  readonly refresh: () => void;
  /**
   * The member's current division for rating display while the ledger still
   * uses divisions. Challenge eligibility comes from the lobby's age rule.
   */
  readonly memberDivision: RatingDivision | null;
};

const ChallengeContext = createContext<ChallengeView | null>(null);

export const useChallenges = (): ChallengeView => {
  const view = useContext(ChallengeContext);
  if (!view) throw new Error('useChallenges needs a ChallengeProvider');
  return view;
};

const challengeRead = challengeListSchema.loose();

const readList = async (
  transport: BrowserTransport = browserTransport,
): Promise<ResourceRead<ChallengeList>> => {
  const response = await transport('/api/challenges', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  // jitless: the strict CSP refuses Zod's eval-compiled parser.
  const parsed = challengeRead.safeParse(
    response.ok ? await response.json() : null,
    { jitless: true },
  );
  return parsed.success
    ? { kind: 'found', value: parsed.data }
    : { kind: 'unavailable' };
};

/**
 * The tab's one view of this member's challenges (ADR 0103), with its own
 * lifecycle: only the socket is shared with the people list. A ring on the
 * member's inbox asks for a fresh read, and a timer covers one that never comes.
 */
export function ChallengeProvider({
  initialChallenges,
  actorId,
  socketUrl,
  memberDivision,
  children,
}: {
  readonly initialChallenges: ChallengeList;
  readonly actorId: string | null;
  readonly socketUrl: string | null;
  readonly memberDivision: RatingDivision | null;
  readonly children: ReactNode;
}) {
  // The first render's list: a later render of the shell never restarts the sync.
  const [seed] = useState(initialChallenges);
  const start = useCallback(() => {
    const { connection, ...edges } = browserSyncEdges(
      actorId === null ? null : socketUrl,
    );
    return createChallengeSyncDriver({
      seed,
      read: () => readList(),
      inbox: connection && actorId !== null ? { actorId, connection } : null,
      ...edges,
    });
  }, [actorId, seed, socketUrl]);
  const [sync, driver] = useDriver(() => seedChallengeSync(seed, 0), start);
  const held = sync.value;
  const shown = useMemo(
    () => ({
      challenges: challengeListOf(held),
      endedOffers: endedOffersOf(held),
    }),
    [held],
  );
  // Held apart from what is shown: a card's effect that names one of these
  // must not run again on every read.
  const commands = useMemo(
    () => ({
      dismissEnded: (id: string) => driver?.dismiss(id),
      noteCancelled: (id: string) => driver?.cancelling(id),
      forgetCancelled: (id: string) => driver?.cancelRefused(id),
      refresh: () => driver?.refresh(),
    }),
    [driver],
  );
  const view = useMemo(
    () => ({ ...shown, ...commands, memberDivision }),
    [commands, shown, memberDivision],
  );
  return (
    <ChallengeContext.Provider value={view}>
      {children}
    </ChallengeContext.Provider>
  );
}

'use client';
import type { RoundBallotRead } from '@daisy/protocol';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  ballotDraftKey,
  clearBallotDraft,
  parseBallotDraft,
  storedBallotDraft,
  writeBallotDraft,
} from '../../../features/judge/ballot-draft';
import { formValues } from '../../../features/forms/form-state';
import type { BallotDisplay } from '../../../features/round-ballots/presentation';

const tabStorage = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

/**
 * The draft as this page first found it, read once per mount: later edits
 * write the storage but never replace the fields the judge is typing in.
 */
const firstRead = new Map<string, string | null>();
const noSubscription = () => () => {};
const draftAtMount = (key: string): string | null => {
  if (!firstRead.has(key)) {
    const storage = tabStorage();
    firstRead.set(key, storage ? storedBallotDraft(storage, key) : null);
  }
  return firstRead.get(key) ?? null;
};

/**
 * The open ballot's draft in this tab: restored once after the page
 * hydrates when no refused answer is shown, kept on every edit, and removed
 * once the ballot is recorded or no longer due. A refusal's posted values
 * always win.
 */
export function useBallotDraft(
  view: RoundBallotRead,
  display: BallotDisplay,
  posted: Readonly<Record<string, string>>,
): {
  readonly values: Readonly<Record<string, string>>;
  readonly restored: boolean;
  readonly save: (form: HTMLFormElement) => void;
} {
  const key = view.own
    ? ballotDraftKey(view.round.id, view.own.participantId)
    : null;
  const raw = useSyncExternalStore(
    noSubscription,
    () => (key && display === 'open' ? draftAtMount(key) : null),
    () => null,
  );
  const draft = useMemo(() => parseBallotDraft(raw), [raw]);
  useEffect(() => {
    const storage = tabStorage();
    if (!key) return;
    if (storage && (display === 'recorded' || display === 'decided'))
      clearBallotDraft(storage, key);
    return () => void firstRead.delete(key);
  }, [key, display]);
  const save = useCallback(
    (form: HTMLFormElement) => {
      const storage = tabStorage();
      if (key && storage)
        writeBallotDraft(storage, key, formValues(new FormData(form)));
    },
    [key],
  );
  const restored = Object.keys(posted).length === 0 && draft !== null;
  return { values: restored ? draft : posted, restored, save };
}

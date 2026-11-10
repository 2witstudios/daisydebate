'use client';
import type { RoundBallotRead } from '@daisy/protocol';
import { useCallback, useEffect, useState } from 'react';
import {
  ballotDraftKey,
  clearBallotDraft,
  readBallotDraft,
  writeBallotDraft,
  type BallotDraft,
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
 * The open ballot's draft in this tab: restored once after the page mounts
 * when no refused answer is shown, kept on every edit, and removed once the
 * ballot is recorded or no longer due. A refusal's posted values always win.
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
  const [draft, setDraft] = useState<BallotDraft | null>(null);
  const answered = Object.keys(posted).length > 0;
  useEffect(() => {
    const storage = tabStorage();
    if (!key || !storage) return;
    if (display === 'recorded' || display === 'decided') {
      clearBallotDraft(storage, key);
      return;
    }
    if (display !== 'open' || answered) return;
    const kept = readBallotDraft(storage, key);
    if (kept) setDraft(kept);
  }, [key, display, answered]);
  const save = useCallback(
    (form: HTMLFormElement) => {
      const storage = tabStorage();
      if (key && storage)
        writeBallotDraft(storage, key, formValues(new FormData(form)));
    },
    [key],
  );
  const restored = !answered && draft !== null;
  return { values: restored ? draft : posted, restored, save };
}

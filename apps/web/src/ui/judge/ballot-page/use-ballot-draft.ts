'use client';
import { useBrowserEffect } from '../../edge/browser-sync';
import { cancelWindowDelay, windowDelay } from '../../edge/browser-time';
import type { RoundBallotRead } from '@daisy/protocol/round-ballot-read';
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  ballotDraftKey,
  clearBallotDraft,
  parseBallotDraft,
  storedBallotDraft,
  writeBallotDraft,
} from '../../../features/judge/ballot-draft';
import { formValues } from '../../../features/forms/form-state';
import type { BallotDisplay } from '../../../features/round-ballots/presentation';
import type { BallotPlan } from '../../../features/judge/ballot-plan';

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
const saveIntervalMs = 400;
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
  plan: BallotPlan,
  view: RoundBallotRead,
  display: BallotDisplay,
  posted: Readonly<Record<string, string>>,
): {
  readonly values: Readonly<Record<string, string>>;
  readonly restored: boolean;
  readonly save: (form: HTMLFormElement) => void;
} {
  const key = view.own
    ? ballotDraftKey(plan, view.round.id, view.own.participantId)
    : null;
  const raw = useSyncExternalStore(
    noSubscription,
    () => (key && display === 'open' ? draftAtMount(key) : null),
    () => null,
  );
  const draft = useMemo(() => parseBallotDraft(plan, raw), [plan, raw]);
  // Edits are written at most once per interval, and at once when the page
  // hides or the ballot leaves, so typing never serializes on every key.
  const pending = useRef<HTMLFormElement | null>(null);
  const timer = useRef<number | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) cancelWindowDelay(timer.current);
    timer.current = null;
    pending.current = null;
  }, []);
  const flush = useCallback(() => {
    const form = pending.current;
    cancel();
    const storage = tabStorage();
    if (form && key && storage)
      writeBallotDraft(plan, storage, key, formValues(new FormData(form)));
  }, [plan, key, cancel]);
  const save = useCallback(
    (form: HTMLFormElement) => {
      pending.current = form;
      timer.current ??= windowDelay(flush, saveIntervalMs);
    },
    [flush],
  );
  useBrowserEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      flush();
    };
  }, [flush]);
  useBrowserEffect(() => {
    const storage = tabStorage();
    if (!key) return;
    if (storage && (display === 'recorded' || display === 'decided')) {
      cancel();
      clearBallotDraft(storage, key);
    }
    return () => void firstRead.delete(key);
  }, [key, display, cancel]);
  const restored = Object.keys(posted).length === 0 && draft !== null;
  return { values: restored ? draft : posted, restored, save };
}

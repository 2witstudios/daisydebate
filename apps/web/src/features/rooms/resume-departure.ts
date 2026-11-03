import { systemClock } from '@daisy/clock';
import { resumeAttemptPrefix } from './resume-attempt';
import { resumeHeirPrefix, resumeOwnershipPrefix } from './resume-ownership';

/**
 * Whether a member left this Round explicitly in this browser, so no tab's
 * auto-resume fights the departure (ISSUE-879, ISSUE-1033). Local UX only: the
 * server still decides who is seated.
 */
const departurePrefix = 'daisy:resume-left:';
const departureKey = (actorId: string, roundId: string) =>
  `${departurePrefix}${actorId}:${roundId}`;
const departureRetentionMs = 24 * 60 * 60 * 1000;

const sweepExpiredDepartures = (storage: Storage, nowMs: number) => {
  const expired: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(departurePrefix)) continue;
    const markedAtMs = Number(storage.getItem(key));
    if (!(nowMs - markedAtMs < departureRetentionMs)) expired.push(key);
  }
  for (const key of expired) storage.removeItem(key);
};

export function markDeparture(
  actorId: string | null,
  roundId: string,
  local?: Storage,
  nowMs: number = Date.parse(systemClock.now()),
): void {
  if (actorId === null) return;
  try {
    const storage = local ?? window.localStorage;
    sweepExpiredDepartures(storage, nowMs);
    storage.setItem(departureKey(actorId, roundId), String(nowMs));
  } catch {
    // Storage disabled: the departure holds only for this navigation.
  }
}

export function hasDeparted(
  actorId: string | null,
  roundId: string,
  local?: Pick<Storage, 'getItem'>,
): boolean {
  if (actorId === null) return false;
  try {
    return (
      (local ?? window.localStorage).getItem(departureKey(actorId, roundId)) !==
      null
    );
  } catch {
    return false;
  }
}

const removeWithPrefix = (storage: Storage, prefix: string) => {
  const doomed: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) doomed.push(key);
  }
  for (const key of doomed) storage.removeItem(key);
};

/** An ended account leaves no departure, nor an advisory claim a crash stranded. */
export function clearAccountResumeRecords(
  session?: Storage,
  local?: Storage,
): void {
  try {
    const tab = session ?? window.sessionStorage;
    const browser = local ?? window.localStorage;
    removeWithPrefix(tab, resumeHeirPrefix);
    removeWithPrefix(tab, resumeAttemptPrefix);
    removeWithPrefix(browser, departurePrefix);
    removeWithPrefix(browser, resumeOwnershipPrefix);
  } catch {
    // Storage disabled: it holds no records to clear.
  }
}

/** Being back in the Round undoes an earlier step away, so resume works again. */
export function clearDeparture(
  actorId: string,
  roundId: string,
  local?: Pick<Storage, 'removeItem'>,
): void {
  try {
    (local ?? window.localStorage).removeItem(departureKey(actorId, roundId));
  } catch {
    // Storage disabled: there is no record to clear.
  }
}

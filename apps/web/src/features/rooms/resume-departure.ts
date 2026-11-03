import { resumeAttemptPrefix } from './resume-attempt';
import { resumeHeirPrefix, resumeOwnershipPrefix } from './resume-ownership';
import { resumeTabFlag } from './resume-tab-flag';

/**
 * Whether a member left this Round explicitly in this tab, so auto-resume does
 * not fight the departure (ISSUE-879). The server still decides who is seated.
 */
const departurePrefix = 'daisy:resume-left:';
const departure = resumeTabFlag(departurePrefix);

export const markDeparture = departure.mark;
export const departedInSession = departure.isSet;

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
    removeWithPrefix(tab, departurePrefix);
    removeWithPrefix(tab, resumeHeirPrefix);
    removeWithPrefix(tab, resumeAttemptPrefix);
    removeWithPrefix(local ?? window.localStorage, resumeOwnershipPrefix);
  } catch {
    // Storage disabled: it holds no records to clear.
  }
}

/** Being back in the Round undoes an earlier step away, so resume works again. */
export const clearDeparture = departure.clear;

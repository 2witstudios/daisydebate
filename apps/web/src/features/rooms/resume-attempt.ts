/**
 * Whether this tab already sent its member to this Round and has not seen it render
 * (ISSUE-1035). A page that keeps failing must not take home and the lobby with it, so
 * one attempt holds until the Round renders. Tab-local UX only: it confers nothing.
 */
export const resumeAttemptPrefix = 'daisy:resume-attempt:';
const attemptKey = (actorId: string, roundId: string) =>
  `${resumeAttemptPrefix}${actorId}:${roundId}`;

export function markResumeAttempt(
  actorId: string,
  roundId: string,
  session?: Pick<Storage, 'setItem'>,
): void {
  try {
    (session ?? window.sessionStorage).setItem(
      attemptKey(actorId, roundId),
      '1',
    );
  } catch {
    // Storage disabled: nothing can remember the attempt across this navigation.
  }
}

export function attemptedResume(
  actorId: string | null,
  roundId: string,
  session?: Pick<Storage, 'getItem'>,
): boolean {
  if (actorId === null) return false;
  try {
    return (
      (session ?? window.sessionStorage).getItem(
        attemptKey(actorId, roundId),
      ) === '1'
    );
  } catch {
    return false;
  }
}

/** The Round rendered, so resume may fire again. */
export function clearResumeAttempt(
  actorId: string,
  roundId: string,
  session?: Pick<Storage, 'removeItem'>,
): void {
  try {
    (session ?? window.sessionStorage).removeItem(attemptKey(actorId, roundId));
  } catch {
    // Storage disabled: there is no record to clear.
  }
}

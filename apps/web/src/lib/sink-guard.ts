/**
 * Runs one step of a failure or report sink. A sink that throws is never its
 * caller's fault (ISSUE-789): the step's failure is swallowed, and the
 * answer says whether the step completed, so a caller can count only what
 * was actually delivered.
 */
export function guarded(step: () => void): boolean {
  try {
    step();
    return true;
  } catch {
    return false;
  }
}

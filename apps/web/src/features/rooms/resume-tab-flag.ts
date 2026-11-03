/**
 * One per-tab fact about a member and a Round, kept in sessionStorage under
 * `prefix`. Tab-local UX only: it confers nothing, and with storage disabled
 * every call quietly does nothing.
 */
export function resumeTabFlag(prefix: string) {
  const key = (actorId: string, roundId: string) =>
    `${prefix}${actorId}:${roundId}`;
  return {
    mark(
      actorId: string | null,
      roundId: string,
      session?: Pick<Storage, 'setItem'>,
    ): void {
      if (actorId === null) return;
      try {
        (session ?? window.sessionStorage).setItem(key(actorId, roundId), '1');
      } catch {
        // Storage disabled: the flag holds only for this navigation.
      }
    },
    isSet(
      actorId: string | null,
      roundId: string,
      session?: Pick<Storage, 'getItem'>,
    ): boolean {
      if (actorId === null) return false;
      try {
        return (
          (session ?? window.sessionStorage).getItem(key(actorId, roundId)) ===
          '1'
        );
      } catch {
        return false;
      }
    },
    clear(
      actorId: string,
      roundId: string,
      session?: Pick<Storage, 'removeItem'>,
    ): void {
      try {
        (session ?? window.sessionStorage).removeItem(key(actorId, roundId));
      } catch {
        // Storage disabled: there is no record to clear.
      }
    },
  };
}

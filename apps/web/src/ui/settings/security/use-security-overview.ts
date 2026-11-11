'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  loadSecurityOverview,
  PasskeyRow,
  SecurityOutcome,
  SessionRow,
} from '../../../features/account/security-client';
import { OUTCOME_NOTICES } from './security-notices';

type Overview = Awaited<ReturnType<typeof loadSecurityOverview>>;

const noticeOf = (outcome: SecurityOutcome): string | undefined =>
  outcome.kind === 'ok' ? undefined : OUTCOME_NOTICES[outcome.kind];

/**
 * The account's passkeys and sessions as the security screen holds them: read
 * from the server, then changed here as each row's own action lands. A read
 * still in flight when a change lands here began before it and is stale, so the
 * change discards it and reads again; it can never put a removed row back.
 */
export function useSecurityOverview({
  load,
  revokeOthers,
  sessionsNotice: initialSessionsNotice,
}: {
  readonly load: () => Promise<Overview>;
  readonly revokeOthers: () => Promise<SecurityOutcome>;
  readonly sessionsNotice?: string | undefined;
}) {
  const [passkeys, setPasskeys] = useState<readonly PasskeyRow[]>([]);
  const [sessions, setSessions] = useState<readonly SessionRow[]>([]);
  const [passkeysNotice, setPasskeysNotice] = useState<string | undefined>();
  const [sessionsNotice, setSessionsNotice] = useState<string | undefined>(
    initialSessionsNotice,
  );
  const [signingOutOthers, setSigningOutOthers] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  const reading = useRef(false);
  /** A row changed here: whatever is being read no longer says what is so. */
  const changedHere = () => {
    if (reading.current) reload();
  };

  useEffect(() => {
    let cancelled = false;
    reading.current = true;
    void (async () => {
      const overview = await load();
      if (cancelled) return;
      reading.current = false;
      setPasskeys(overview.passkeys);
      setSessions(overview.sessions);
      setPasskeysNotice(noticeOf(overview.passkeysOutcome));
      setSessionsNotice(noticeOf(overview.sessionsOutcome));
    })();
    return () => {
      cancelled = true;
    };
  }, [load, reloadToken]);

  return {
    passkeys,
    sessions,
    passkeysNotice,
    sessionsNotice,
    reload,
    signingOutOthers,
    renamePasskey: (id: string, name: string) => {
      setPasskeys((rows) =>
        rows.map((row) => (row.id === id ? { ...row, name } : row)),
      );
      changedHere();
    },
    removePasskey: (id: string) => {
      setPasskeys((rows) => rows.filter((row) => row.id !== id));
      changedHere();
    },
    removeSession: (id: string) => {
      setSessions((rows) => rows.filter((row) => row.id !== id));
      changedHere();
    },
    signOutOthers: () => {
      if (signingOutOthers) return;
      setSigningOutOthers(true);
      void revokeOthers().then((outcome) => {
        setSigningOutOthers(false);
        if (outcome.kind === 'ok') reload();
        else setSessionsNotice(OUTCOME_NOTICES[outcome.kind]);
      });
    },
  };
}

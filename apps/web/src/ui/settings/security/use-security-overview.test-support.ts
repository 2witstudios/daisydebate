import { createElement } from 'react';
import { signOutNoticeOf } from './security-overview-model';
import { useSecurityOverview } from './use-security-overview';

export { act, createElement } from 'react';
export { createRoot } from 'react-dom/client';

type Deps = Parameters<typeof useSecurityOverview>[0];
type Held = ReturnType<typeof useSecurityOverview>;

/** Renders what the hook holds, and hands the test its actions. */
export function OverviewProbe(
  props: Deps & { readonly hold: (held: Held) => void },
) {
  const { hold, ...deps } = props;
  const held = useSecurityOverview(deps);
  hold(held);
  const { lists } = held.overview;
  const rows = (list: 'passkeys' | 'sessions') =>
    lists.kind === 'read' && lists[list].kind === 'listed'
      ? lists[list].rows.map((row) => row.id)
      : [];
  return createElement(
    'output',
    { 'data-lists': lists.kind },
    JSON.stringify({
      passkeys: rows('passkeys'),
      sessions: rows('sessions'),
      sessionsNotice:
        lists.kind === 'read' && lists.sessions.kind === 'unavailable'
          ? lists.sessions.notice
          : null,
      signOutNotice: signOutNoticeOf(held.overview),
    }),
  );
}

import { createElement } from 'react';
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
  return createElement(
    'output',
    null,
    JSON.stringify({
      passkeys: held.passkeys.map((row) => row.id),
      sessions: held.sessions.map((row) => row.id),
      sessionsNotice: held.sessionsNotice ?? null,
      signOutNotice: held.signOutNotice ?? null,
    }),
  );
}

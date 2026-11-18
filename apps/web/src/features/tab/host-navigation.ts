import type { HostNavigationView } from '@daisy/protocol/lobby/host-navigation-read';
import { linkTo } from './action';
import { hostRoutes } from './routes';
import type { TimelineRail } from './tournament';

/**
 * Every item reflects an evaluated area, rather than the mere presence of a
 * role. `billing` is the tournament's hosting Billing, for its managers
 * while host tiers are released (ADR 0149).
 */
export function hostNavigationRail(
  view: HostNavigationView & { readonly billing?: boolean },
): TimelineRail {
  const has = (capability: HostNavigationView['areas'][number]) =>
    view.areas.includes(capability);
  const item = (id: string, label: string, href: string) => ({
    id,
    label,
    time: null,
    standing: null,
    action: linkTo(label, href),
  });
  return {
    title: view.name,
    subtitle: null,
    heading: null,
    items:
      view.kind === 'organization'
        ? [item('organization', 'Overview', hostRoutes.league(view.handle))]
        : [
            ...(view.manageSetup
              ? [
                  item('setup', 'Setup', hostRoutes.setup(view.handle)),
                  item(
                    'events',
                    'Events and schedule',
                    hostRoutes.events(view.handle),
                  ),
                ]
              : []),
            ...(has('lobby.host.draw.read')
              ? [item('draw', 'Draw', hostRoutes.tournament(view.handle))]
              : []),
            ...(has('lobby.host.entries.read')
              ? [
                  item('entries', 'Entries', hostRoutes.entries(view.handle)),
                  item('judges', 'Judges', hostRoutes.judges(view.handle)),
                ]
              : []),
            ...(has('lobby.host.ballots.read')
              ? [item('ballots', 'Ballots', hostRoutes.ballots(view.handle))]
              : []),
            ...(has('lobby.host.results.read')
              ? [
                  item(
                    'break',
                    'Standings and break',
                    hostRoutes.standings(view.handle),
                  ),
                  item('results', 'Results', hostRoutes.results(view.handle)),
                ]
              : []),
          ],
    footHeading: null,
    foot: [
      ...(has('lobby.host.people.read')
        ? [
            item(
              'people',
              'People',
              view.kind === 'organization'
                ? hostRoutes.leaguePeople(view.handle)
                : hostRoutes.people(view.handle),
            ),
          ]
        : []),
      ...(view.kind === 'lobby' && view.manageSetup && view.billing === true
        ? [item('billing', 'Billing', hostRoutes.billing(view.handle))]
        : []),
    ],
  };
}

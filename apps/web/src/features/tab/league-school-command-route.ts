import {
  createTabCommandRoute,
  type TabCommandRouteDependencies,
} from './command-route';
import { leagueSchoolCommand } from './operations/league-schools';

export const createLeagueSchoolCommandRoute = (
  dependencies: Parameters<typeof leagueSchoolCommand>[0] &
    Pick<TabCommandRouteDependencies, 'boundary' | 'released'>,
) =>
  createTabCommandRoute({
    boundary: dependencies.boundary,
    released: dependencies.released,
    name: 'tab.league.school.command',
    address: 'none',
    execute: leagueSchoolCommand(dependencies),
  });

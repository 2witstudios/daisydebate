import {
  createTabCommandRoute,
  type TabCommandRouteDependencies,
} from './command-route';
import { drawCommand } from './operations/draw-command';
import { drawCompetition } from './operations/draw-competition';

export type DrawCommandRouteDependencies = Omit<
  Parameters<typeof drawCommand>[0],
  'competition'
> &
  Pick<TabCommandRouteDependencies, 'boundary' | 'released'>;
/** Every Draw request uses the real retained competition and the evaluated member/origin boundary. */
export const createDrawCommandRoute = (
  dependencies: DrawCommandRouteDependencies,
) =>
  createTabCommandRoute({
    boundary: dependencies.boundary,
    released: dependencies.released,
    name: 'tab.draw.command',
    address: 'lobby',
    execute: drawCommand({ ...dependencies, competition: drawCompetition }),
  });

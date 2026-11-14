import type { TournamentLobbyView } from '@daisy/protocol/lobby/lobby-read';
import type { RailStanding } from '../tournament';
import { AUTUMN, WINTER } from './moment';
import type { SampleScene } from './scene';
import { autumnLobby } from './tournament-autumn';
import { winterLobby } from './tournament-winter';

/** A count, a start time or a word that asks nothing of the host. */
export const said = (text: string): RailStanding => ({ kind: 'note', text });
export const done: RailStanding = { kind: 'done' };

/**
 * The lobby read the host's timeline rail is projected from: the
 * tournament as its host sees it, with what waits on them.
 */
export function sampleTimelineRead(
  slug: string,
  scene: SampleScene,
): TournamentLobbyView | null {
  const host = { ...scene, viewer: 'host' } as const;
  if (slug === AUTUMN) return autumnLobby(host, true);
  if (slug === WINTER) return winterLobby(host, true);
  return null;
}

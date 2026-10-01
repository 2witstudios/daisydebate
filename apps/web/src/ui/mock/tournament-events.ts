import { shiftMinutes } from '../../features/tournaments/dates';
import type { EventData } from '../../features/tournaments/event';
import { sampleTournaments, sampleViewer } from './tournaments';

/**
 * The sample viewer's event in Harvest Cup (semifinal 1 of 3 rounds). The
 * pairing starts 18 minutes after the injected `now`, so "starts in" reads
 * the same whenever the page renders. Seeds, ratings and handles are samples.
 */
export const sampleEvent = (now: string): EventData | null => {
  const tournament = sampleTournaments.find(
    (item) => item.id === 'harvest-cup',
  );
  if (!tournament) return null;
  const startsAt = shiftMinutes(now, 18);
  return {
    tournament,
    viewer: sampleViewer,
    seed: 4,
    played: [
      {
        stage: 'Quarterfinal',
        opponent: 'debater-b',
        side: 'Affirmative',
        judge: 'judge-m',
        result: 'Won',
      },
    ],
    pairing: {
      stage: 'Semifinal',
      opponent: { handle: 'debater-c', seed: 1, rating: 1705 },
      side: 'Negative',
      judge: 'judge-k',
      room: 'Harvest Cup, Semifinal 1',
      roomSlug: 'semifinal-1',
      startsAt,
    },
    final: { stage: 'Final', startsAt: shiftMinutes(startsAt, 150) },
    watching: 31,
  };
};

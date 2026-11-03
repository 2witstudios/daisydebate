import type { DebateSide, SpectatorTimeline } from '@daisy/protocol';
import { formatCountdown } from '../../lib/clock-display';

export const sideLabel: Readonly<Record<DebateSide, string>> = {
  affirmative: 'Affirmative',
  negative: 'Negative',
};

/** The fact burned into the video at this point, in words a screen reader can say. */
export const stageSentence = (stage: SpectatorTimeline['stage']): string => {
  switch (stage.kind) {
    case 'upcoming':
      return 'This Round hasn’t started.';
    case 'slate':
      return 'Nothing is on stage right now.';
    case 'ended':
      return 'This Round has ended.';
    case 'floor':
      return stage.segment === 'cross_ex'
        ? `Cross-examination: ${sideLabel[stage.side]} asks, ${formatCountdown(stage.remainingMs)} left.`
        : `${stage.label}: ${sideLabel[stage.side]} has the floor, ${formatCountdown(stage.remainingMs)} left.`;
  }
};

export const resultSentence = (
  winner: NonNullable<SpectatorTimeline['result']>['winner'],
): string => (winner ? `${sideLabel[winner]} won.` : 'No side won this Round.');

import type { DebateSide, SpectatorTimeline } from '@daisy/protocol';

export const sideLabel: Readonly<Record<DebateSide, string>> = {
  affirmative: 'Affirmative',
  negative: 'Negative',
};

type SlateMoment = Extract<
  SpectatorTimeline['stage'],
  { kind: 'slate' }
>['moment'];

/**
 * What the slate in the video says, as far as released facts can tell. Preparation
 * shares the between-speeches line: prep leaves no released fact of its own.
 */
const slateSentences: Readonly<Record<SlateMoment, string>> = {
  before_first_speech: 'The first speech is still to come.',
  between_speeches: 'Preparation or a break: the next speech is coming.',
  speeches_over: 'The speeches are over. The result comes next.',
};

/**
 * The fact burned into the video at this point, in words a screen reader can
 * say. It holds no clock: it is announced whenever it changes, and a running
 * clock would announce every read.
 */
export const stageSentence = (stage: SpectatorTimeline['stage']): string => {
  switch (stage.kind) {
    case 'upcoming':
      return 'This Round hasn’t started.';
    case 'slate':
      return slateSentences[stage.moment];
    case 'ended':
      return 'This Round has ended.';
    case 'floor':
      return stage.segment === 'cross_ex'
        ? `Cross-examination: ${sideLabel[stage.side]} asks.`
        : `${stage.label}: ${sideLabel[stage.side]} has the floor.`;
  }
};

export const resultSentence = (
  winner: NonNullable<SpectatorTimeline['result']>['winner'],
): string => (winner ? `${sideLabel[winner]} won.` : 'No side won this Round.');

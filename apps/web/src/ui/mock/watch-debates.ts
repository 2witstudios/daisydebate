import type { WatchDebate } from '../../features/watch/debate';
import { debate, live, seat } from './watch-debate-builders';
import { sampleEndedDebates } from './watch-ended-debates';

const a = seat('debater-a', 1710);
const b = seat('debater-b', 1698);
const you = seat('you', 1412);

/** Sample debates: live and listed, every refusal, and the ended ones. */
export const sampleDebates: readonly WatchDebate[] = [
  live(
    {
      id: 'top-of-the-ladder',
      title: 'Top of the ladder',
      mode: 'ranked',
      aff: a,
      neg: b,
    },
    142,
    4,
  ),
  live(
    {
      id: 'finals-rehearsal',
      title: 'Finals rehearsal',
      mode: 'ranked',
      aff: seat('debater-c', 1705),
      neg: seat('debater-d', 1690),
    },
    31,
    4,
  ),
  live(
    {
      id: 'serious-only',
      title: 'Serious only',
      mode: 'ranked',
      aff: seat('debater-e', 1620),
      neg: seat('debater-f', 1588),
    },
    14,
    0,
  ),
  live(
    {
      id: 'quarterfinal-practice',
      title: 'Quarterfinal practice',
      mode: 'ranked',
      aff: seat('debater-g', 1390),
      neg: seat('debater-h', 1402),
    },
    21,
    2,
  ),
  live(
    {
      id: 'friendly-spar',
      title: 'Friendly spar',
      mode: 'casual',
      aff: seat('debater-i', 1260),
      neg: seat('debater-j', 1240),
    },
    3,
    4,
  ),
  live(
    {
      id: 'custom-rules-table',
      title: 'Custom rules table',
      mode: 'casual',
      customRules: true,
      aff: seat('debater-k', 1180),
      neg: seat('debater-l', 1215),
    },
    7,
    6,
  ),
  live(
    {
      id: 'newcomers-round',
      title: 'Newcomers round',
      mode: 'casual',
      aff: seat('debater-m', 1040, 'provisional'),
      neg: seat('debater-n', 1012, 'provisional'),
    },
    5,
    0,
  ),
  live(
    {
      id: 'packed-house',
      title: 'Packed house',
      mode: 'ranked',
      audienceFull: true,
      aff: seat('debater-o', 1500),
      neg: seat('debater-p', 1490),
    },
    500,
    2,
  ),
  live(
    {
      id: 'your-own-debate',
      title: 'Your own debate',
      mode: 'casual',
      visibility: 'unlisted',
      aff: you,
      neg: seat('debater-x', 1400),
    },
    2,
    2,
  ),
  live(
    {
      id: 'host-restricted',
      title: 'Host restricted',
      mode: 'casual',
      visibility: 'unlisted',
      removedSpectators: ['you'],
      aff: seat('debater-y', 1300),
      neg: seat('debater-z', 1310),
    },
    6,
    2,
  ),
  live(
    {
      id: 'closed-door',
      title: 'Closed door',
      mode: 'casual',
      visibility: 'private',
      aff: seat('debater-q', 1300),
      neg: seat('debater-r', 1310),
    },
    2,
    2,
  ),
  debate(
    {
      id: 'starting-soon',
      title: 'Evening ladder match',
      mode: 'ranked',
      aff: a,
      neg: b,
    },
    { status: 'upcoming', affReady: true, negReady: false },
  ),
  ...sampleEndedDebates,
];

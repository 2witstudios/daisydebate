import type { WatchDebate } from '../../features/watch/debate';
import { ended, published, seat } from './watch-debate-builders';

const you = seat('you', 1412);
const g = seat('debater-g', 1655);
const h = seat('debater-h', 1641);
const c = seat('debater-c', 1710);
const d = seat('debater-d', 1690);
const kept = 'Kept until [date]';

/** Sample debates that have ended: results, pending ballots and recordings. */
export const sampleEndedDebates: readonly WatchDebate[] = [
  ended(
    {
      id: 'semifinal-rehearsal',
      title: 'Semifinal rehearsal',
      mode: 'ranked',
      aff: g,
      neg: h,
    },
    published('neg', 2, 1, true, g, h),
    '2026-09-29T18:30:00.000Z',
    30,
  ),
  ended(
    {
      id: 'evening-round',
      title: 'Evening round',
      mode: 'ranked',
      aff: c,
      neg: d,
    },
    { state: 'pending', received: 2, of: 3 },
    '2026-09-28T19:00:00.000Z',
    30,
  ),
  ended(
    {
      id: 'practice-with-a-friend',
      title: 'Practice with a friend',
      mode: 'casual',
      customRules: true,
      visibility: 'private',
      aff: you,
      neg: seat('debater-k', 1399),
      judges: ['judge-one'],
    },
    published('aff', 1, 0, false, you, seat('debater-k', 1399)),
    '2026-09-27T17:00:00.000Z',
    38,
    'ready',
    kept,
  ),
  ended(
    {
      id: 'open-table',
      title: 'Open table',
      mode: 'casual',
      aff: seat('debater-m', 1330),
      neg: seat('debater-n', 1310),
      judges: ['judge-one'],
    },
    published(
      'neg',
      1,
      0,
      false,
      seat('debater-m', 1330),
      seat('debater-n', 1310),
    ),
    '2026-09-26T16:00:00.000Z',
    27,
  ),
  ended(
    {
      id: 'fast-rounds',
      title: 'Fast rounds',
      mode: 'ranked',
      visibility: 'unlisted',
      aff: you,
      neg: seat('debater-p', 1440),
    },
    published('neg', 2, 1, true, you, seat('debater-p', 1440)),
    '2026-09-25T15:00:00.000Z',
    31,
    'ready',
    kept,
  ),
  ended(
    {
      id: 'ladder-climb',
      title: 'Ladder climb',
      mode: 'ranked',
      aff: seat('debater-q', 1580),
      neg: seat('debater-r', 1555),
    },
    published(
      'aff',
      3,
      0,
      true,
      seat('debater-q', 1580),
      seat('debater-r', 1555),
    ),
    '2026-09-24T14:00:00.000Z',
    33,
  ),
  ended(
    {
      id: 'custom-rules-test',
      title: 'Custom rules test',
      mode: 'casual',
      customRules: true,
      aff: you,
      neg: seat('debater-s', 1380),
      judges: ['judge-one'],
    },
    published('aff', 1, 0, false, you, seat('debater-s', 1380)),
    '2026-09-22T13:00:00.000Z',
    25,
    'ready',
    kept,
  ),
  ended(
    {
      id: 'season-opener',
      title: 'Season opener',
      mode: 'ranked',
      aff: seat('debater-t', 1490),
      neg: seat('debater-u', 1475),
    },
    published(
      'neg',
      2,
      1,
      true,
      seat('debater-t', 1490),
      seat('debater-u', 1475),
    ),
    '2026-09-21T12:00:00.000Z',
    35,
  ),
  ended(
    {
      id: 'just-finished',
      title: 'Just finished',
      mode: 'ranked',
      aff: seat('debater-v', 1500),
      neg: seat('debater-w', 1490),
    },
    { state: 'pending', received: 0, of: 3 },
    '2026-09-30T17:55:00.000Z',
    30,
    'processing',
  ),
  ended(
    {
      id: 'older-round',
      title: 'Older round',
      mode: 'ranked',
      aff: seat('debater-v', 1500),
      neg: seat('debater-w', 1490),
    },
    published(
      'aff',
      2,
      1,
      true,
      seat('debater-v', 1500),
      seat('debater-w', 1490),
    ),
    '2026-05-01T12:00:00.000Z',
    30,
    'expired',
  ),
  ended(
    {
      id: 'closed-door-recording',
      title: 'Closed door recording',
      mode: 'casual',
      visibility: 'private',
      aff: seat('debater-q', 1300),
      neg: seat('debater-r', 1310),
      judges: ['judge-one'],
    },
    published(
      'aff',
      1,
      0,
      false,
      seat('debater-q', 1300),
      seat('debater-r', 1310),
    ),
    '2026-09-23T12:00:00.000Z',
    20,
  ),
];

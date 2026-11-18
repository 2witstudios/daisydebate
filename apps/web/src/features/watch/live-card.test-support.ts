import type { LiveBroadcastPage } from '@daisy/db';
import { SPECTATOR_MARGIN_MS, twoSides } from '@daisy/protocol';
import { liveCardOf, type LiveCard } from './live-card';

type LiveRow = LiveBroadcastPage['rows'][number];

const started = new Date('2026-11-02T00:00:00.000Z');

/** A live Round as the listing read returns it: 30 s into its first speech. */
export const liveRow = (over: Partial<LiveRow> = {}): LiveRow => ({
  id: 'abcdefghijklmnopqrstuvwx',
  title: 'Friday night',
  status: 'active',
  competitionType: 'ranked',
  ladder: { style: 'freestyle', division: 'open' },
  resolution: 'A drawn resolution',
  rules: {
    sides: twoSides,
    seats: {
      sides: { affirmative: 1, negative: 1 },
      speakers: 0,
      judges: 1,
      moderators: 0,
    },
    segments: [
      {
        key: '1AC',
        label: 'First affirmative',
        type: 'speech',
        speak: {
          rights: 'one',
          seat: { kind: 'side', side: 'affirmative', slot: 0 },
        },
      },
      {
        key: '1NC',
        label: 'First negative',
        type: 'speech',
        speak: {
          rights: 'one',
          seat: { kind: 'side', side: 'negative', slot: 0 },
        },
      },
    ],
  } as never,
  startedAt: started,
  horizon: null,
  horizonMs: started.getTime() + 30_000 + SPECTATOR_MARGIN_MS,
  seats: [
    {
      roundId: 'abcdefghijklmnopqrstuvwx',
      seat: { kind: 'side', side: 'affirmative', slot: 0 },
      kind: 'user',
      username: 'ana',
      botName: null,
    },
    {
      roundId: 'abcdefghijklmnopqrstuvwx',
      seat: { kind: 'side', side: 'negative', slot: 0 },
      kind: 'bot',
      username: null,
      botName: 'Socrates',
    },
  ] as never,
  segments: [
    {
      roundId: 'abcdefghijklmnopqrstuvwx',
      type: 'speech',
      key: '1AC',
      startedAt: started,
      endedAt: null,
      durationMs: 100_000,
    },
  ] as never,
  ...over,
});

export const liveCard = (over: Partial<LiveRow> = {}): LiveCard =>
  liveCardOf(liveRow(over));

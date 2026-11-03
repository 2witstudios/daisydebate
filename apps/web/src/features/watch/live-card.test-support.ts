import type { LiveBroadcastPage } from '@daisy/db';
import { SPECTATOR_MARGIN_MS } from '@daisy/protocol';
import { liveCardOf, type LiveCard } from './live-card';

type LiveRow = LiveBroadcastPage['rows'][number];

const started = new Date('2026-11-02T00:00:00.000Z');

/** A live Round as the listing read returns it: 30 s into its first speech. */
export const liveRow = (over: Partial<LiveRow> = {}): LiveRow => ({
  id: 'abcdefghijklmnopqrstuvwx',
  title: 'Friday night',
  status: 'active',
  competitionType: 'ranked',
  resolution: 'A drawn resolution',
  rules: {
    segments: [
      { key: '1AC', label: 'First affirmative', side: 'affirmative' },
      { key: '1NC', label: 'First negative', side: 'negative' },
    ],
  } as never,
  horizon: null,
  horizonMs: started.getTime() + 30_000 + SPECTATOR_MARGIN_MS,
  seats: [
    {
      roundId: 'abcdefghijklmnopqrstuvwx',
      side: 'affirmative',
      kind: 'user',
      username: 'ana',
      botName: null,
    },
    {
      roundId: 'abcdefghijklmnopqrstuvwx',
      side: 'negative',
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

import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { rejectionOf } from '@daisy/errors/testing';
import type { RoundView } from '@daisy/protocol';
import {
  asCompleted,
  origin,
  ran,
  rules,
  startOf,
} from '../../ui/debate-room/live-round.test-support';
import { studentLiveCard, studentsLive } from './students-live';

setupRitewayBun();

const watching = (round: RoundView): RoundView => ({
  ...round,
  viewerIsHost: false,
  viewerIsUndelayedObserver: true,
});
const nowMs = origin + startOf(0) + 60_000;

describe('studentLiveCard', () => {
  test("a linked adult's live Round", () => {
    const round = watching(ran(1));
    assert({
      given: 'a live Round its viewer watches as a linked adult',
      should:
        'link its live room and name its debaters, the stage and the speech',
      actual: studentLiveCard(round, 'Thursday scrimmage', nowMs),
      expected: {
        roundId: round.id,
        href: `/rounds/${round.id}/room`,
        title: 'Thursday scrimmage',
        resolution: round.topic,
        line: `Sam Reyes vs Practice bot · Speeches · ${rules[0]!.label}`,
      },
    });
  });
  test('any other Round', () => {
    assert({
      given:
        'a Round watched by its host, an ended Round, and one the viewer only reads',
      should: 'offer no card',
      actual: [
        studentLiveCard(
          { ...watching(ran(1)), viewerIsHost: true },
          't',
          nowMs,
        ),
        studentLiveCard(watching(asCompleted(ran(1))), 't', nowMs),
        studentLiveCard(ran(1), 't', nowMs),
      ],
      expected: [null, null, null],
    });
  });
});

describe('studentsLive', () => {
  const live = watching(ran(1));
  const list = (view: (roundId: string) => Promise<RoundView>) =>
    studentsLive({
      candidates: async () => [
        { roundId: 'watched', title: 'Watched' },
        { roundId: 'refused', title: 'Refused' },
      ],
      view: async (_caller: unknown, roundId: string) => view(roundId),
      nowMs: () => nowMs,
    })({});
  test('each candidate is read as the viewer', async () => {
    const cards = await list(async (roundId) => {
      if (roundId === 'refused') throw createAppError('NOT_FOUND');
      return live;
    });
    assert({
      given:
        'two candidate Rounds, one the viewer may watch and one their read refuses',
      should: 'list only the one they may watch',
      actual: cards.map((card) => card.title),
      expected: ['Watched'],
    });
  });
  test('an outage is not a refusal', async () => {
    assert({
      given: 'a Round read that fails for want of the database',
      should: 'fail rather than show an empty list',
      actual: (
        await rejectionOf(() =>
          list(async () => {
            throw createAppError('INFRASTRUCTURE');
          }),
        )
      )?.code,
      expected: 'INFRASTRUCTURE',
    });
  });
});

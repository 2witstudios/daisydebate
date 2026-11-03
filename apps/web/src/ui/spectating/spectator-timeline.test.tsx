import { ballotCategories, type SpectatorTimeline } from '@daisy/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { SpectatorFacts } from './spectator-timeline';

setupRitewayBun();

const timeline: SpectatorTimeline = {
  version: 1,
  roundId: 'abcdefghijklmnopqrstuvwx',
  mode: 'ranked',
  hasBroadcast: true,
  resolution: null,
  seats: [
    { side: 'affirmative', kind: 'human', label: 'ana' },
    { side: 'negative', kind: 'bot', label: null },
  ],
  stage: { kind: 'slate' },
  result: null,
  captions: [],
  releasedThrough: null,
};
const fours = Object.fromEntries(ballotCategories.map((c) => [c, 4])) as never;
const html = (over: Partial<SpectatorTimeline>) =>
  renderToStaticMarkup(<SpectatorFacts timeline={{ ...timeline, ...over }} />);

describe('SpectatorFacts', () => {
  test('repeats the facts in the video as text', () => {
    const page = html({
      resolution: 'A resolution',
      stage: {
        kind: 'floor',
        segment: 'speech',
        label: 'First affirmative',
        side: 'affirmative',
        remainingMs: 65_000,
      },
      captions: [{ id: 'c', side: 'affirmative', text: 'A line' }],
    });
    assert({
      given: 'a released speech',
      should:
        'state resolution, seats, floor, clock and captions in a live region',
      actual: [
        'A resolution',
        'Affirmative: ana',
        'Negative: Unnamed debater',
        'aria-live="polite">First affirmative: Affirmative has the floor',
        '1:05',
        'Affirmative: A line',
      ].filter((text) => !page.includes(text)),
      expected: [],
    });
  });

  test('a result, and a tie', () => {
    assert({
      given: 'a released tie',
      should: 'say no side won and never call it a draw',
      actual: (() => {
        const page = html({
          stage: { kind: 'ended' },
          result: { winner: null, ballots: [], ratings: [] },
        });
        return [page.includes('No side won'), /draw/i.test(page)];
      })(),
      expected: [true, false],
    });
  });

  test('names ballots by number, never a judge', () => {
    assert({
      given: 'a released ballot',
      should: 'number it and show its scores and reason',
      actual: html({
        stage: { kind: 'ended' },
        result: {
          winner: 'affirmative',
          ratings: [{ side: 'affirmative', before: 1500, after: 1516 }],
          ballots: [
            {
              winner: 'affirmative',
              scores: { affirmative: fours, negative: fours },
              reason: 'A clear reason',
            },
          ],
        },
      }).match(/Ballot 1|Affirmative 40|A clear reason|1500 to 1516/g),
      expected: [
        '1500 to 1516',
        'Ballot 1',
        'Affirmative 40',
        'A clear reason',
      ],
    });
  });
});

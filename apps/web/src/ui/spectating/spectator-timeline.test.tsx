import { ballotCategories } from '@daisy/protocol/ballot';
import { twoSides } from '@daisy/protocol/seats';
import { type SpectatorTimeline } from '@daisy/protocol/spectator-timeline';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { SpectatorFacts } from './spectator-timeline';

import { stageSentence } from './spectator-timeline-copy';

setupRitewayBun();

const timeline: SpectatorTimeline = {
  version: 1,
  roundId: 'abcdefghijklmnopqrstuvwx',
  mode: 'ranked',
  broadcast: { state: 'none' },
  recording: 'none',
  resolution: null,
  sides: [...twoSides],
  seats: [
    {
      seat: { kind: 'side', side: 'affirmative', slot: 0 },
      kind: 'human',
      label: 'ana',
    },
    {
      seat: { kind: 'side', side: 'negative', slot: 0 },
      kind: 'bot',
      label: null,
    },
  ],
  stage: { kind: 'slate', moment: 'unreleased' },
  result: null,
  captions: [],
  releasedThrough: null,
};
const fours = Object.fromEntries(ballotCategories.map((c) => [c, 4])) as never;
const render = (over: Partial<SpectatorTimeline>) =>
  renderAccessible(<SpectatorFacts timeline={{ ...timeline, ...over }} />);

describe('SpectatorFacts', () => {
  test('a screen reader hears the floor change, not the clock', () => {
    const page = render({
      stage: {
        kind: 'floor',
        segment: 'speech',
        label: 'First affirmative',
        lead: { kind: 'side', side: 'affirmative', slot: 0 },
        remainingMs: 65_000,
      },
    });
    assert({
      given: 'a clock that changes on every read',
      should: 'give it the timer role, which is not live',
      actual: page.within('region', 'Round facts').text('timer'),
      expected: '1:05 left',
    });
  });

  test('repeats the facts in the video as text', () => {
    const page = render({
      resolution: 'A resolution',
      stage: {
        kind: 'floor',
        segment: 'speech',
        label: 'First affirmative',
        lead: { kind: 'side', side: 'affirmative', slot: 0 },
        remainingMs: 65_000,
      },
      captions: [
        {
          id: 'c',
          seat: { kind: 'side', side: 'affirmative', slot: 0 },
          text: 'A line',
        },
      ],
    });
    assert({
      given: 'a released speech',
      should: 'state resolution, seats, floor, clock and captions as text',
      actual: [
        page.has('heading', 'A resolution', { level: 1 }),
        page
          .textContent()
          .includes('Affirmative: anaNegative: Unnamed debater'),
        page
          .textContent()
          .includes('First affirmative: Affirmative has the floor.'),
        page.text('timer'),
        page.within('list', 'Captions').textContent(),
      ],
      expected: [true, true, true, '1:05 left', 'Affirmative: A line'],
    });
  });

  test('what a slate on the video says', () => {
    const said = (
      moment:
        | 'unreleased'
        | 'before_first_speech'
        | 'between_speeches'
        | 'speeches_over',
    ) => stageSentence(timeline, { kind: 'slate', moment });
    assert({
      given: 'each slate the released video can show',
      should: 'say what released facts can tell, and name nothing they cannot',
      actual: (
        [
          'unreleased',
          'before_first_speech',
          'between_speeches',
          'speeches_over',
        ] as const
      ).map(said),
      expected: [
        'Nothing is on stage right now.',
        'The first speech is still to come.',
        'Preparation or a break: the next speech is coming.',
        'The speeches are over. The result comes next.',
      ],
    });
  });

  test('a result, and a tie', () => {
    assert({
      given: 'a released tie',
      should: 'say no side won and never call it a draw',
      actual: (() => {
        const page = render({
          stage: { kind: 'ended' },
          result: { outcome: null, ballots: [], ratings: [] },
        }).textContent();
        return [page.includes('No side won'), /draw/i.test(page)];
      })(),
      expected: [true, false],
    });
  });

  test('names ballots by number, never a judge', () => {
    assert({
      given: 'a released ballot',
      should: 'number it and show its scores and reason',
      actual: render({
        stage: { kind: 'ended' },
        result: {
          outcome: { kind: 'winner', side: 'affirmative' },
          ratings: [{ side: 'affirmative', before: 1500, after: 1516 }],
          ballots: [
            {
              winner: 'affirmative',
              scores: { affirmative: fours, negative: fours },
              reason: 'A clear reason',
            },
          ],
        },
      })
        .textContent()
        .match(/Ballot 1|Affirmative 40|A clear reason|1500 to 1516/g),
      expected: [
        '1500 to 1516',
        'Ballot 1',
        'Affirmative 40',
        'A clear reason',
      ],
    });
  });
});

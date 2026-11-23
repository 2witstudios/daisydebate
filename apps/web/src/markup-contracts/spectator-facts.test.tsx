import { twoSides } from '@daisy/protocol/seats';
import { type SpectatorTimeline } from '@daisy/protocol/spectator-timeline';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { SpectatorFacts } from '../ui/spectating/spectator-timeline';

setupRitewayBun();

/**
 * The floor sentence sits in a bare `aria-live="polite"` paragraph with no
 * role, so what the live region says, and what it leaves out, cannot be asked
 * for by role and name.
 */
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
const html = (over: Partial<SpectatorTimeline>) =>
  renderMarkup(<SpectatorFacts timeline={{ ...timeline, ...over }} />);

describe('SpectatorFacts markup', () => {
  test('a screen reader hears the floor change, not the clock', () => {
    const page = html({
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
      should: 'keep it outside the live region',
      actual: [
        /aria-live="polite"[^>]*>First affirmative: Affirmative has the floor\.</.test(
          page,
        ),
        /aria-live="polite"[^>]*>[^<]*1:05/.test(page),
      ],
      expected: [true, false],
    });
  });

  test('a slate says what the video says, not that nothing is happening', () => {
    const says = (
      moment: 'before_first_speech' | 'between_speeches' | 'speeches_over',
    ) =>
      /aria-live="polite"[^>]*>([^<]*)</.exec(
        html({ stage: { kind: 'slate', moment } }),
      )?.[1];
    assert({
      given: 'each moment a slate can stand for',
      should: 'announce it in words',
      actual: [
        says('before_first_speech'),
        says('between_speeches'),
        says('speeches_over'),
      ],
      expected: [
        'The first speech is still to come.',
        'Preparation or a break: the next speech is coming.',
        'The speeches are over. The result comes next.',
      ],
    });
  });
});

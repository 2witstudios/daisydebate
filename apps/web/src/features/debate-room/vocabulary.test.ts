import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  interruptionLabel,
  roundLength,
  speechName,
  strikeLabel,
  yieldLabel,
} from './vocabulary';
import { shapeLabel } from './seat-names';
import { twoSides } from '@daisy/protocol/seats';

setupRitewayBun();

const seating = (perSide: number) => ({
  sides: twoSides,
  seats: {
    sides: { affirmative: perSide, negative: perSide },
    speakers: 0,
    judges: 1,
    moderators: 0,
  },
});

test('seat shapes read as NvN', () => {
  assert({
    given: 'one debater per side and two per side',
    should: 'read 1v1 and 2v2',
    actual: [
      shapeLabel(seating(1)),
      shapeLabel(seating(2)),
      shapeLabel({
        sides: [],
        seats: { sides: {}, speakers: 6, judges: 1, moderators: 0 },
      }),
    ],
    expected: ['1v1', '2v2', '6 speakers'],
  });
});

test('a speech reads by its full name with its code second', () => {
  assert({
    given: 'the negative constructive',
    should: 'lead with the name and keep the code in brackets',
    actual: speechName({ key: 'NC', label: 'Negative constructive' }),
    expected: 'Negative constructive (NC)',
  });
});

test('rules read in plain words, never as raw values', () => {
  assert({
    given: 'every interruption and yield setting',
    should: 'name each one for a newcomer',
    actual: [
      interruptionLabel.disabled,
      interruptionLabel.enabled,
      yieldLabel(null),
      yieldLabel({ allowed: false, returnsTime: true }),
      yieldLabel({ allowed: true, returnsTime: false }),
      yieldLabel({ allowed: true, returnsTime: true }),
    ],
    expected: [
      'Off',
      'During any speech',
      'Off',
      'Off',
      'On',
      'On · time back to prep',
    ],
  });
});

test('a round’s length is derived from its speeches, countdowns and prep', () => {
  assert({
    given:
      'the shared standard schedule and twenty minutes of shared pre-round prep',
    should: 'include pre-round prep once in the scheduled duration',
    actual: roundLength({
      speechesMs: [5, 2, 6, 2, 3, 5, 3].map((minutes) => minutes * 60_000),
      countdownMs: 10_000,
      prepPerSideMs: null,
      sideCount: 2,
      preRoundPrepMs: 1_200_000,
    }),
    expected: 'about 45 min',
  });
  const quick = [150, 60, 180, 60, 150, 150, 90].map((s) => s * 1000);
  assert({
    given:
      '14 minutes of speeches, seven 0:10 countdowns and 2:00 prep per side',
    should: 'read about 20 minutes, rounded to five',
    actual: roundLength({
      speechesMs: quick,
      countdownMs: 10_000,
      prepPerSideMs: 120_000,
      sideCount: 2,
    }),
    expected: 'about 20 min',
  });
  assert({
    given: 'two one-minute speeches with no countdown or prep',
    should: 'never read less than five minutes',
    actual: roundLength({
      speechesMs: [60_000, 60_000],
      countdownMs: 0,
      prepPerSideMs: null,
      sideCount: 2,
    }),
    expected: 'about 5 min',
  });
});

test('a strike reads as yours only when you made it (PR #472 review)', () => {
  const side = (s: string) => (s === 'affirmative' ? 'Aff team' : 'Neg team');
  const label = (byViewer: boolean, struckSide: 'affirmative' | 'negative') =>
    strikeLabel(
      { kind: 'debater', side: struckSide, byViewer },
      'affirmative',
      side,
    );
  assert({
    given:
      'an Aff debater reading their own strike, their teammate’s, and the other side’s',
    should: 'say you, your teammate, and the other side by name',
    actual: [
      label(true, 'affirmative'),
      label(false, 'affirmative'),
      label(false, 'negative'),
    ],
    expected: [
      'You struck this',
      'Your teammate struck this',
      'Neg team struck this',
    ],
  });
});

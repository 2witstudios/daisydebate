import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  crossExModeLabel,
  interruptionLabel,
  roundLength,
  shapeLabel,
  speechName,
  yieldLabel,
} from './vocabulary';

setupRitewayBun();

test('seat shapes read as NvN', () => {
  assert({
    given: 'one debater per side and two per side',
    should: 'read 1v1 and 2v2',
    actual: [
      shapeLabel({ affirmative: 1, negative: 1 }),
      shapeLabel({ affirmative: 2, negative: 2 }),
    ],
    expected: ['1v1', '2v2'],
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
    given: 'every cross-examination, interruption and yield setting',
    should: 'name each one for a newcomer',
    actual: [
      crossExModeLabel.ordered,
      crossExModeLabel.free,
      interruptionLabel.disabled,
      interruptionLabel.cross_ex_only,
      interruptionLabel.enabled,
      yieldLabel(null),
      yieldLabel({ allowed: false, returnsTime: true }),
      yieldLabel({ allowed: true, returnsTime: false }),
      yieldLabel({ allowed: true, returnsTime: true }),
    ],
    expected: [
      'Questioner leads',
      'Open floor',
      'Off',
      'Only during cross-examination',
      'During any speech',
      'Off',
      'Off',
      'On — unused time is dropped',
      'On — unused time goes back to that side’s prep time, when prep time is on',
    ],
  });
});

test('a round’s length is derived from its speeches, countdowns and prep', () => {
  const quick = [150, 60, 180, 60, 150, 150, 90].map((s) => s * 1000);
  assert({
    given:
      '14 minutes of speeches, seven 0:10 countdowns and 2:00 prep per side',
    should: 'read about 20 minutes, rounded to five',
    actual: roundLength({
      speechesMs: quick,
      countdownMs: 10_000,
      prepPerSideMs: 120_000,
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
    }),
    expected: 'about 5 min',
  });
});

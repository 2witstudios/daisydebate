import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  readRoomDraft,
  roomDraftPreview,
  changeRoomSequence,
  type RoomFormControls,
} from './room-form';
setupRitewayBun();
const controls: RoomFormControls = {
  segments: [
    {
      key: 'AC',
      label: 'Affirmative constructive',
      side: 'affirmative',
      type: 'speech',
      defaultDurationMs: 360000,
      minDurationMs: 30000,
      maxDurationMs: 480000,
    },
    {
      key: 'NC',
      label: 'Negative constructive',
      side: 'negative',
      type: 'speech',
      defaultDurationMs: 420000,
      minDurationMs: 30000,
      maxDurationMs: 480000,
    },
    {
      key: 'AR',
      label: 'Affirmative rebuttal',
      side: 'affirmative',
      type: 'speech',
      defaultDurationMs: 180000,
      minDurationMs: 30000,
      maxDurationMs: 300000,
    },
    {
      key: 'CX',
      label: 'Questions',
      side: 'negative',
      type: 'cross_ex',
      defaultDurationMs: 90000,
      minDurationMs: 30000,
      maxDurationMs: 180000,
    },
  ],
  canEditSequence: true,
  acceptsSequence: (keys) => keys.includes('AC') && keys.includes('NC'),
};
const saved = {
  sequence: ['AC', 'NC', 'AR'],
  durationsMs: { AC: 360000, NC: 420000, AR: 180000 },
};
function posted(keys = saved.sequence, overrides: Record<string, string> = {}) {
  const form = new FormData();
  keys.forEach((key) => form.append('segment', key));
  keys.forEach((key) =>
    form.set(
      `seconds.${key}`,
      overrides[key] ??
        String(saved.durationsMs[key as keyof typeof saved.durationsMs] / 1000),
    ),
  );
  return form;
}
describe('independent room form draft', () => {
  test('refuses ambiguous duplicate duration fields', () => {
    const form = posted();
    form.append('seconds.AC', '120');
    assert({
      given: 'two submitted lengths for one speech',
      should: 'refuse rather than choose an attacker-controlled first value',
      actual: readRoomDraft(form, controls).ok,
      expected: false,
    });
  });
  test('parses each speech separately and derives unequal counts', () => {
    const result = readRoomDraft(
      posted(saved.sequence, { AC: '90', NC: '450' }),
      controls,
    );
    assert({
      given: 'two affirmative speeches and one negative with different lengths',
      should: 'preserve exact order, durations and counts',
      actual: result.ok ? roomDraftPreview(result.draft, controls) : result,
      expected: {
        segments: [
          {
            key: 'AC',
            label: 'Affirmative constructive',
            side: 'affirmative',
            type: 'speech',
            durationMs: 90000,
          },
          {
            key: 'NC',
            label: 'Negative constructive',
            side: 'negative',
            type: 'speech',
            durationMs: 450000,
          },
          {
            key: 'AR',
            label: 'Affirmative rebuttal',
            side: 'affirmative',
            type: 'speech',
            durationMs: 180000,
          },
        ],
        speechCounts: { affirmative: 2, negative: 1 },
        totalMs: 720000,
      },
    });
  });
  test('retains refused typed values and does not mutate saved state', () => {
    const snapshot = JSON.stringify(saved);
    const result = readRoomDraft(
      posted(saved.sequence, { AC: 'wrong' }),
      controls,
    );
    assert({
      given: 'an invalid duration',
      should:
        'refuse with the safe typed value while leaving saved data intact',
      actual: [
        result.ok,
        !result.ok && result.values['seconds.AC'],
        JSON.stringify(saved) === snapshot,
      ],
      expected: [false, 'wrong', true],
    });
  });
  test('refuses unsupported keys, repeated segments and producer-denied order', () => {
    const forms = [
      posted(['AC', 'unknown']),
      posted(['AC', 'NC', 'AC']),
      posted(['NC', 'AR']),
    ];
    assert({
      given: 'unknown, duplicate or producer-denied sequence',
      should: 'refuse all without making up grammar',
      actual: forms.map((form) => readRoomDraft(form, controls).ok),
      expected: [false, false, false],
    });
  });
  test('validates injected bounds and exact millisecond precision', () => {
    assert({
      given:
        'out-of-range, fractional-millisecond and valid half-second durations',
      should: 'accept only exact legal values',
      actual: ['0', '900', '30.0001', '90.5'].map(
        (AC) => readRoomDraft(posted(saved.sequence, { AC }), controls).ok,
      ),
      expected: [false, false, false, true],
    });
  });
  test('accepts reordered duration fields without inferring symmetry', () => {
    const result = readRoomDraft(posted(['NC', 'AC', 'AR']), controls);
    assert({
      given: 'a changed legal order',
      should: 'use the posted order',
      actual: result.ok && result.draft.sequence,
      expected: ['NC', 'AC', 'AR'],
    });
  });
  test('ignores authority claims and never retains unknown fields', () => {
    const form = posted();
    form.set('hostActorId', 'forged');
    form.set('token', 'private');
    const result = readRoomDraft(form, controls);
    assert({
      given: 'extra authority and secret fields',
      should: 'refuse and retain only declared duration fields',
      actual: result.ok
        ? null
        : [result.values['hostActorId'], result.values['token']],
      expected: [undefined, undefined],
    });
  });
  test('count and order changes use the injected sequence policy', () => {
    const added = changeRoomSequence(
      saved,
      { type: 'add', key: 'CX' },
      controls,
    );
    const moved = added.ok
      ? changeRoomSequence(
          added.draft,
          { type: 'earlier', key: 'CX' },
          controls,
        )
      : added;
    const removed = changeRoomSequence(
      saved,
      { type: 'remove', key: 'AR' },
      controls,
    );
    const refused = changeRoomSequence(
      saved,
      { type: 'remove', key: 'AC' },
      controls,
    );
    assert({
      given: 'add/reorder/remove intents and a required speech',
      should:
        'apply only producer-permitted changes without touching saved data',
      actual: [
        moved.ok && moved.draft.sequence,
        removed.ok && removed.draft.sequence,
        refused.ok,
        saved.sequence,
      ],
      expected: [
        ['AC', 'NC', 'CX', 'AR'],
        ['AC', 'NC'],
        false,
        ['AC', 'NC', 'AR'],
      ],
    });
  });
  test('a pinned sequence cannot be changed by a form intent', () => {
    assert({
      given: 'sequence customization disabled by the injected format',
      should: 'refuse structural edits',
      actual: changeRoomSequence(
        saved,
        { type: 'remove', key: 'AR' },
        { ...controls, canEditSequence: false },
      ).ok,
      expected: false,
    });
  });
});

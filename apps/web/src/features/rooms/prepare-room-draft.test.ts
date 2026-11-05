import { assert, setupRitewayBun, test } from 'riteway/bun';
import { unequalTemplate } from './assembly.test-support';
import { createRoomDraft } from './create-room-draft';
import { draftFormValues, readRoomDraft } from './create-room-fields';
import { prepareRoomDraft, changeDraftSchedule } from './prepare-room-draft';

setupRitewayBun();

test('native structural editing previews without creating a room', () => {
  const form = new FormData();
  Object.entries(draftFormValues(createRoomDraft(unequalTemplate))).forEach(
    ([key, value]) => form.set(key, value),
  );
  form.set('intent', 'add-affirmative');
  form.set('title', 'Retained title');
  const result = prepareRoomDraft(form, [unequalTemplate], []);
  assert({
    given: 'a native add-speech submission',
    should:
      'return a Custom preview with another speech and the room name retained',
    actual: result.kind === 'preview' && [
      result.values.segmentCount,
      result.values.format,
      result.values.title,
    ],
    expected: ['3', 'custom', 'Retained title'],
  });
});

test('Custom submission carries its basis and exact settings', () => {
  const form = new FormData();
  Object.entries(draftFormValues(createRoomDraft(unequalTemplate))).forEach(
    ([key, value]) => form.set(key, value),
  );
  form.set('customResolution', 'A host resolution');
  const result = prepareRoomDraft(form, [unequalTemplate], []);
  const selection =
    result.kind === 'submit'
      ? JSON.parse(String(result.form.get('selection')))
      : null;
  assert({
    given: 'a customized league-template draft',
    should: 'submit a private compiled definition with the template provenance',
    actual: selection && [
      selection.kind,
      selection.basis,
      selection.config.preRoundPrep,
    ],
    expected: [
      'custom',
      {
        formatId: unequalTemplate.formatId,
        formatVersion: unequalTemplate.formatVersion,
        presetVersion: unequalTemplate.preset.version,
      },
      unequalTemplate.preset.config.preRoundPrep,
    ],
  });
});

test('schedule additions stay valid through the maximum schedule', () => {
  let draft = createRoomDraft(unequalTemplate);
  for (let index = draft.definition.segments.length; index < 64; index += 1) {
    draft = changeDraftSchedule(
      draft,
      index % 2 ? 'add-negative' : 'add-affirmative',
    );
  }
  const result = readRoomDraft(draftFormValues(draft), [unequalTemplate]);
  assert({
    given: '64 speeches added through the editor',
    should: 'retain unique valid keys and round-trip the entire schedule',
    actual: [
      draft.definition.segments.length,
      new Set(draft.definition.segments.map((segment) => segment.key)).size,
      result.ok,
    ],
    expected: [64, 64, true],
  });
});

test('native Apply format restores the same standard after a Custom preview', () => {
  const value = {
    ...unequalTemplate,
    formatId: 'value',
    role: 'standard' as const,
  };
  const original = draftFormValues(createRoomDraft(value));
  const customize = new FormData();
  Object.entries({
    ...original,
    title: 'Keep my room',
    visibility: 'private',
    'duration.inRound': '0:00',
    intent: 'configure',
  }).forEach(([key, text]) => customize.set(key, text));
  const preview = prepareRoomDraft(customize, [value], []);
  const restore = new FormData();
  Object.entries({
    ...(preview.kind === 'preview' ? preview.values : {}),
    format: 'value',
    ranked: 'on',
    intent: 'format',
  }).forEach(([key, text]) => restore.set(key, text));
  const restored = prepareRoomDraft(restore, [value], []);
  assert({
    given:
      'a native Custom preview based on Value, then Apply format for Value again',
    should: 'restore the full preset, preserve metadata and leave Ranked off',
    actual: restored.kind === 'preview' && [
      restored.values.format,
      restored.values['duration.inRound'],
      restored.values.title,
      restored.values.visibility,
      restored.values.ranked,
    ],
    expected: [
      'value',
      original['duration.inRound'],
      'Keep my room',
      'private',
      '',
    ],
  });
});

test('creation never substitutes a publication that changed after the form was rendered', () => {
  const value = {
    ...unequalTemplate,
    formatId: 'value',
    role: 'standard' as const,
  };
  const form = new FormData();
  Object.entries(draftFormValues(createRoomDraft(value))).forEach(
    ([key, text]) => form.set(key, text),
  );
  form.set('valueResolutionId', 'o'.repeat(24));
  const result = prepareRoomDraft(
    form,
    [value],
    [
      {
        id: 'n'.repeat(24),
        kind: 'value',
        text: 'New published wording',
        provenance: 'Test',
        edition: null,
        theme: null,
        publishedAt: '2026-10-29T00:00:00.000Z',
      },
    ],
  );
  assert({
    given: 'the displayed Value publication retired before submission',
    should: 'refuse instead of silently creating with its replacement',
    actual: result.kind,
    expected: 'invalid',
  });
});

test('a ranked submission is always public', () => {
  const value = {
    ...unequalTemplate,
    formatId: 'value',
    role: 'standard' as const,
    preset: { ...unequalTemplate.preset, rankedEligible: true },
  };
  const form = new FormData();
  Object.entries({
    ...draftFormValues(createRoomDraft(value)),
    title: 'A ranked room',
    visibility: 'unlisted',
    ranked: 'on',
    noticeVersion: 'ranked-draft-2',
    valueResolutionId: 'published',
    intent: 'create',
  }).forEach(([key, text]) => form.set(key, text));
  const result = prepareRoomDraft(
    form,
    [value],
    [
      {
        id: 'published',
        kind: 'value',
        text: 'A published resolution',
        provenance: 'Test',
        edition: null,
        theme: null,
        publishedAt: '2026-10-29T00:00:00.000Z',
      },
    ],
  );
  assert({
    given: 'a ranked submission still carrying an unlisted choice',
    should: 'submit it as public',
    actual:
      result.kind === 'submit'
        ? [result.form.get('competition'), result.form.get('visibility')]
        : result,
    expected: ['ranked', 'public'],
  });
});

test('a ranked form that never showed the notice shows it before creating', () => {
  const template = {
    ...unequalTemplate,
    formatId: 'value',
    role: 'standard' as const,
    preset: { ...unequalTemplate.preset, rankedEligible: true },
  };
  const form = new FormData();
  for (const [key, value] of Object.entries({
    ...draftFormValues(createRoomDraft(template)),
    title: 'A ranked room',
    visibility: 'unlisted',
    ranked: 'on',
    intent: 'create',
  }))
    form.set(key, value);
  const prepared = prepareRoomDraft(form, [template], []);
  assert({
    given: 'Ranked ticked with no script, so no notice was on the page',
    should: 'answer the form again rather than create',
    actual: [
      prepared.kind,
      prepared.kind === 'preview' && prepared.values.ranked,
    ],
    expected: ['preview', 'on'],
  });
});

test('a native casual recording selection never claims an unseen capture notice', () => {
  const form = new FormData();
  Object.entries(draftFormValues(createRoomDraft(unequalTemplate))).forEach(
    ([key, value]) => form.set(key, value),
  );
  form.set('recording', 'on');
  form.set('title', 'Record this match');
  form.set('customResolution', 'A host resolution');
  const result = prepareRoomDraft(form, [unequalTemplate], []);
  assert({
    given: 'recording selected before its notice was shown',
    should: 'carry recording without synthesizing notice acknowledgement',
    actual: result.kind === 'submit' && [
      result.form.get('recording'),
      result.form.get('noticeVersion'),
    ],
    expected: ['on', null],
  });
});

test('native switching from a casual recording notice to Ranked previews its different notice', () => {
  const template = {
    ...unequalTemplate,
    formatId: 'value',
    role: 'standard' as const,
    preset: { ...unequalTemplate.preset, rankedEligible: true },
  };
  const form = new FormData();
  Object.entries(draftFormValues(createRoomDraft(template))).forEach(
    ([key, value]) => form.set(key, value),
  );
  form.set('ranked', 'on');
  form.set('noticeVersion', 'casual-draft-1');
  form.set('customResolution', 'A host resolution');
  assert({
    given:
      'Ranked selected on native HTML that showed the casual recording notice',
    should: 'render the ranked notice before creation',
    actual: prepareRoomDraft(form, [template], []).kind,
    expected: 'preview',
  });
});

import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { initialFormState } from '../../../features/forms/form-state';
import { roundCaptureNotice } from '../../../features/legal/agreements';
import { unequalTemplate } from '../../../features/rooms/assembly.test-support';

setupRitewayBun();
await mockNextRouter();
const { CreateRoomPage } = await import('./create-room-page');
const { CreateRoomEditor } = await import('./create-room-editor');

test('create page renders durable-create fields without a placeholder judge', () => {
  const html = renderToString(
    h(CreateRoomPage, {
      initialState: initialFormState,
      choices: [],
      commandId: 'n'.repeat(24),
    }),
  );
  assert({
    given: 'a catalog-backed create screen whose catalog is empty',
    should:
      'show one heading and a native form that refuses creation until formats exist',
    actual: [
      (html.match(/<h1 /g) ?? []).length,
      html.includes('<form'),
      ['title'].every((name) => html.includes(`name="${name}"`)),
      html.includes('No formats are available yet.'),
      html.includes('disabled=""'),
      html.includes('Placeholder AI judge'),
      html.includes('href="/lobby"'),
    ],
    expected: [1, true, true, true, true, false, true],
  });
});

test('the ranked create form explains why it is public and states the notice it shows', () => {
  const notice = roundCaptureNotice('ranked')!;
  const template = {
    ...unequalTemplate,
    formatId: 'value',
    role: 'standard' as const,
    preset: { ...unequalTemplate.preset, rankedEligible: true },
  };
  const render = (initialRanked: boolean) =>
    renderToString(
      h(CreateRoomEditor, {
        choices: [template],
        resolutions: [],
        initialChoice: template,
        values: {},
        commandId: 'n'.repeat(24),
        initialRanked,
        pending: false,
      }),
    ).replaceAll('&#x27;', "'");
  const ranked = render(true);
  const casual = render(false);
  assert({
    given: 'the form with Ranked on',
    should: 'say why it is public, show the exact notice and post its version',
    actual: [
      ranked.includes('Ranked Rounds are always public, and are broadcast'),
      ranked.includes(notice.text),
      /name="noticeVersion"[^>]*value="ranked-draft-2"/.test(ranked),
    ],
    expected: [true, true, true],
  });
  assert({
    given: 'the form with Ranked off',
    should: 'warn what choosing Ranked does, and state no notice',
    actual: [
      casual.includes('Choosing Ranked makes the Room public'),
      casual.includes('name="noticeVersion"'),
    ],
    expected: [true, false],
  });
});

test('recording is a visible casual choice and automatically on for Ranked', () => {
  const template = {
    ...unequalTemplate,
    role: 'standard' as const,
    preset: { ...unequalTemplate.preset, rankedEligible: true },
  };
  const render = (initialRanked: boolean, values = {}) =>
    renderToString(
      h(CreateRoomEditor, {
        choices: [template],
        resolutions: [],
        initialChoice: template,
        values,
        commandId: 'n'.repeat(24),
        initialRanked,
        pending: false,
      }),
    );
  const casual = render(false);
  const chosen = render(false, { recording: 'on' });
  const ranked = render(true);
  assert({
    given: 'casual defaults, a retained recording selection, and Ranked',
    should:
      'offer Record match, retain its selection, and show automatic ranked recording',
    actual: [
      casual.includes('Record match'),
      chosen.includes(
        roundCaptureNotice('opted-in')!.text.replaceAll("'", '&#x27;'),
      ),
      /name="noticeVersion"[^>]*value="casual-draft-1"/.test(chosen),
      casual.includes('name="noticeVersion"'),
      /name="recording"[^>]*checked=""/.test(casual),
      /name="recording"[^>]*checked=""/.test(chosen),
      ranked.includes('Recording is on for ranked matches.'),
      ['disabled=""', 'checked=""'].every((attribute) =>
        (ranked.match(/<input[^>]*name="recording"[^>]*>/)?.[0] ?? '').includes(
          attribute,
        ),
      ),
    ],
    expected: [true, true, true, false, false, true, true, true],
  });
});

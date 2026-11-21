import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { idle } from '../../../features/forms/form-state';
import { casualCaptureNotice } from '../../../features/legal/agreements';
import {
  freestyleChoice,
  unequalTemplate,
} from '../../../features/rooms/assembly.test-support';
import { noLadderReason } from '../../../features/play/ladder-division-words';

setupRitewayBun();
await mockNextRouter();
const { CreateRoomPage } = await import('./create-room-page');
const { CreateRoomEditor } = await import('./create-room-editor');

test('create page renders durable-create fields without a placeholder judge', () => {
  const html = renderToString(
    h(CreateRoomPage, {
      initialState: idle(),
      choices: [],
      commandId: 'n'.repeat(24),
      memberDivision: 'open',
      lobbyChoice: null,
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

test('the ranked create form explains why it is public and states no notice', () => {
  const template = {
    ...unequalTemplate,
    formatId: 'freestyle',
    role: 'standard' as const,
    preset: { ...unequalTemplate.preset, rankedEligible: true },
  };
  const render = (initialRanked: boolean) =>
    renderToString(
      h(CreateRoomEditor, {
        choices: [template],
        initialChoice: template,
        values: {},
        commandId: 'n'.repeat(24),
        memberDivision: 'open',
        lobbyChoice: null,
        initialRanked,
        pending: false,
      }),
    ).replaceAll('&#x27;', "'");
  const ranked = render(true);
  const casual = render(false);
  assert({
    given: 'the form with Ranked on',
    should: 'say why it is public, and show and post no capture notice',
    actual: [
      ranked.includes(
        'Listed in the lobby. Play casual to choose who can join.',
      ),
      ranked.includes(casualCaptureNotice.text),
      ranked.includes('name="noticeVersion"'),
    ],
    expected: [true, false, false],
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

test('a member with no ladder sees why instead of Ranked', () => {
  const template = {
    ...unequalTemplate,
    formatId: 'freestyle',
    role: 'standard' as const,
    preset: { ...unequalTemplate.preset, rankedEligible: true },
  };
  const html = renderToString(
    h(CreateRoomEditor, {
      choices: [template],
      initialChoice: template,
      values: {},
      commandId: 'n'.repeat(24),
      // Arrived from Create a ranked room, which they are not shown.
      initialRanked: true,
      memberDivision: null,
      lobbyChoice: null,
      pending: false,
    }),
  ).replaceAll('&#x27;', "'");
  assert({
    given: 'a member with no age on record on a ranked-eligible format',
    should:
      'offer no Ranked control, say why in plain words and keep the casual choices',
    actual: [
      html.includes('name="ranked"'),
      html.includes(noLadderReason),
      html.includes('Choosing Ranked makes the Room public'),
      html.includes('The ladder is set by who sits down.'),
    ],
    expected: [false, true, true, false],
  });
});

test('Ranked is open to either lobby and names no division (YCreateRoom)', () => {
  const template = {
    ...freestyleChoice,
    preset: { ...freestyleChoice.preset, rankedEligible: true },
  };
  const render = (
    memberDivision: 'open' | 'youth',
    lobbyChoice: Parameters<typeof CreateRoomEditor>[0]['lobbyChoice'],
  ) =>
    renderToString(
      h(CreateRoomEditor, {
        choices: [template],
        initialChoice: template,
        values: {},
        commandId: 'n'.repeat(24),
        memberDivision,
        lobbyChoice,
        initialRanked: true,
        pending: false,
      }),
    ).replaceAll('&#x27;', "'");
  const youth = render('youth', null);
  const adult = render('open', null);
  const openLobby = 'o'.repeat(24);
  const staff = render('open', {
    choices: [
      { id: openLobby, name: 'Open', ageRule: 'adults' },
      { id: 'y'.repeat(24), name: 'Youth', ageRule: 'under-18' },
    ],
    defaultId: openLobby,
  });
  const box = (html: string) =>
    /<input[^>]*name="ranked"[^>]*>/.exec(html)?.[0] ?? '';
  assert({
    given: 'a youth member and an adult with Ranked on, and club staff',
    should:
      'let both choose Ranked with no ladder note or division, and show the Lobby choice to staff only',
    actual: [
      box(youth).includes('checked=""') && !box(youth).includes('disabled'),
      box(adult).includes('checked=""') && !box(adult).includes('disabled'),
      [youth, adult].some(
        (html) =>
          html.includes('Youth') ||
          html.includes('Open or') ||
          html.includes('ladder') ||
          html.includes('18'),
      ),
      youth.includes('role="radiogroup" aria-label="Lobby"'),
      staff.includes('role="radiogroup" aria-label="Lobby"'),
      staff.includes(
        `<input type="radio" name="lobby" checked="" value="${openLobby}"/>`,
      ),
      staff.includes('>Youth</strong>'),
    ],
    expected: [true, true, false, false, true, true, true],
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
        initialChoice: template,
        values,
        commandId: 'n'.repeat(24),
        memberDivision: 'open',
        lobbyChoice: null,
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
      chosen.includes(casualCaptureNotice.text.replaceAll("'", '&#x27;')),
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

test('post-round feedback is a casual choice that Ranked switches off', () => {
  const template = {
    ...unequalTemplate,
    role: 'standard' as const,
    preset: { ...unequalTemplate.preset, rankedEligible: true },
  };
  const box = (initialRanked: boolean, values = {}) =>
    renderToString(
      h(CreateRoomEditor, {
        choices: [template],
        initialChoice: template,
        values,
        commandId: 'n'.repeat(24),
        memberDivision: 'open',
        lobbyChoice: null,
        initialRanked,
        pending: false,
      }),
    ).match(/<input[^>]*name="postRoundCall"[^>]*>/)?.[0] ?? '';
  const has = (input: string, attribute: string) => input.includes(attribute);
  const casual = box(false);
  const chosen = box(false, { postRoundCall: 'on' });
  const ranked = box(true, { postRoundCall: 'on', ranked: 'on' });
  assert({
    given: 'casual defaults, a retained choice, and Ranked with that choice',
    should:
      'offer the box unticked, keep a tick, and untick and disable it for Ranked',
    actual: [
      [has(casual, 'checked=""'), has(casual, 'disabled=""')],
      [has(chosen, 'checked=""'), has(chosen, 'disabled=""')],
      [has(ranked, 'checked=""'), has(ranked, 'disabled=""')],
    ],
    expected: [
      [false, false],
      [true, false],
      [false, true],
    ],
  });
});

test('a casual Room is public unless its host chooses otherwise', () => {
  const render = (values: Readonly<Record<string, string>>) =>
    renderToString(
      h(CreateRoomEditor, {
        choices: [unequalTemplate],
        initialChoice: unequalTemplate,
        values,
        commandId: 'n'.repeat(24),
        memberDivision: 'open',
        lobbyChoice: null,
        initialRanked: false,
        pending: false,
      }),
    );
  const options = (html: string) =>
    [
      ...(
        html.match(/<select[^>]*name="visibility"[^>]*>.*?<\/select>/)?.[0] ??
        ''
      ).matchAll(/<option value="(\w+)"( selected="")?/g),
    ].map(([, value, selected]) => `${value}${selected ? '*' : ''}`);
  assert({
    given: 'a fresh casual create form, then one the host set to unlisted',
    should:
      'list public first and select it by default, and keep the host’s explicit unlisted choice',
    actual: [options(render({})), options(render({ visibility: 'unlisted' }))],
    expected: [
      ['public*', 'unlisted'],
      ['public', 'unlisted*'],
    ],
  });
});

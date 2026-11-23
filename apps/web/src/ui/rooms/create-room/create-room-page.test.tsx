import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { idle } from '../../../features/forms/form-state';
import { casualCaptureNotice } from '../../../features/legal/agreements';
import {
  freestyleChoice,
  unequalTemplate,
} from '../../../features/rooms/assembly.test-support';
import { noLadderReason } from '../../../features/play/ladder-division-words';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';

setupRitewayBun();

/**
 * The named fields the output posts, hidden ones included (a hidden input
 * has no role): everything in the anchor's form, or in the whole output when
 * the anchor sits outside a form.
 */
const posted = (anchor: Element) => {
  let root: Element = anchor;
  while (root.parentElement && root.parentElement.tagName !== 'BODY')
    root = root.parentElement;
  const scope = (anchor as HTMLButtonElement).form ?? root;
  return Object.fromEntries(
    [...scope.querySelectorAll('input[name]')].map((input) => [
      (input as HTMLInputElement).name,
      (input as HTMLInputElement).value,
    ]),
  );
};
// Each render replaces the last one's output, so a test reads what it needs
// from a view before it renders the next.
const box = (view: AccessibleView, name: string) => {
  const input = view.get('checkbox', name) as HTMLInputElement;
  return { checked: input.checked, disabled: input.disabled };
};
await mockNextRouter();
const { CreateRoomPage } = await import('./create-room-page');
const { CreateRoomEditor } = await import('./create-room-editor');

test('create page renders durable-create fields without a placeholder judge', () => {
  const view = renderAccessible(
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
      view.count('heading', undefined, { level: 1 }),
      view.has('form', 'Create a room'),
      view.attribute('textbox', 'Room name', 'name'),
      view.textContent().includes('No formats are available yet.'),
      view.get('button', 'Create room').hasAttribute('disabled'),
      view.textContent().includes('Placeholder AI judge'),
      view.attribute('link', 'Browse open rooms', 'href'),
    ],
    expected: [1, true, 'title', true, true, false, '/lobby'],
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
    renderAccessible(
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
    );
  const rankedView = render(true);
  const ranked = {
    text: rankedView.textContent(),
    posted: posted(rankedView.get('button', 'Create room')),
  };
  const casualView = render(false);
  const casual = {
    text: casualView.textContent(),
    posted: posted(casualView.get('button', 'Create room')),
  };
  assert({
    given: 'the form with Ranked on',
    should: 'say why it is public, and show and post no capture notice',
    actual: [
      ranked.text.includes(
        'Listed in the lobby. Play casual to choose who can join.',
      ),
      ranked.text.includes(casualCaptureNotice.text),
      'noticeVersion' in ranked.posted,
    ],
    expected: [true, false, false],
  });
  assert({
    given: 'the form with Ranked off',
    should: 'warn what choosing Ranked does, and state no notice',
    actual: [
      casual.text.includes('Choosing Ranked makes the Room public'),
      'noticeVersion' in casual.posted,
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
  const view = renderAccessible(
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
  );
  const text = view.textContent();
  assert({
    given: 'a member with no age on record on a ranked-eligible format',
    should:
      'offer no Ranked control, say why in plain words and keep the casual choices',
    actual: [
      view.has('checkbox', 'Ranked', { hidden: true }) ||
        'ranked' in posted(view.get('button', 'Create room')),
      text.includes(noLadderReason),
      text.includes('Choosing Ranked makes the Room public'),
      text.includes('The ladder is set by who sits down.'),
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
  ) => {
    const view = renderAccessible(
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
    );
    const lobby = view.has('radiogroup', 'Lobby', { hidden: true })
      ? view.within('radiogroup', 'Lobby')
      : null;
    return {
      ranked: box(view, 'Ranked'),
      text: view.textContent(),
      lobby: lobby !== null,
      lobbyChecked: lobby?.attribute('radio', 'Open', 'value', {
        checked: true,
      }),
      youthUnchecked: lobby?.has('radio', 'Youth', { checked: false }),
    };
  };
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
  assert({
    given: 'a youth member and an adult with Ranked on, and club staff',
    should:
      'let both choose Ranked with no ladder note or division, and show the Lobby choice to staff only',
    actual: [
      youth.ranked,
      adult.ranked,
      [youth, adult].some(
        ({ text }) =>
          text.includes('Youth') ||
          text.includes('Open or') ||
          text.includes('ladder') ||
          text.includes('18'),
      ),
      youth.lobby,
      staff.lobby,
      staff.lobbyChecked,
      staff.youthUnchecked,
    ],
    expected: [
      { checked: true, disabled: false },
      { checked: true, disabled: false },
      false,
      false,
      true,
      openLobby,
      true,
    ],
  });
});

test('recording is a visible casual choice and automatically on for Ranked', () => {
  const template = {
    ...unequalTemplate,
    role: 'standard' as const,
    preset: { ...unequalTemplate.preset, rankedEligible: true },
  };
  const render = (initialRanked: boolean, values = {}) => {
    const view = renderAccessible(
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
    return {
      offered: view.has('checkbox', 'Record match'),
      recording: box(view, 'Record match'),
      text: view.textContent(),
      posted: posted(view.get('button', 'Create room')),
    };
  };
  const casual = render(false);
  const chosen = render(false, { recording: 'on' });
  const ranked = render(true);
  assert({
    given: 'casual defaults, a retained recording selection, and Ranked',
    should:
      'offer Record match, retain its selection, and show automatic ranked recording',
    actual: [
      casual.offered,
      chosen.text.includes(casualCaptureNotice.text),
      chosen.posted['noticeVersion'],
      'noticeVersion' in casual.posted,
      casual.recording.checked,
      chosen.recording.checked,
      ranked.text.includes('Recording is on for ranked matches.'),
      ranked.recording,
    ],
    expected: [
      true,
      true,
      'casual-draft-1',
      false,
      false,
      true,
      true,
      { checked: true, disabled: true },
    ],
  });
});

test('post-round feedback is a casual choice that Ranked switches off', () => {
  const template = {
    ...unequalTemplate,
    role: 'standard' as const,
    preset: { ...unequalTemplate.preset, rankedEligible: true },
  };
  const feedback = (initialRanked: boolean, values = {}) =>
    box(
      renderAccessible(
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
      ),
      'Post-round feedback',
    );
  const casual = feedback(false);
  const chosen = feedback(false, { postRoundCall: 'on' });
  const ranked = feedback(true, { postRoundCall: 'on', ranked: 'on' });
  assert({
    given: 'casual defaults, a retained choice, and Ranked with that choice',
    should:
      'offer the box unticked, keep a tick, and untick and disable it for Ranked',
    actual: [casual, chosen, ranked],
    expected: [
      { checked: false, disabled: false },
      { checked: true, disabled: false },
      { checked: false, disabled: true },
    ],
  });
});

test('a casual Room is public unless its host chooses otherwise', () => {
  const render = (values: Readonly<Record<string, string>>) =>
    options(
      renderAccessible(
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
      ),
    );
  function options(view: AccessibleView) {
    return view
      .within('combobox', /^Who can join/)
      .all('option')
      .map((option) => {
        const { value, selected } = option as HTMLOptionElement;
        return `${value}${selected ? '*' : ''}`;
      });
  }
  assert({
    given: 'a fresh casual create form, then one the host set to unlisted',
    should:
      'list public first and select it by default, and keep the host’s explicit unlisted choice',
    actual: [render({}), render({ visibility: 'unlisted' })],
    expected: [
      ['public*', 'unlisted'],
      ['public', 'unlisted*'],
    ],
  });
});

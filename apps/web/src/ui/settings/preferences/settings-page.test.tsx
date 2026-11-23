import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { ThemeProvider } from '../../theme/theme-provider';

setupRitewayBun();

// The forms read the Next router, which only exists in a running app.
await mockNextRouter();
const { SettingsPage } = await import('./settings-page');

const controlRoles = ['button', 'checkbox', 'radio', 'textbox', 'combobox'];
const controls = (view: AccessibleView) =>
  controlRoles.flatMap((role) => view.all(role));
/** The `name` every control posts under. */
const fieldNames = (view: AccessibleView) =>
  controls(view).map((control) => control.getAttribute('name'));
/** The forms a member can submit: every form that holds a control. */
const forms = (view: AccessibleView) => [
  ...new Set(
    controls(view)
      .map((control) => control.closest('form'))
      .filter((form) => form !== null),
  ),
];
const hrefs = (view: AccessibleView) =>
  view.all('link').map((link) => link.getAttribute('href') ?? '');

const render = (
  username: string | null,
  onboarding: Parameters<typeof SettingsPage>[0]['onboarding'] = null,
  dataRightsNotices: Parameters<typeof SettingsPage>[0]['dataRightsNotices'] = {
    exportData: null,
    erase: null,
  },
  available: { analytics: boolean; replay: boolean } = {
    analytics: true,
    replay: false,
  },
) =>
  renderAccessible(
    h(ThemeProvider, {
      initialPreference: 'system',
      children: h(SettingsPage, {
        username,
        dataRightsNotices,
        analytics: {
          choice: {
            kind: 'known',
            consent: {
              version: 1,
              necessary: 'granted',
              analytics: 'unanswered',
              replay: 'unanswered',
            },
          },
          available,
        },
        onboarding,
      }),
    }),
  );

describe('SettingsPage', () => {
  test('a deploy with no consent choice', () => {
    const sentence = 'Not answering counts as no.';
    assert({
      given: 'a deploy offering a choice, then one offering none',
      should: 'say what not answering means only beside a choice',
      actual: [
        render('debater-a').textContent().includes(sentence),
        render('debater-a', null, undefined, {
          analytics: false,
          replay: false,
        })
          .textContent()
          .includes(sentence),
      ],
      expected: [true, false],
    });
  });

  test('a member', () => {
    const view = render('debater-a');
    const actions = forms(view).map((form) => form.getAttribute('action'));
    assert({
      given: 'a signed-in member',
      should:
        'show one h1, the four sections, three real forms and a link to their profile',
      actual: [
        view.count('heading', undefined, { level: 1 }),
        view.all('region').filter((section) => section.id !== '').length,
        forms(view).length,
        hrefs(view).includes('/profile/debater-a'),
        hrefs(view).includes('/settings/security'),
        // ISSUE-833: the data-rights forms post natively, before hydration.
        [
          actions.includes('/api/privacy/export'),
          actions.includes('/api/privacy/erase'),
          fieldNames(view).includes('confirm'),
        ],
      ],
      expected: [1, 4, 3, true, true, [true, true, true]],
    });
  });

  test('the data-rights notices are fixed sentences', () => {
    const view = render('debater-a', null, {
      exportData: 'rate-limited',
      erase: 'confirm',
    });
    const text = view.textContent();
    assert({
      given: 'the export and erase handlers fixed notice keys in the URL',
      should: 'render their fixed sentences once each and never the URL values',
      actual: [
        text.split('Too many export requests. Try again later.').length - 1,
        text.split('Tick the box to confirm you want your account closed.')
          .length - 1,
        text.includes('rate-limited') ||
          hrefs(view).some((href) => href.includes('rate-limited')),
      ],
      expected: [1, 1, false],
    });
  });

  test('consent starts off', () => {
    const view = render('debater-a');
    const analytics = view
      .all('checkbox')
      .filter((box) => box.getAttribute('name') === 'analytics');
    assert({
      given: 'a new account’s privacy settings',
      should:
        'leave analytics unticked, hide unavailable replay and explain necessary storage',
      actual: [
        analytics.map((box) => box.hasAttribute('checked')),
        fieldNames(view).includes('replay'),
        view.textContent().includes('Necessary storage always stays on.'),
      ],
      expected: [[false], false, true],
    });
  });

  test('nothing claims to be saved without a write', () => {
    const view = render('debater-a');
    assert({
      given: 'Settings with no stored profile or email preferences',
      should: 'offer no form that discards its post and no saved notice',
      actual: [
        fieldNames(view).includes('bio'),
        fieldNames(view).includes('newsletter'),
        view.textContent().includes('saved.'),
      ],
      expected: [false, false, false],
    });
  });

  test('the profile section', () => {
    const view = renderAccessible(
      h(ThemeProvider, {
        initialPreference: 'system',
        children: h(SettingsPage, {
          username: 'debater-a',
          dataRightsNotices: { exportData: null, erase: null },
          analytics: {
            choice: { kind: 'unreadable' },
            available: { analytics: false, replay: false },
          },
          onboarding: null,
          publicProfile: h('p', null, 'PUBLIC-PROFILE'),
          status: h('p', null, 'STATUS-FORM'),
        }),
      }),
    );
    const profile = view.within('region', 'Profile');
    assert({
      given: 'a member’s display name, bio, photo and status controls',
      should:
        'show them in the Profile section beside the username, which stays a link and not a field',
      actual: [
        hrefs(profile).includes('/profile/debater-a'),
        profile.textContent().includes('PUBLIC-PROFILE'),
        profile.has('heading', 'Status', { level: 3 }),
        profile.textContent().includes('STATUS-FORM'),
        fieldNames(view).includes('username'),
      ],
      expected: [true, true, true, true, false],
    });
  });

  test('an account with no username yet', () => {
    const view = render(null);
    assert({
      given: 'an account still choosing a username',
      should: 'offer to choose one instead of a profile link',
      actual: [
        hrefs(view).includes('/onboarding/username'),
        hrefs(view).some((href) => href.startsWith('/profile/')),
      ],
      expected: [true, false],
    });
  });

  test('no sample account actions', () => {
    const view = render('debater-a');
    assert({
      given: 'the settings page while export and deletion have no backend',
      should: 'offer neither Export my data nor Delete my account',
      actual: [
        view.textContent().includes('Export my data'),
        view.textContent().includes('Delete my account'),
        [
          ...hrefs(view),
          ...forms(view).map((form) => form.getAttribute('action') ?? ''),
        ].some((target) => target.includes('?did=')),
      ],
      expected: [false, false, false],
    });
  });
});

describe('onboarding answers in Settings (ISSUE-324)', () => {
  test('a 13+ member sees each answer with a link to change it', () => {
    const answers = {
      wants: ['debate' as const],
      club: null,
      clubName: null,
      experience: null,
      leagues: [],
      topics: [],
      completedAt: '2026-10-01T00:00:00.000Z',
    };
    const editHrefs = {
      about: '/onboarding/about?next=%2Fsettings',
      experience: '/onboarding/experience?next=%2Fsettings',
      topics: '/onboarding/topics?next=%2Fsettings',
    };
    const shown = render('ada', { answers, editHrefs });
    const hidden = render('ada');
    assert({
      given:
        'a member whose optional answers are admitted, and one whose are not',
      should:
        'list the answers with plain Edit links that return to Settings, and show no answers at all otherwise',
      actual: [
        shown.textContent().includes('Your onboarding answers'),
        hrefs(shown).includes('/onboarding/about?next=%2Fsettings'),
        hrefs(shown).includes('/onboarding/experience?next=%2Fsettings'),
        hrefs(shown).includes('/onboarding/topics?next=%2Fsettings'),
        hidden.textContent().includes('Your onboarding answers'),
        hrefs(hidden).some((href) => href.includes('/onboarding/about')),
      ],
      expected: [true, true, true, true, false, false],
    });
  });
});

test('ranked standings have no unsupported privacy switch', () => {
  const view = render('debater-a');
  assert({
    given: 'Settings while ranked standings have no persisted opt-out',
    should: 'offer no ladder visibility toggle or private-debater promise',
    actual: [
      fieldNames(view).includes('ladder'),
      view.textContent().includes('private debater'),
    ],
    expected: [false, false],
  });
});

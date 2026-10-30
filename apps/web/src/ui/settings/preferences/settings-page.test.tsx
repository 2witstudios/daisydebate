import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { initialFormState } from '../../../features/forms/form-state';
import { getPreferences } from '../../../features/settings/preferences';
import { ThemeProvider } from '../../theme/theme-provider';

setupRitewayBun();

// The forms read the Next router, which only exists in a running app.
await mockNextRouter();
const { SettingsPage } = await import('./settings-page');

const action = async () => initialFormState;
const render = (
  username: string | null,
  saved: 'profile' | 'notifications' | null = null,
  onboarding: Parameters<typeof SettingsPage>[0]['onboarding'] = null,
  dataRightsNotices: Parameters<typeof SettingsPage>[0]['dataRightsNotices'] = {
    exportData: null,
    erase: null,
  },
) =>
  renderToString(
    h(ThemeProvider, {
      initialPreference: 'system',
      children: h(SettingsPage, {
        username,
        preferences: getPreferences(),
        saved,
        dataRightsNotices,
        profileAction: action,
        notificationsAction: action,
        analytics: {
          consent: {
            version: 1,
            necessary: 'granted',
            analytics: 'unanswered',
            replay: 'unanswered',
          },
          available: { analytics: true, replay: false },
        },
        onboarding,
      }),
    }),
  );

describe('SettingsPage', () => {
  test('a member', () => {
    const html = render('debater-a');
    assert({
      given: 'a signed-in member',
      should:
        'show one h1, the five sections, five real forms and a link to their profile',
      actual: [
        html.match(/<h1 /g)?.length,
        html.match(/<section id=/g)?.length,
        html.match(/<form /g)?.length,
        html.includes('href="/profile/debater-a"'),
        html.includes('href="/settings/security"'),
        // ISSUE-833: the data-rights forms post natively, without script.
        [
          html.includes('action="/api/privacy/export"'),
          html.includes('action="/api/privacy/erase"'),
          html.includes('name="confirm"'),
        ],
      ],
      expected: [1, 5, 5, true, true, [true, true, true]],
    });
  });

  test('the data-rights notices are fixed sentences', () => {
    const html = render('debater-a', null, null, {
      exportData: 'rate-limited',
      erase: 'confirm',
    });
    assert({
      given: 'the export and erase handlers fixed notice keys in the URL',
      should: 'render their fixed sentences once each and never the URL values',
      actual: [
        html.includes('Too many export requests. Try again later.'),
        html.includes('Tick the box to confirm you want your account closed.'),
        html.includes('rate-limited'),
      ],
      expected: [true, true, false],
    });
  });

  test('consent starts off', () => {
    const html = render('debater-a');
    assert({
      given: 'a new account’s privacy settings',
      should:
        'leave analytics unticked, hide unavailable replay and explain necessary storage',
      actual: [
        /name="analytics"[^>]*checked=""|checked=""[^>]*name="analytics"/.test(
          html,
        ),
        html.includes('name="replay"'),
        html.includes('Necessary storage always stays on.'),
      ],
      expected: [false, false, true],
    });
  });

  test('a saved section', () => {
    const html = render('debater-a', 'profile');
    assert({
      given: 'a profile form that was just saved',
      should: 'confirm it as a status',
      actual: [html.includes('Profile saved.'), html.includes('role="status"')],
      expected: [true, true],
    });
  });

  test('an account with no username yet', () => {
    const html = render(null);
    assert({
      given: 'an account still choosing a username',
      should: 'offer to choose one instead of a profile link',
      actual: [
        html.includes('href="/onboarding/username"'),
        html.includes('href="/profile/'),
      ],
      expected: [true, false],
    });
  });

  test('no sample account actions', () => {
    const html = render('debater-a');
    assert({
      given: 'the settings page while export and deletion have no backend',
      should: 'offer neither Export my data nor Delete my account',
      actual: [
        html.includes('Export my data'),
        html.includes('Delete my account'),
        html.includes('?did='),
      ],
      expected: [false, false, false],
    });
  });
});

describe('onboarding answers in Settings (ISSUE-324)', () => {
  test('a 16+ member sees each answer with a link to change it', () => {
    const answers = {
      wants: ['debate' as const],
      club: null,
      experience: null,
      formats: [],
      topics: [],
      completedAt: '2026-10-01T00:00:00.000Z',
    };
    const editHrefs = {
      about: '/onboarding/about?next=%2Fsettings',
      experience: '/onboarding/experience?next=%2Fsettings',
      topics: '/onboarding/topics?next=%2Fsettings',
    };
    const shown = render('ada', null, { answers, editHrefs });
    const hidden = render('ada');
    assert({
      given:
        'a member whose optional answers are admitted, and one whose are not',
      should:
        'list the answers with plain Edit links that return to Settings, and show no answers at all otherwise',
      actual: [
        shown.includes('Your onboarding answers'),
        shown.includes('href="/onboarding/about?next=%2Fsettings"'),
        shown.includes('href="/onboarding/experience?next=%2Fsettings"'),
        shown.includes('href="/onboarding/topics?next=%2Fsettings"'),
        hidden.includes('Your onboarding answers'),
        hidden.includes('/onboarding/about'),
      ],
      expected: [true, true, true, true, false, false],
    });
  });
});

test('rated standings have no unsupported privacy switch', () => {
  const html = render('debater-a');
  assert({
    given: 'Settings while rated standings have no persisted opt-out',
    should: 'offer no ladder visibility toggle or private-debater promise',
    actual: [html.includes('name="ladder"'), html.includes('private debater')],
    expected: [false, false],
  });
});

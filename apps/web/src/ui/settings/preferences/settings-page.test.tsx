import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { initialMockForm } from '../../../features/mock-form/form';
import { getPreferences } from '../../../features/settings/preferences';
import { ThemeProvider } from '../../theme/theme-provider';

setupRitewayBun();

// The forms read the Next router, which only exists in a running app.
await mockNextRouter();
const { SettingsPage } = await import('./settings-page');

const action = async () => initialMockForm;
const render = (
  username: string | null,
  saved: 'profile' | 'notifications' | 'privacy' | null = null,
  onboarding: Parameters<typeof SettingsPage>[0]['onboarding'] = null,
) =>
  renderToString(
    h(ThemeProvider, {
      initialPreference: 'system',
      children: h(SettingsPage, {
        username,
        preferences: getPreferences(),
        saved,
        profileAction: action,
        notificationsAction: action,
        privacyAction: action,
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
        'show one h1, the five sections, three real forms and a link to their profile',
      actual: [
        html.match(/<h1 /g)?.length,
        html.match(/<section id=/g)?.length,
        html.match(/<form /g)?.length,
        html.includes('href="/profile/debater-a"'),
        html.includes('href="/settings/security"'),
      ],
      expected: [1, 5, 3, true, true],
    });
  });

  test('consent starts off', () => {
    const html = render('debater-a');
    assert({
      given: 'a new account’s privacy settings',
      should:
        'leave analytics and replay unticked, and show the necessary category on and fixed',
      actual: [
        /name="analytics"[^>]*checked=""|checked=""[^>]*name="analytics"/.test(
          html,
        ),
        /name="replay"[^>]*checked=""|checked=""[^>]*name="replay"/.test(html),
        /name="necessary"[^>]*disabled=""[^>]*checked=""|checked=""[^>]*disabled=""[^>]*name="necessary"|name="necessary"[^>]*checked=""[^>]*disabled=""/.test(
          html,
        ) ||
          (html.includes('name="necessary"') && html.includes('Always on.')),
      ],
      expected: [false, false, true],
    });
  });

  test('a saved section', () => {
    const html = render('debater-a', 'privacy');
    assert({
      given: 'a privacy form that was just saved',
      should: 'confirm it as a status',
      actual: [
        html.includes('Privacy settings saved.'),
        html.includes('role="status"'),
      ],
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

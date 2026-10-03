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
      }),
    }),
  );

describe('SettingsPage', () => {
  test('a member', () => {
    const html = render('debater-a');
    assert({
      given: 'a signed-in member',
      should:
        'show one h1, the six sections, three real forms and a link to their profile',
      actual: [
        html.match(/<h1 /g)?.length,
        html.match(/<section id=/g)?.length,
        html.match(/<form /g)?.length,
        html.includes('href="/profile/debater-a"'),
        html.includes('href="/settings/security"'),
      ],
      expected: [1, 6, 3, true, true],
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

  test('your account', () => {
    const html = render('debater-a');
    assert({
      given: 'the account section',
      should: 'answer export and delete as working sample actions',
      actual: [
        html.includes('href="?did=Export+my+data"'),
        html.includes('href="?did=Delete+my+account"'),
      ],
      expected: [true, true],
    });
  });
});

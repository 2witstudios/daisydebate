import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { postedForm } from '../../lib/testing/posted-form';
import {
  bioLimit,
  getPreferences,
  parseNotificationsForm,
  parsePrivacyForm,
  parseProfileForm,
  parseSettingsQuery,
  savedHref,
} from './preferences';

setupRitewayBun();

describe('parseProfileForm', () => {
  test('a bio and a region', () => {
    assert({
      given: 'a short bio and a listed region',
      should: 'accept both',
      actual: parseProfileForm(
        postedForm({ bio: 'I like policy debate.', region: 'Europe' }),
      ),
      expected: {
        ok: true,
        value: { bio: 'I like policy debate.', region: 'Europe' },
      },
    });
  });

  test('blank is fine', () => {
    assert({
      given: 'no bio and no region',
      should: 'accept empty values',
      actual: parseProfileForm(postedForm({})),
      expected: { ok: true, value: { bio: '', region: '' } },
    });
  });

  test('refusals', () => {
    assert({
      given: 'a bio over the limit and a region not on the list',
      should: 'refuse each with its own message',
      actual: [
        parseProfileForm(postedForm({ bio: 'x'.repeat(bioLimit + 1) })),
        parseProfileForm(postedForm({ region: 'Atlantis' })),
      ],
      expected: [
        { ok: false, error: `A bio is up to ${bioLimit} characters.` },
        {
          ok: false,
          error: 'Choose a region from the list, or leave it blank.',
        },
      ],
    });
  });
});

describe('checkbox forms', () => {
  test('notifications', () => {
    assert({
      given: 'two boxes ticked and two not',
      should: 'read ticked as on and absent as off',
      actual: parseNotificationsForm(
        postedForm({ 'judge-offers': 'on', newsletter: 'on' }),
      ),
      expected: {
        ok: true,
        value: {
          judgeOffers: true,
          pairings: false,
          results: false,
          newsletter: true,
        },
      },
    });
  });

  test('privacy', () => {
    assert({
      given: 'nothing ticked',
      should: 'turn everything off, since not answering is declining',
      actual: parsePrivacyForm(postedForm({})),
      expected: {
        ok: true,
        value: {
          ladder: false,
          analytics: false,
          replay: false,
        },
      },
    });
  });
});

describe('defaults and the saved notice', () => {
  test('optional consent starts off', () => {
    assert({
      given: 'a new account',
      should: 'start with analytics and replay off',
      actual: [
        getPreferences().privacy.analytics,
        getPreferences().privacy.replay,
      ],
      expected: [false, false],
    });
  });

  test('the saved section', () => {
    assert({
      given: 'a saved section, nothing and nonsense',
      should: 'read the section or none',
      actual: [
        parseSettingsQuery({ saved: 'privacy' }),
        parseSettingsQuery({}),
        parseSettingsQuery({ saved: 'billing' }),
        savedHref('profile'),
      ],
      expected: ['privacy', null, null, '/settings?saved=profile#profile'],
    });
  });
});

import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  characterCount,
  profileTextRefusalOf,
  profileTextRefused,
} from './profile-text-form';

setupRitewayBun();

describe('profileTextRefusalOf', () => {
  test('each refused status', () => {
    assert({
      given: 'a refused value, a rate limit, a restriction and an outage',
      should: 'name each refusal',
      actual: [400, 429, 403, 503].map(profileTextRefusalOf),
      expected: ['too-long', 'rate-limited', 'not-allowed', 'unavailable'],
    });
  });
});

describe('profileTextRefused', () => {
  test('the typed text comes back', () => {
    const form = new FormData();
    form.set('displayName', 'Ada');
    form.set('bio', 'Long bio');
    assert({
      given: 'a refused save',
      should: 'keep what was typed beside the refusal',
      actual: profileTextRefused(form, 'too-long'),
      expected: {
        kind: 'refused',
        values: { displayName: 'Ada', bio: 'Long bio' },
        error: 'A display name is at most 40 characters and a bio at most 160.',
      },
    });
  });
});

describe('characterCount', () => {
  test('code points, not UTF-16 units', () => {
    assert({
      given: 'plain text and an emoji outside the basic plane',
      should: 'count what a person sees',
      actual: [characterCount('Ada'), characterCount('🌼')],
      expected: [3, 1],
    });
  });
});

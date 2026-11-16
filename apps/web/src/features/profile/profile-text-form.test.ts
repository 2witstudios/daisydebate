import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  characterCount,
  profileTextRefusalOf,
  profileTextRefused,
} from './profile-text-form';

setupRitewayBun();

describe('profileTextRefusalOf', () => {
  test('each refusal word and status', () => {
    assert({
      given:
        'the three text words, an unknown word, a rate limit, a restriction and an outage',
      should: 'name each word, and each status by what it means',
      actual: [
        { status: 400, refusal: 'display-name-too-long' },
        { status: 400, refusal: 'display-name-handle' },
        { status: 400, refusal: 'bio-too-long' },
        { status: 400, refusal: 'cursed' },
        { status: 429, refusal: undefined },
        { status: 403, refusal: undefined },
        { status: 503, refusal: undefined },
      ].map(profileTextRefusalOf),
      expected: [
        'display-name-too-long',
        'display-name-handle',
        'bio-too-long',
        'unavailable',
        'rate-limited',
        'not-allowed',
        'unavailable',
      ],
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
      actual: profileTextRefused(form, 'display-name-handle'),
      expected: {
        kind: 'refused',
        values: { displayName: 'Ada', bio: 'Long bio' },
        error: 'A display name can’t contain @: it would look like a username.',
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

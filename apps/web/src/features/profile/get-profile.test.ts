import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleProfileExtras } from '../../ui/mock/profile';
import { getProfile } from './get-profile';

setupRitewayBun();

const now = '2026-10-03T12:00:00.000Z';

describe('getProfile', () => {
  test('a debater on the ladder', () => {
    const profile = getProfile('debater-a', null, now);
    assert({
      given: 'a debater who has ranked debates this season, seen by a visitor',
      should: 'show their rating detail and offer no edit link',
      actual: [profile.detail.kind, profile.me, profile.editHref],
      expected: ['player', false, null],
    });
  });

  test('a debater with no ranked debates', () => {
    const profile = getProfile('somebody-new', null, now);
    assert({
      given: 'a name with no place on the ladder',
      should: 'say they have no ranked debates this season',
      actual: [
        profile.detail.kind,
        profile.detail.kind === 'none' &&
          profile.detail.text.includes('no ranked debates'),
      ],
      expected: ['none', true],
    });
  });

  test('your own profile', () => {
    const profile = getProfile('debater-a', 'debater-a', now);
    assert({
      given: 'the signed-in member viewing their own profile',
      should: 'mark it as theirs and link to settings',
      actual: [profile.me, profile.editHref],
      expected: [true, '/settings'],
    });
  });
});

describe('sampleProfileExtras', () => {
  test('stable for a name', () => {
    assert({
      given: 'the same name twice and a different name',
      should: 'read the same, and differently for another name',
      actual: [
        JSON.stringify(sampleProfileExtras('debater-a', now)) ===
          JSON.stringify(sampleProfileExtras('debater-a', now)),
        JSON.stringify(sampleProfileExtras('debater-a', now)) ===
          JSON.stringify(sampleProfileExtras('debater-b', now)),
      ],
      expected: [true, false],
    });
  });

  test('a member since month', () => {
    assert({
      given: 'a sample profile',
      should: 'give a month and a year',
      actual: /^[A-Z][a-z]+ \d{4}$/.test(
        sampleProfileExtras('debater-a', now).memberSince,
      ),
      expected: true,
    });
  });
});
